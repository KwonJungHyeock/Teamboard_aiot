"use client";

// 내 업무 — 알림판 · 작업대(진행 중) · 일정 레일(할 일) (DESIGN.md 5.3, my-tasks.dc.html).
//
// 분류(우선순위 순): 수정 요청 있음 → 수정 필요 / 기한 지남 → 밀림 / 시작 전 → 할 일 / 나머지 → 진행 중.
// 완료는 `완료` 토글을 켰을 때만 진행 중 타일 끝에 흐리게 붙는다.
// 탭: 받은 일 = 담당이 나 / 맡긴 일 = 내가 만들고 담당이 남.
// 체크리스트 = 하위 업무. 진척 막대는 하위 업무 완료 비율(없으면 진행 15% · 검토 90% 자리 표시).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { addDays, catColor, diffDays, mondayOf, todayKst, weekday, wd, type EdTask } from "@/lib/ed/core";
import Composer from "../Composer";
import { deleteTask, patchTask, useMeta, useTasks, type Revision } from "../data";
import { api, emitChanged, useToast } from "../ui";

type Lane = "over" | "fix" | "doing" | "todo" | "done";
type Tab = "mine" | "delegated";

// 보류는 멈춰 둔 일 — 「지남」으로 재촉하지 않고 예정 칸에 「보류」 표시로 둔다(QA 5)
const laneOf = (t: EdTask, rev: Revision | undefined, today: string): Lane =>
  t.status === "done" ? "done" : rev ? "fix" : t.status === "hold" ? "todo" : t.dueDate && t.dueDate < today ? "over" : t.status === "todo" ? "todo" : "doing";
/** 보류 · 비공개 표시 — 비공개는 나만 보는 업무다 */
const Marks = ({ t }: { t: EdTask }) => (<>
  {t.status === "hold" && <em className="my-mk hold">보류</em>}
  {t.visibility === "private" && <em className="my-mk pv">비공개</em>}
</>);

const dLabel = (due: string | null, today: string) => {
  if (!due) return "—";
  const o = diffDays(due, today);
  return o < 0 ? `${-o}일 지남` : o === 0 ? "오늘" : o === 1 ? "내일" : `D-${o}`;
};
const dayOf = (iso: string, today: string) => `${Number(iso.slice(8))}일(${iso === today ? "오늘" : wd(iso)})`;

