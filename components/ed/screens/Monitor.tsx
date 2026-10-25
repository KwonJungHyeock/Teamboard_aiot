"use client";

// 업무 현황 (DESIGN.md 5.2 · monitor-v8-home.dc.html) — 등록창 → 이번 주 레일 → [내 업무 | 팀] → LIVE 티커(프레임).
// 업무 숫자는 `/api/tasks`(하위 업무 제외)에서 센다. 팀원 · 목표 미니바는 `/api/ed/control`.
// 계속 움직이는 것은 지남 칸 배지 펄스 하나(팀원 점 breathe 는 모션 표준의 「조용한 팀원」).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { addDays, ago, diffDays, initial, isEnter, md, todayKst, wd, type EdTask } from "@/lib/ed/core";
import Composer from "../Composer";
import { patchTask, useMeta, useTasks } from "../data";
import { api, Check, Drawer, useOnChanged } from "../ui";

interface MonPerson { id: number; name: string; lastSeen: string | null; feed: { message: string; at: string }[] }
interface MonGoal { id: number; level: "year" | "quarter" | "month"; title: string; progress: number; expect: number }
interface MonData { today: string; people: MonPerson[]; goals: MonGoal[] }

const H = 3600e3, D = 24 * H;
const LEVEL = { year: "연간", quarter: "분기", month: "월" } as const;
const iso = (s: string) => s.replace(" ", "T").replace(/\+00$/, "Z");
const DAY: Record<string, string> = { focus: "집중", out: "외근", off: "휴가" };
const strip = (name: string, msg: string) => (msg.startsWith(name) ? msg.slice(name.length).replace(/^이\(가\)\s*/, "") : msg);

