"use client";

// 일정 — 달/주 달력 + 날짜 패널 (calendar.dc.html · DESIGN.md 5.9).
//   칸: 날짜 원 · n건 · 업무 줄(상태 점 + 제목, 박스 없음) · +n건 · 2px 부하 막대. 카테고리 색은 쓰지 않는다.
//   패널: `24일(오늘)` + n건 · 체크로 완료 · `이 날 업무 · Enter` · `기한 없음 n건 →`
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { addDays, isEnter, todayKst, weekday, type EdTask } from "@/lib/ed/core";
import { createTask, patchTask, useTasks } from "../data";
import { useToast } from "../ui";

const WK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (iso: string) => iso.slice(0, 7);
function shiftYm(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

export default function Calendar({ meId, launch }: { meId: number; launch: string | null }) {
  const today = todayKst();
  const { tasks, setTasks } = useTasks();
  const [ym, setYm] = useState(ymOf(today));
  const [sel, setSel] = useState(today);
  const [view, setView] = useState<"month" | "week">("month");
  const [mine, setMine] = useState(false);
  const [n, setN] = useState(0);
  const [sn, setSn] = useState(0);
  const [text, setText] = useState("");
  const [newId, setNewId] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const [toast, showToast] = useToast();
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1400); return () => clearTimeout(t); }, []);

  const vis = useMemo(() => (tasks ?? []).filter((t) => t.parentTaskId === null && t.status !== "dropped" && t.status !== "proposed"
    && (!mine || t.assigneeId === meId)), [tasks, mine, meId]);
  const byDay = useMemo(() => {
    const m = new Map<string, EdTask[]>();
    for (const t of vis) if (t.dueDate) m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]);
    for (const [k, xs] of Array.from(m.entries())) m.set(k, xs.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.id - b.id));
    return m;
  }, [vis]);
  const noDue = vis.filter((t) => !t.dueDate && t.status !== "done").length;

  const on = (d: string) => byDay.get(d) ?? [];
  const past = (d: string) => d < today;
  const look = (t: EdTask) => t.status === "done" ? "done" : past(t.dueDate ?? today) ? "over" : "open";

  const move = (dir: number) => {
    setIntro(false);
    if (view === "week") { const s = addDays(sel, dir * 7); setSel(s); setYm(ymOf(s)); }
    else setYm((x) => shiftYm(x, dir));
    setN((x) => x + 1);
  };
  const goToday = () => { setIntro(false); setYm(ymOf(today)); setSel(today); setN((x) => x + 1); setSn((x) => x + 1); };
  const pick = (d: string) => { setIntro(false); setSel(d); setSn((x) => x + 1); };

  const toggle = async (t: EdTask) => {
    const next = t.status === "done" ? "todo" : "done";
    setTasks((xs) => xs && xs.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    try { await patchTask(t.id, { status: next }); } catch (e) { showToast(e instanceof Error ? e.message : "저장하지 못했습니다"); }
  };
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    setText("");
    try { const { id } = await createTask({ title, dueDate: sel, assigneeId: meId, status: "todo" }); setNewId(id); }
    catch (e) { setText(title); showToast(e instanceof Error ? e.message : "추가하지 못했습니다"); }
  };

  // ── 칸 ────────────────────────────────────────────────────────
  const cellBase = (d: string, inMonth: boolean) => {
    const isToday = d === today, isSel = d === sel, wk = weekday(d), isLaunch = d === launch;
    const inRun = !!launch && d > today && d < launch, weekend = wk === 0 || wk === 6;
    const cls = ["cal-c", isToday && "today", isLaunch && "launch", !isToday && !isLaunch && inRun && "run", !isToday && !isLaunch && !inRun && weekend && "wkend", isSel && "sel"]
      .filter(Boolean).join(" ");
    const num = ["cal-n", isToday ? "today" : isLaunch ? "launch" : !inMonth ? "out" : wk === 0 ? "sun" : wk === 6 ? "sat" : ""].filter(Boolean).join(" ");
    return { cls, num, isLaunch };
  };
  const [Y, M] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const dim = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const rowsN = Math.ceil((weekday(first) + dim) / 7);
  const start = addDays(first, -weekday(first));
  const cap = rowsN > 5 ? 2 : 3;
  const ws = addDays(sel, -weekday(sel));
  const slide = n ? `${n % 2 ? "calA" : "calB"} .38s var(--ease) backwards` : undefined;

  const Item = ({ t }: { t: EdTask }) => {
    const l = look(t);
    return <div className={`cal-it ${l}`}><i /><span>{t.title}</span></div>;
  };

  const dayList = on(sel);
  const selDate = new Date(`${sel}T00:00:00Z`);
  const dayTitle = `${selDate.getUTCMonth() + 1}월 ${selDate.getUTCDate()}일(${sel === today ? "오늘" : WK[weekday(sel)]})`;
  const title = view === "week"
    ? `${Number(ws.slice(5, 7))}월 ${Number(ws.slice(8, 10))}일 주`
    : `${Y}년 ${M}월`;

  return (
    <>
      <div className="cal-head">
        <div className="cal-hl">
          <h1 className="ed-h1">일정</h1>
          <div className="cal-mv">
            <button type="button" onClick={() => move(-1)} aria-label="이전">‹</button>
            <span className="tn">{title}</span>
            <button type="button" onClick={() => move(1)} aria-label="다음">›</button>
          </div>
          <button type="button" className="cal-today" onClick={goToday}>오늘</button>
        </div>
        <div className="cal-hl">
          <button type="button" className={`cal-mine${mine ? " on" : ""}`} aria-pressed={mine} onClick={() => setMine((x) => !x)}>내 것만</button>
          <div className="cal-vw" role="tablist">
            {(["month", "week"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : undefined}
                      onClick={() => { setIntro(false); setView(v); setN((x) => x + 1); }}>{v === "month" ? "달" : "주"}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="cal-main">
        <section className="cal-sec">
          <div className="cal-wh">{WK.map((w, i) => <span key={w} className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>{w}</span>)}</div>
          {view === "month" ? (
            <div className="cal-grid" key={`m${n}`} style={{ gridTemplateRows: `repeat(${rowsN},minmax(0,1fr))`, animation: slide }}>
              {Array.from({ length: rowsN * 7 }, (_, i) => {
                const d = addDays(start, i);
                const inMonth = ymOf(d) === ym;
                const xs = on(d);
                const open = xs.filter((t) => t.status !== "done").length;
                const over = past(d) && open > 0;
                const b = cellBase(d, inMonth);
                const op = inMonth ? (past(d) && d !== today ? 0.85 : 1) : 0.4;
                return (
                  <div key={d} className={b.cls} onClick={() => pick(d)} role="button" tabIndex={0}
                       onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(d); } }}
                       style={{ opacity: op, animation: intro ? `rowIn .35s var(--ease) ${(0.1 + (Math.floor(i / 7) + (i % 7)) * 0.03).toFixed(2)}s backwards` : undefined }}>
                    <div className="cal-ct">
                      <span className={b.num}>{Number(d.slice(8, 10))}</span>
                      {xs.length > 0 && <span className="cal-cnt tn">{xs.length}건</span>}
                      {b.isLaunch && <span className="cal-lt">가오픈</span>}
                      {over && <span className="cal-od" />}
                    </div>
                    {xs.slice(0, cap).map((t) => <Item key={t.id} t={t} />)}
                    {xs.length > cap && <span className="cal-more">+{xs.length - cap}건</span>}
                    <span className="cal-load" style={{ opacity: xs.length ? 1 : 0 }}>
                      <i style={{ width: `${Math.min(100, (xs.length / 3) * 100)}%`, background: over ? "var(--red)" : open ? "var(--accent)" : "var(--green)" }} />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="cal-week" key={`w${n}`} style={{ animation: slide }}>
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(ws, i);
                const b = cellBase(d, true);
                return (
                  <div key={d} className={`${b.cls} wk`} onClick={() => pick(d)}>
                    <div className="cal-ct"><span className={b.num}>{Number(d.slice(8, 10))}</span>{b.isLaunch && <span className="cal-lt">가오픈</span>}</div>
                    {on(d).map((t) => {
                      const l = look(t);
                      return (
                        <div key={t.id} className={`cal-card ${l}`}>
                          <span className="tt">{t.title}</span>
                          <span className="mt"><i />{t.areaName}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <aside className="cal-day">
          <div className="cal-dh" key={`d${sn}`} style={{ animation: sn ? `${sn % 2 ? "detA" : "detB"} .3s var(--ease) backwards` : undefined }}>
            <span className="tt">{dayTitle}</span><span className="ct">{dayList.length}건</span>
            {sel === launch && <span className="lt">가오픈</span>}
          </div>
          <div className="cal-dl">
            {dayList.map((t, i) => {
              const l = look(t);
              return (
                <div key={t.id} className={`cal-row ${l}`} style={{ animation: `rowIn ${t.id === newId ? ".35s" : `.3s var(--ease) ${(i * 0.04).toFixed(2)}s`} backwards` }}>
                  <button type="button" className={`ed-check${t.status === "done" ? " on" : ""}`} aria-pressed={t.status === "done"}
                          aria-label={t.status === "done" ? "완료 취소" : "완료"} onClick={() => void toggle(t)}>{t.status === "done" ? "✓" : ""}</button>
                  <Link href={`/v3/calendar?task=${t.id}`} scroll={false} className="cal-rb">
                    <span className="tt">{t.title}</span>
                    <span className="mt"><i />{t.areaName} · {t.assigneeName ?? "담당 없음"}</span>
                  </Link>
                </div>
              );
            })}
            {!dayList.length && <div className="cal-empty">일정 없음</div>}
          </div>
          <div className="cal-df">
            <div className="cal-in">
              <span>+</span>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="이 날 업무 · Enter" aria-label="이 날 업무"
                     onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void add(); } }} />
            </div>
            <Link href="/v3/tasks?due=none" className="cal-nd">기한 없음 {noDue}건<span>→</span></Link>
          </div>
        </aside>
      </div>
      {toast}
    </>
  );
}