export default function MyTasks() {
  const router = useRouter();
  const path = usePathname() ?? "/v3/my";
  const meta = useMeta();
  const { tasks, revisions, setTasks } = useTasks();
  const [toast, showToast] = useToast();
  const today = todayKst();
  const me = meta?.me.id ?? null;

  const [tab, setTab] = useState<Tab>("mine");
  const [showDone, setShowDone] = useState(false);
  const [leaving, setLeaving] = useState<Record<number, "fly" | "leave" | "right">>({});
  const [hover, setHover] = useState<number | null>(null);
  const [newId, setNewId] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [flash, setFlash] = useState(0);
  const [triage, setTriage] = useState<{ q: number[]; i: number; moved: number; done: number; del: number } | null>(null);

  useEffect(() => {
    const a = setTimeout(() => setMounted(true), 60);
    const b = setTimeout(() => setIntro(false), 1400);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);

  const open = useCallback((id: number) => router.push(`${path}?task=${id}`, { scroll: false }), [router, path]);
  const revOf = useMemo(() => new Map(revisions.map((r) => [r.taskId, r])), [revisions]);

  // 하위 업무(체크리스트) 집계
  const kids = useMemo(() => {
    const m = new Map<number, { n: number; d: number }>();
    for (const t of tasks ?? []) {
      if (!t.parentTaskId || t.status === "dropped") continue;
      const c = m.get(t.parentTaskId) ?? { n: 0, d: 0 };
      c.n++; if (t.status === "done") c.d++;
      m.set(t.parentTaskId, c);
    }
    return m;
  }, [tasks]);

  const top = useMemo(() => (tasks ?? []).filter((t) => !t.parentTaskId && t.status !== "dropped" && t.status !== "proposed"), [tasks]);
  const inTab = useCallback((t: EdTask, k: Tab = tab) => (k === "mine" ? t.assigneeId === me : t.createdById === me && t.assigneeId !== me), [tab, me]);
  const pool = top.filter((t) => inTab(t));
  const byDue = (a: EdTask, b: EdTask) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.id - b.id;
  const lane = (k: Lane) => pool.filter((t) => laneOf(t, revOf.get(t.id), today) === k).sort(byDue);
  const over = lane("over"), fix = lane("fix"), doing = lane("doing"), todo = lane("todo"), done = lane("done");
  const alerts = [...over, ...fix];
  const openCount = pool.filter((t) => t.status !== "done").length;
  const tabCount = (k: Tab) => top.filter((t) => inTab(t, k) && t.status !== "done").length;

  // ── 쓰기 ─────────────────────────────────────────────────────
  const local = (id: number, p: Partial<EdTask>) => setTasks((xs) => xs && xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const exit = (id: number, how: "fly" | "leave" | "right", fn: () => Promise<void> | void, ms = 420) => {
    if (leaving[id]) return;
    setLeaving((l) => ({ ...l, [id]: how }));
    setTimeout(async () => {
      try { await fn(); } catch (e) { showToast(e instanceof Error ? e.message : "저장하지 못했습니다"); emitChanged(); }
      setLeaving((l) => { const n = { ...l }; delete n[id]; return n; });
    }, ms);
  };
  const setStatus = async (id: number, status: string) => { local(id, { status }); await patchTask(id, { status }); };
  const setDue = async (id: number, dueDate: string | null) => { local(id, { dueDate }); await patchTask(id, { dueDate }); };
  const fixDone = async (id: number) => {
    await api("/api/revisions", { method: "PATCH", body: { taskId: id } });
    local(id, { status: "review" });
    await patchTask(id, { status: "review" });
  };
  const start = (id: number) => exit(id, "right", async () => { await setStatus(id, "doing"); setFlash((f) => f + 1); }, 450);

  const fri = addDays(today, (5 - weekday(today) + 7) % 7);
  const nextWeek = addDays(mondayOf(today), 7);

  // ── 한 번에 정리 ─────────────────────────────────────────────
  const startTriage = () => {
    const q = top.filter((t) => t.assigneeId === me && laneOf(t, revOf.get(t.id), today) === "over").sort(byDue).map((t) => t.id);
    if (q.length) setTriage({ q, i: 0, moved: 0, done: 0, del: 0 });
  };
  const triageAct = useCallback(async (a: string) => {
    if (!triage || triage.i >= triage.q.length) return;
    const id = triage.q[triage.i];
    const n = { ...triage, i: triage.i + 1 };
    setTriage(n);
    try {
      if (a === "today") { n.moved++; await setDue(id, today); }
      else if (a === "fri") { n.moved++; await setDue(id, fri); }
      else if (a === "next") { n.moved++; await setDue(id, nextWeek); }
      else if (a === "done") { n.done++; await setStatus(id, "done"); }
      else if (a === "del") { n.del++; await deleteTask(id); }
      setTriage({ ...n });
    } catch (e) { showToast(e instanceof Error ? e.message : "저장하지 못했습니다"); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triage, today, fri, nextWeek]);
  const triRef = useRef(triageAct); triRef.current = triageAct;
  useEffect(() => {
    if (!triage) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setTriage(null); return; }
      const el = e.target as HTMLElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const a = ({ "1": "today", "2": "fri", "3": "next", "4": "done", "5": "del", "6": "skip" } as Record<string, string>)[e.key];
      if (a) { e.preventDefault(); void triRef.current(a); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [triage]);

  // 새로 만든 업무 — 맡긴 일이면 탭을 옮긴다
  const onAdded = async (id: number) => {
    setNewId(id);
    try {
      const d = await api<{ task: { assigneeId: number | null } }>(`/api/tasks/${id}`);
      if (d.task.assigneeId !== me) setTab("delegated"); else setTab("mine");
    } catch { /* 목록은 그대로 */ }
  };

  const rowAnim = (id: number, i: number, base: number) =>
    leaving[id] === "right" ? "toRight .45s var(--ease-out) forwards"
      : leaving[id] ? "leave .52s var(--ease-out) forwards"
      : id === newId ? "slideIn .45s var(--ease)"
      : intro ? `rowIn .4s var(--ease) ${(base + i * 0.04).toFixed(2)}s backwards` : undefined;

  const ready = tasks !== null && meta !== null;

  // ── 알림판 ───────────────────────────────────────────────────
  const board = (
    <section className={`my-board${alerts.length ? "" : " calm"}`}>
      <div className="my-bl">
        <span className="my-bt">알림판</span>
        <div className="my-bc">
          <div><i style={{ background: "var(--red)", boxShadow: "0 0 0 3px color-mix(in oklch,var(--red) 16%,transparent)" }} />밀림<b style={{ color: over.length ? "var(--red)" : "var(--faint)" }}>{over.length}</b></div>
          <div><i style={{ background: "var(--violet)", boxShadow: "0 0 0 3px color-mix(in oklch,var(--violet) 16%,transparent)" }} />수정 필요<b style={{ color: fix.length ? "var(--violet)" : "var(--faint)" }}>{fix.length}</b></div>
        </div>
        {tab === "mine" && over.length > 1 && <button type="button" className="my-tri" onClick={startTriage}>한 번에 정리</button>}
      </div>
      <div className="my-cards">
        {alerts.map((t, i) => {
          const isOver = !revOf.get(t.id);
          const r = revOf.get(t.id);
          const color = isOver ? "var(--red)" : "var(--violet)";
          const lv = leaving[t.id];
          return (
            <div key={t.id} className="my-card" onClick={() => open(t.id)}
                 style={{ animation: lv ? "flyUp .42s var(--ease-out) forwards" : intro ? `cardIn .5s var(--ease) ${(0.15 + i * 0.06).toFixed(2)}s backwards` : t.id === newId ? "cardIn .45s backwards" : undefined }}>
              <span className="tab" style={{ background: color }} />
              <div className="hd">
                <span className="tag" style={{ color, background: `color-mix(in oklch,${color} 13%,transparent)`, animation: i === 0 && isOver && !lv ? "pulseRed 2.4s infinite" : undefined }}>
                  {isOver ? `${-diffDays(t.dueDate!, today)}일 지남` : `수정 요청 · ${r!.requesterName}`}
                </span>
                <span className="cat">{t.areaName}{tab === "delegated" && t.assigneeName ? ` · ${t.assigneeName}` : ""}<Marks t={t} /></span>
              </div>
              <div className="tt">{t.title}</div>
              {!isOver && <div className="note">{r!.memo}</div>}
              <div className="qk" onClick={(e) => e.stopPropagation()}>
                {isOver ? (<>
                  <button type="button" onClick={() => exit(t.id, "fly", () => setDue(t.id, today))}>오늘로</button>
                  <button type="button" className="s" onClick={() => exit(t.id, "fly", () => setStatus(t.id, "done"))}>완료</button>
                </>) : (<>
                  <button type="button" onClick={() => open(t.id)}>보기</button>
                  {(t.assigneeId === me || r!.requesterId === me) &&
                    <button type="button" className="s" onClick={() => exit(t.id, "fly", () => fixDone(t.id))}>수정 완료</button>}
                </>)}
              </div>
            </div>
          );
        })}
        {ready && !alerts.length && <div className="my-calm"><span>✓</span>확인할 것 없음</div>}
      </div>
    </section>
  );

  // ── 진행 중 ──────────────────────────────────────────────────
  const tiles = [...doing, ...(showDone ? done : [])];
  const doingSec = (
    <section className="my-sec my-doing" style={{ animationDelay: ".08s" }}>
      <div className="my-flash" key={`f${flash}`} style={{ animation: flash ? `${flash % 2 ? "qFlashA" : "qFlashB"} 1.1s ease-out` : undefined }} />
      <div className="my-sh"><i style={{ background: "var(--accent)", boxShadow: "0 0 0 4px color-mix(in oklch,var(--accent) 16%,transparent)" }} /><span>진행 중</span><b>{doing.length}</b></div>
      <div className="my-tw">
        <div className="my-tiles">
          {tiles.map((t, i) => {
            const k = kids.get(t.id);
            const isDone = t.status === "done";
            const review = t.status === "review";
            const p = k && k.n ? k.d / k.n : t.progress > 0 ? t.progress / 100 : review ? 0.9 : 0.15;
            const hv = hover === t.id && !leaving[t.id];
            const o = t.dueDate ? diffDays(t.dueDate, today) : null;
            return (
              <div key={t.id} className={`my-tile${hv ? " hv" : ""}${isDone ? " dn" : ""}`} onClick={() => open(t.id)}
                   onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover((h) => (h === t.id ? null : h))}
                   style={{ animation: rowAnim(t.id, i, 0.25) }}>
                <div className="r1">
                  <span className="tt">{t.title}</span><Marks t={t} />
                  <span className="d" style={{ color: isDone ? "var(--green)" : o !== null && o <= 1 ? "var(--amber)" : "var(--sub)" }}>{isDone ? "완료" : dLabel(t.dueDate, today)}</span>
                </div>
                {!hv ? (
                  <div className="bar"><i style={{ width: mounted ? `${(isDone ? 1 : p) * 100}%` : "0%", background: isDone ? "var(--green)" : review ? "var(--violet)" : "var(--accent)", transitionDelay: `${(0.3 + i * 0.08).toFixed(2)}s` }} /></div>
                ) : (
                  <div className="qk" onClick={(e) => e.stopPropagation()}>
                    {isDone ? <button type="button" onClick={() => void setStatus(t.id, "doing")}>되돌리기</button> : (<>
                      <button type="button" onClick={() => void setStatus(t.id, review ? "doing" : "review")}>{review ? "진행으로" : "검토 요청"}</button>
                      <button type="button" className="s" onClick={() => exit(t.id, "leave", () => setStatus(t.id, "done"), 520)}>완료</button>
                    </>)}
                  </div>
                )}
              </div>
            );
          })}
          {ready && !tiles.length && <div className="my-none">진행 중인 일 없음</div>}
        </div>
        {doing.length > 7 && <div className="my-more">아래로 더 있음</div>}
      </div>
    </section>
  );

  // ── 할 일(일정 레일) ─────────────────────────────────────────
  const keys = Array.from(new Set(todo.map((t) => t.dueDate ?? "none")));
  let lastM: string | null = null;
  const agenda = keys.map((key, gi) => {
    const items = todo.filter((t) => (t.dueDate ?? "none") === key);
    const o = key === "none" ? null : diffDays(key, today);
    const mKey = key === "none" ? "none" : key.slice(0, 7);
    const hasMonth = mKey !== lastM; lastM = mKey;
    const mCount = todo.filter((t) => (mKey === "none" ? !t.dueDate : t.dueDate?.slice(0, 7) === mKey)).length;
    const soon = o !== null && o <= 1;
    return (
      <div key={key}>
        {hasMonth && (
          <div className="my-mh" style={{ padding: gi === 0 ? "4px 0 2px" : "14px 0 2px", animation: intro ? `rowIn .4s var(--ease) ${(0.35 + gi * 0.08).toFixed(2)}s backwards` : undefined }}>
            <span className="l">{key === "none" ? "기한" : `${Number(key.slice(5, 7))}월`}</span><span className="m"><i /></span>
            <span className="s">{key === "none" ? `없음 · ${mCount}건` : `${mCount}건`}</span>
          </div>
        )}
        <div className="my-ar" style={{ animation: intro ? `rowIn .4s var(--ease) ${(0.35 + gi * 0.08).toFixed(2)}s backwards` : undefined }}>
          <div className="dt" style={{ color: soon ? "var(--amber)" : o === null ? "var(--faint)" : "var(--ink)" }}>{key === "none" ? "언젠가" : dayOf(key, today)}</div>
          <div className="nd">
            <span style={{ width: o === 0 ? 12 : 9, height: o === 0 ? 12 : 9, background: o === null ? "var(--ringbg)" : soon ? "var(--amber)" : "var(--faint)",
                           border: o === null ? "1.5px dashed var(--faint)" : 0, boxShadow: `0 0 0 3px var(--ringbg)${o === 0 ? ",0 0 12px var(--amber)" : ""}`,
                           animationDelay: `${(0.45 + gi * 0.1).toFixed(2)}s` }} />
          </div>
          <div className="its">
            {items.map((t, i) => {
              const hv = hover === t.id && !leaving[t.id];
              return (
                <div key={t.id} className={`my-chip${hv ? " hv" : ""}`} onClick={() => open(t.id)}
                     onMouseEnter={() => setHover(t.id)} onMouseLeave={() => setHover((h) => (h === t.id ? null : h))}
                     style={{ animation: rowAnim(t.id, i, 0.25) }}>
                  <div className="bd">
                    <div className="tt">{t.title}</div>
                    <div className="ct"><i style={{ background: catColor(t.areaName) }} />{t.areaName}{tab === "delegated" && t.assigneeName ? ` · ${t.assigneeName}` : ""}<Marks t={t} /></div>
                  </div>
                  {hv && (
                    <div className="qk" onClick={(e) => e.stopPropagation()}>
                      <button type="button" onClick={() => void setDue(t.id, today)}>오늘로</button>
                      <button type="button" className="s" onClick={() => start(t.id)}>시작</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  });
  const todoSec = (
    <section className="my-sec my-todo" style={{ animationDelay: ".16s" }}>
      <div className="my-sh"><i style={{ background: "var(--amber)", boxShadow: "0 0 0 4px color-mix(in oklch,var(--amber) 16%,transparent)" }} /><span>할 일</span><b>{todo.length}</b></div>
      <div className="my-ag ed-scroll">
        {todo.length > 0 && <div className="my-rail">{agenda}<div className="line" /></div>}
        {ready && !todo.length && <div className="my-none" style={{ padding: "24px 14px" }}>예정된 일 없음</div>}
      </div>
    </section>
  );

  // ── 정리 모달 ────────────────────────────────────────────────
  let tri: React.ReactNode = null;
  if (triage) {
    const cur = triage.i < triage.q.length ? top.find((t) => t.id === triage.q[triage.i]) : null;
    const acts: [string, string, string, string, boolean][] = [
      ["1", "오늘", "today", "var(--amber)", true], ["2", "금요일", "fri", "var(--ink)", true], ["3", "다음 주", "next", "var(--ink)", true],
      ["4", "완료", "done", "var(--green)", true], ["5", "삭제", "del", "var(--red)", false], ["6", "건너뛰기", "skip", "var(--sub)", false],
    ];
    tri = (
      <div className="my-tri-bg" onClick={() => setTriage(null)}>
        <div className="my-tri-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="밀린 업무 정리">
          <div className="h"><span>밀린 업무 정리</span><div><b className="tn">{Math.min(triage.i + 1, triage.q.length)} / {triage.q.length}</b>
            <button type="button" className="ed-x" style={{ width: 30, height: 30, borderRadius: 10, fontSize: 13 }} onClick={() => setTriage(null)} aria-label="닫기">✕</button></div></div>
          <div className="pb"><i style={{ width: `${(triage.i / triage.q.length) * 100}%` }} /></div>
          {cur ? (<>
            <div className="cur" key={triage.i} style={{ animation: `${triage.i % 2 ? "cardA" : "cardB"} .3s var(--ease)` }}>
              <div className="t">{cur.title}</div>
              <div className="m"><i style={{ background: catColor(cur.areaName) }} />{cur.areaName}<b>· {cur.dueDate ? `${-diffDays(cur.dueDate, today)}일 지남` : "기한 없음"}</b></div>
            </div>
            <div className="acts">
              {acts.map(([k, label, a, fg, strong]) => (
                <button key={k} type="button" className={strong ? "st" : undefined} style={{ color: fg }} onClick={() => void triageAct(a)}><kbd>{k}</kbd>{label}</button>
              ))}
            </div>
          </>) : (<>
            <div className="fin"><b>정리 끝</b><span>옮김 {triage.moved} · 완료 {triage.done} · 삭제 {triage.del}</span></div>
            <button type="button" className="ed-btn pri" style={{ padding: 14, borderRadius: 14, fontSize: 15 }} onClick={() => setTriage(null)}>닫기</button>
          </>)}
        </div>
      </div>
    );
  }

  return (
    <div className="my-root">
      <div className="my-head">
        <div className="l">
          <div className="t"><h1 className="ed-h1">내 업무</h1>{ready && <span className="tn">{openCount}건</span>}</div>
          <div className="my-tabs" role="tablist">
            {(["mine", "delegated"] as Tab[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : undefined} onClick={() => setTab(k)}>
                {k === "mine" ? "받은 일" : "맡긴 일"}<span className="tn">{ready ? tabCount(k) : ""}</span>
              </button>
            ))}
          </div>
        </div>
        <button type="button" className={`my-done${showDone ? " on" : ""}`} aria-pressed={showDone} onClick={() => setShowDone((v) => !v)}>완료 {done.length}</button>
      </div>
      <Composer variant="tokens" onAdded={(id) => void onAdded(id)} />
      {board}
      <div className="my-work">{doingSec}{todoSec}</div>
      {tri}
      {toast}
    </div>
  );
}