export default function Monitor() {
  const router = useRouter();
  const path = usePathname();
  const meta = useMeta();
  const { tasks } = useTasks();
  const [mon, setMon] = useState<MonData | null>(null);
  const [weekOpen, setWeekOpen] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [preset, setPreset] = useState<{ who: number; k: number } | null>(null);
  const [justDone, setJustDone] = useState<Set<number>>(new Set());
  const [newId, setNewId] = useState<number | null>(null);
  const [flash, setFlash] = useState<Record<number, number>>({});
  const [anim, setAnim] = useState(false);
  // 하루 한 줄 · 상태(0039) — 팀 표에 보이고, 내 행 드로어에서 정한다. Claude 의 set_today 도 같은 값을 쓴다
  const [daily, setDaily] = useState<Record<number, { line: string | null; state: string | null }>>({});
  const [myLine, setMyLine] = useState("");
  const [brief, setBrief] = useState<null | { loading?: boolean; text?: string; range?: string; none?: boolean; err?: string }>(null);
  const loadDaily = useCallback(async () => {
    const r = await fetch("/api/daily", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setDaily((await r.json()).notes ?? {});
  }, []);
  useEffect(() => { void loadDaily(); }, [loadDaily]);
  const saveDay = async (body: { line?: string; state?: string | null }) => {
    const r = await fetch("/api/daily", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (r?.ok) void loadDaily();
  };
  const openBrief = async (make = false) => {
    setBrief({ loading: true });
    const r = await fetch("/api/brief" + (make ? "" : "?week=last"), make
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ week: "last" }) } : { cache: "no-store" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setBrief({ err: d.error ?? "불러오지 못했습니다" }); return; }
    const range = `${String(d.week?.start ?? "").slice(5).replace("-", ".")} – ${String(d.week?.end ?? "").slice(5).replace("-", ".")}`;
    setBrief(d.brief ? { text: d.brief.text, range } : { none: true, range });
  };
  const lastLive = useRef<number | null>(null);
  const today = todayKst();

  const loadMon = useCallback(async () => { setMon(await api<MonData>("/api/ed/control").catch(() => null)); }, []);
  useEffect(() => { void loadMon(); const t = setTimeout(() => setAnim(true), 150); return () => clearTimeout(t); }, [loadMon]);
  useOnChanged(() => { void loadMon(); });

  // 새 활동 → 그 팀원 행에 하이라이트 한 번 (rowA/rowB 번갈아)
  useEffect(() => {
    const on = (e: Event) => {
      const list = (e as CustomEvent<{ id: number; userId: number | null }[]>).detail ?? [];
      const top = list[0]?.id ?? null;
      const prev = lastLive.current;
      lastLive.current = top;
      if (prev === null || top === null || top === prev) return;
      const fresh = list.filter((x) => x.id > prev && x.userId);
      if (!fresh.length) return;
      setFlash((f) => { const n = { ...f }; for (const x of fresh) n[x.userId!] = (n[x.userId!] ?? 0) + 1; return n; });
      void loadMon();
    };
    window.addEventListener("ed:live", on);
    return () => window.removeEventListener("ed:live", on);
  }, [loadMon]);

  const top = useMemo(() => (tasks ?? []).filter((t) => !t.parentTaskId && t.status !== "dropped" && t.status !== "proposed"), [tasks]);
  const open = useMemo(() => top.filter((t) => t.status !== "done"), [top]);
  const isOver = (t: EdTask) => t.status !== "done" && !!t.dueDate && t.dueDate < today;
  const weekEnd = addDays(today, 6);
  const inWeek = (t: EdTask) => t.status !== "done" && !!t.dueDate && t.dueDate >= today && t.dueDate <= weekEnd;

  // ── 이번 주 레일: 지남 + 오늘부터 7일 ──
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  const overList = open.filter(isOver).sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1));
  const dayList = (d: string) => top.filter((t) => t.dueDate === d && (t.status !== "done" || justDone.has(t.id)));
  const faces = (ts: EdTask[]) => {
    const seen: string[] = [];
    for (const t of ts) { const n = t.assigneeName ?? "?"; if (!seen.includes(n)) seen.push(n); }
    return seen.slice(0, 4);
  };

  // ── 내 업무 ──
  const me = meta?.me.id;
  const mine = top.filter((t) => t.assigneeId === me && (t.status !== "done" || justDone.has(t.id)))
    .sort((a, b) => (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : (a.dueDate ?? "9999") > (b.dueDate ?? "9999") ? 1 : a.id - b.id);
  const goalLine = (t: EdTask) => {
    const g = meta?.goals.find((x) => t.goalIds.includes(x.id));
    return g ? `${LEVEL[g.periodType as keyof typeof LEVEL] ?? ""} · ${g.title}` : "";
  };
  const due = (t: EdTask): { text: string; tone: "red" | "amber" | "" } => {
    if (!t.dueDate) return { text: "—", tone: "" };
    const n = diffDays(t.dueDate, today);
    if (n < 0) return { text: `${-n}일 지남`, tone: "red" };
    if (n === 0) return { text: "오늘", tone: "amber" };
    return { text: md(t.dueDate), tone: "" };
  };
  const toggle = async (t: EdTask) => {
    const done = t.status !== "done";
    setJustDone((s) => { const n = new Set(s); if (done) n.add(t.id); else n.delete(t.id); return n; });
    try { await patchTask(t.id, { status: done ? "done" : "todo" }); } catch { /* 다시 읽으면 제자리 */ }
  };
  const openTask = (id: number) => router.push(`${path}?task=${id}`, { scroll: false });

  // ── 팀 ──
  const now = Date.now();
  const members = (mon?.people ?? []).map((p) => {
    const ts = open.filter((t) => t.assigneeId === p.id);
    const over = ts.filter(isOver), week = ts.filter(inWeek);
    const ordered = [...over.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)), ...week.sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1)),
      ...ts.filter((t) => !isOver(t) && !inWeek(t))];
    const lastMs = p.lastSeen ? now - Date.parse(iso(p.lastSeen)) : null;
    const fresh = lastMs !== null && lastMs < D, quiet = lastMs !== null && !fresh && lastMs < 14 * D;
    return {
      ...p, ts: ordered, active: ts.length, over: over.length, week: week.length, lastMs, fresh, quiet,
      dim: lastMs === null || lastMs > 60 * D,
      blocks: ts.map((_, i) => (i < over.length ? "var(--red)" : i < over.length + week.length ? "var(--amber)" : "var(--accent)")),
      task: ordered.length ? `${ordered[0].title}${ordered.length > 1 ? ` 외 ${ordered.length - 1}건` : ""}` : "진행 중인 일 없음",
    };
  });
  const selM = members.find((m) => m.id === sel) ?? null;
  const goalColor = (g: MonGoal) => (g.progress >= g.expect ? "var(--green)" : g.progress - g.expect > -10 ? "var(--amber)" : "var(--red)");
  const tone = (n: number, c: string) => (n ? c : "var(--faint)");
  const dueOf = (t: EdTask) => {
    if (isOver(t)) return { meta: `${diffDays(today, t.dueDate!)}일 지남`, color: "var(--red)" };
    if (inWeek(t)) return { meta: t.dueDate === today ? "오늘" : `${wd(t.dueDate!)} ${Number(t.dueDate!.slice(8))}`, color: "var(--amber)" };
    return { meta: t.dueDate ? md(t.dueDate) : "—", color: "var(--accent)" };
  };

  const cell = (key: string, top: string, big: string | number, ts: EdTask[], kind: "over" | "today" | "day") => {
    const fs = faces(ts);
    const empty = ts.length === 0;
    return (
      <div key={key} className="mon-col">
        <button type="button" className={`mon-cell ${kind}${!empty && kind === "day" ? " has" : ""}`} onClick={() => setWeekOpen(!weekOpen)}>
          <div className="mon-cd"><span>{top}</span><b className="tn">{big}</b></div>
          <div className="mon-faces">
            {fs.map((n, i) => <span key={n} className={kind === "over" && i === 0 ? "pulse" : undefined}>{initial(n)}</span>)}
            {empty && <i />}
          </div>
        </button>
        {weekOpen && (
          <div className="mon-tks">
            {(kind === "over" ? ts.slice(0, 6) : ts).map((t) => {
              const done = t.status === "done";
              return (
                <button key={t.id} type="button" className={`mon-tk${done ? " done" : ""}`} onClick={() => openTask(t.id)}>
                  <div className="tt">{t.title}</div>
                  <div className="wh"><span>{initial(t.assigneeName)}</span><em>{t.assigneeName ?? "담당 없음"}</em>
                    {kind === "over" && <b>{diffDays(today, t.dueDate!)}일</b>}</div>
                </button>
              );
            })}
            {kind === "over" && ts.length > 6 && <Link className="mon-more" href="/v3/tasks?f=over">+{ts.length - 6}건 더</Link>}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="mon-comp">
        <Composer variant="chips" presetWho={preset?.who ?? null} autoFocusKey={preset?.k}
                  onAdded={(id) => { setNewId(id); setPreset(null); }} />
      </div>

      <section className="mon-week q q1">
        <button type="button" className="mon-wh" onClick={() => setWeekOpen(!weekOpen)} aria-expanded={weekOpen}>
          <div><b>이번 주</b><span className="tn">{md(today)} – {md(weekEnd)}</span></div>
          <i style={{ transform: `rotate(${weekOpen ? 180 : 0}deg)` }}>▼</i>
        </button>
        <div className="mon-wscroll">
          <div className="mon-wgrid">
            {cell("over", "지남", overList.length, overList, "over")}
            {days.map((d, i) => cell(d, i === 0 ? `${wd(d)} · 오늘` : wd(d), Number(d.slice(8)), dayList(d), i === 0 ? "today" : "day"))}
          </div>
        </div>
      </section>

      <div className="mon-grid">
        <section className="mon-mine q q2">
          <div className="mon-sh"><h2>내 업무</h2><span className="tn">{mine.filter((t) => t.status !== "done").length}</span></div>
          <div className="mon-well">
            {tasks === null ? null : mine.length === 0 ? <div className="ed-empty" style={{ padding: "10px 8px" }}>진행 중인 일 없음</div> : mine.map((t) => {
              const done = t.status === "done";
              const d = done ? { text: "완료", tone: "" as const } : due(t);
              const g = goalLine(t);
              return (
                <div key={t.id} className={`mon-my${done ? " done" : ""}${t.id === newId ? " new" : ""}`} onClick={() => openTask(t.id)} role="button" tabIndex={0}
                     onKeyDown={(e) => { if (e.key === "Enter") openTask(t.id); }}>
                  <Check on={done} onClick={() => void toggle(t)} />
                  <div className="bd"><div className="tt">{t.title}</div>{g && <div className="gl">{g}</div>}</div>
                  <span className={`mon-due ${d.tone}`}>{d.text}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section className="mon-team q q3">
          <div className="mon-sh team">
            <h2>팀</h2>
            <button type="button" className="mon-brief" onClick={() => void openBrief()}>주간 브리핑</button>
            <div className="mon-goals">
              {(mon?.goals ?? []).map((g) => (
                <div key={g.id} title={g.title} className="mon-g">{LEVEL[g.level]}
                  <div className="bar"><i style={{ width: anim ? `${g.progress}%` : "0%", background: goalColor(g) }} /><em style={{ left: `${g.expect}%` }} /></div>
                  <span className="tn" style={{ color: goalColor(g) }}>{g.progress}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mon-table">
            <div className="mon-th"><span>팀원</span><span>진행 업무</span><div className="n3"><span className="a">진행</span><span className="w">이번 주</span><span className="o">지남</span></div></div>
            {members.map((m) => (
              <div key={m.id} className="mon-tr" role="button" tabIndex={0} onClick={() => setSel(m.id)} onKeyDown={(e) => { if (e.key === "Enter") setSel(m.id); }}
                   style={{ opacity: m.dim ? 0.5 : 1, animation: flash[m.id] ? `${flash[m.id] % 2 ? "rowA" : "rowB"} 1.4s ease-out backwards` : undefined }}>
                <div className="who">
                  <span className="av">{initial(m.name)}<i className={m.fresh ? "fresh" : m.quiet ? "quiet" : ""} /></span>
                  <div><b>{m.name}</b><small style={{ color: daily[m.id]?.state ? "var(--accent)" : m.fresh ? "var(--green)" : "var(--faint)" }}>{daily[m.id]?.state ? `${DAY[daily[m.id].state!] ?? ""}${daily[m.id].line ? ` · ${daily[m.id].line}` : ""}` : daily[m.id]?.line ? daily[m.id].line : m.lastMs === null ? "기록 없음" : ago(iso(m.lastSeen!))}</small></div>
                </div>
                <div className="wk">
                  <div className="blk">{m.blocks.map((c, i) => <span key={i} style={{ background: c }} />)}</div>
                  <div className="ln">{m.task}</div>
                </div>
                <div className="n3 num tn">
                  <span style={{ color: tone(m.active, "var(--accent)") }}>{m.active}</span>
                  <span style={{ color: tone(m.week, "var(--amber)") }}>{m.week}</span>
                  <span style={{ color: tone(m.over, "var(--red)") }}>{m.over}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {selM && (
        <Drawer onClose={() => setSel(null)} width={420} label={selM.name}>
          <div className="mon-dh">
            <span className="av">{initial(selM.name)}<i style={{ background: selM.fresh ? "var(--green)" : selM.quiet ? "var(--amber)" : "var(--faint)" }} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="nm">{selM.name}</div>
              <div className="ls" style={{ color: selM.fresh ? "var(--green)" : "var(--faint)" }}>{selM.lastMs === null ? "기록 없음" : ago(iso(selM.lastSeen!))}</div>
            </div>
            <button type="button" className="ed-x" onClick={() => setSel(null)} aria-label="닫기">✕</button>
          </div>
          <div className="mon-d3">
            <div><b className="tn" style={{ color: tone(selM.active, "var(--accent)") }}>{selM.active}</b><span style={{ color: "var(--accent)" }}>진행</span></div>
            <div><b className="tn" style={{ color: tone(selM.week, "var(--amber)") }}>{selM.week}</b><span style={{ color: "var(--amber)" }}>이번 주</span></div>
            <div><b className="tn" style={{ color: tone(selM.over, "var(--red)") }}>{selM.over}</b><span style={{ color: "var(--red)" }}>지남</span></div>
          </div>
          <div className="db mon-db">
            {(selM.id === meta?.me.id || daily[selM.id]?.line || daily[selM.id]?.state) && (
              <div className="grp">
                <div className="lb">오늘</div>
                {selM.id === meta?.me.id ? (
                  <>
                    <input className="ed-input" placeholder="오늘 할 일 한 줄 · Enter" defaultValue={daily[selM.id]?.line ?? ""} key={daily[selM.id]?.line ?? ""}
                           onChange={(e) => setMyLine(e.target.value)}
                           onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void saveDay({ line: myLine }); } }}
                           onBlur={() => { if (myLine !== (daily[selM.id]?.line ?? "")) void saveDay({ line: myLine }); }} />
                    <div className="ed-chips">
                      {[["", "보통"], ["focus", "집중"], ["out", "외근"], ["off", "휴가"]].map(([k, l]) => (
                        <button key={k} type="button" className={`ed-chip${(daily[selM.id]?.state ?? "") === k ? " on" : ""}`} onClick={() => void saveDay({ state: k || null })}>{l}</button>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mon-day">{daily[selM.id]?.state && <b>{DAY[daily[selM.id].state!]}</b>}{daily[selM.id]?.line}</div>
                )}
              </div>
            )}
            <div className="grp">
              <div className="lb">업무</div>
              {selM.ts.slice(0, 8).map((t) => {
                const x = dueOf(t);
                return (
                  <button key={t.id} type="button" className="mon-dt" onClick={() => { setSel(null); openTask(t.id); }}>
                    <i style={{ background: x.color }} /><span>{t.title}</span><em style={{ color: x.color }}>{x.meta}</em>
                  </button>
                );
              })}
              {selM.ts.length > 8 && <Link className="mon-rest" href={`/v3/tasks?who=${selM.id}`}>+{selM.ts.length - 8}건 · 업무 목록에서 보기</Link>}
              {selM.ts.length === 0 && <div className="ed-empty">진행 중인 일 없음</div>}
            </div>
            <div className="grp" style={{ gap: 2 }}>
              <div className="lb" style={{ paddingBottom: 6 }}>최근 활동</div>
              {selM.feed.map((f, i) => (
                <div key={i} className="mon-fd"><span>{strip(selM.name, f.message)}</span><em>{ago(iso(f.at))}</em></div>
              ))}
              {selM.feed.length === 0 && <div className="ed-empty">기록 없음</div>}
            </div>
          </div>
          <div className="df">
            <button type="button" className="ed-btn pri lg" style={{ flex: 1 }} onClick={() => { setPreset({ who: selM.id, k: Date.now() }); setSel(null); }}>업무 맡기기</button>
            <Link className="ed-btn lg" style={{ flex: 1, color: "var(--ink)" }} href={`/v3/tasks?who=${selM.id}`}>전체 업무</Link>
          </div>
        </Drawer>
      )}
      {brief && (
        <Drawer onClose={() => setBrief(null)} width={460} label="주간 브리핑">
          <div className="dh" style={{ alignItems: "center" }}>
            <div style={{ flex: 1 }}><div style={{ fontSize: 20, fontWeight: 700 }}>주간 브리핑</div>{brief.range && <div className="ed-crumb tn" style={{ marginTop: 2 }}>지난주 · {brief.range}</div>}</div>
            <button type="button" className="ed-x" onClick={() => setBrief(null)} aria-label="닫기">✕</button>
          </div>
          <div className="db">
            {brief.loading ? <div className="ed-empty">불러오는 중</div>
              : brief.err ? <div className="ed-err">{brief.err}</div>
              : brief.none ? <div className="ed-empty">아직 없음</div>
              : <div className="mon-brief-t">{brief.text}</div>}
          </div>
          {!brief.loading && (brief.none || brief.text) && (
            <div className="df"><button type="button" className="ed-btn pri lg" style={{ flex: 1 }} onClick={() => void openBrief(true)}>{brief.none ? "브리핑 만들기" : "다시 만들기"}</button></div>
          )}
        </Drawer>
      )}
    </>
  );
}
