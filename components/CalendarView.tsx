"use client";

// 캘린더 (축2 스케줄 관리) — 월/주 그리드 + 다일 연속 스팬 막대 + 드래그 재조정.
// 날짜는 공용 taskDays()(KST date-only, inclusive) 단일 소스 — 오프바이원 금지.
// C1 드래그: 막대 본체=일정 이동(기간 유지), 양끝 핸들=시작/종료 조정. 낙관적 저장 + 토스트 + 실행취소.
// C2 우선순위: 좌측 인디케이터 클릭 → 드롭다운 즉시 변경. C3 마감 임박: 우측 코랄 캡.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HomeSummary, LaneTask } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import { openTaskPanel, notifyTaskUpdated } from "@/lib/task-panel";
import { openQuickCreate, toast } from "@/lib/quick";
import { taskDays, dateAddDays, dateDiffDays } from "@/lib/task-view";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_ROWS_MONTH = 3;
const MAX_ROWS_WEEK = 8;

function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}
function sundayOf(dateStr: string): string {
  const dow = new Date(`${dateStr}T00:00:00Z`).getUTCDay(); // 0=일
  return dateAddDays(dateStr, -dow);
}
function areaColor(ck: string | null): string {
  switch (ck) {
    case "play": case "purple": return "var(--purple)";
    case "train": case "teal": return "var(--teal)";
    case "green": return "var(--green)";
    case "amber": return "var(--amber)";
    case "team": return "var(--slate)";
    case "edu": case "blue": default: return "var(--blue)";
  }
}
const PRIO = { high: { label: "높음", color: "var(--coral)" }, mid: { label: "보통", color: "var(--slate)" }, low: { label: "낮음", color: "var(--hair)" } } as const;
function md(date: string) { return `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`; }

type CalTask = Pick<LaneTask, "id" | "title" | "startDate" | "dueDate" | "status" | "priority" | "progress"> & { colorKey: string | null; assigneeName: string | null };

// 한 주(7일) 안의 막대 세그먼트 — 열/폭 + 실제 시작/끝 여부 + 스택 행
interface Seg { task: CalTask; col: number; span: number; isStart: boolean; isEnd: boolean; row: number; s: string; e: string }

function flatten(lanes: HomeSummary["lanes"]): CalTask[] {
  const out: CalTask[] = [];
  for (const l of lanes) for (const t of l.tasks) {
    out.push({ id: t.id, title: t.title, startDate: t.startDate, dueDate: t.dueDate, status: t.status, priority: t.priority, progress: t.progress, colorKey: t.areaColorKey ?? t.colorKey, assigneeName: t.assigneeName });
  }
  return out;
}

export default function CalendarView({ summary, user }: { summary: HomeSummary; user: SessionUser }) {
  void user;
  const today = summary.today;
  const [view, setView] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(today);
  const [tasks, setTasks] = useState<CalTask[]>(() => flatten(summary.lanes));
  // 서버 데이터 변경(재조회) 반영
  useEffect(() => { setTasks(flatten(summary.lanes)); }, [summary.lanes]);
  // 외부(패널 등)에서 업무 변경 시 재조회
  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks`);
      const data = await res.json();
      if (res.ok && Array.isArray(data.tasks)) {
        setTasks(data.tasks.filter((t: any) => ["todo", "doing", "review"].includes(t.status)).map((t: any) => ({
          id: t.id, title: t.title, startDate: t.startDate, dueDate: t.dueDate, status: t.status,
          priority: t.priority, progress: t.progress ?? 0, colorKey: t.areaColorKey ?? t.colorKey ?? null, assigneeName: t.assigneeName ?? null,
        })));
      }
    } catch { /* noop */ }
  }, []);
  useEffect(() => {
    const on = () => reload();
    window.addEventListener("tb:task-updated", on);
    return () => window.removeEventListener("tb:task-updated", on);
  }, [reload]);

  const [overflow, setOverflow] = useState<{ date: string; x: number; y: number } | null>(null);
  const [prioMenu, setPrioMenu] = useState<{ id: number; x: number; y: number } | null>(null);

  function move(dir: -1 | 1) {
    if (view === "week") setAnchor(dateAddDays(anchor, dir * 7));
    else setAnchor(addMonths(anchor, dir));
  }

  const weeks = useMemo(() => {
    if (view === "week") return [sundayOf(anchor)];
    const first = anchor.slice(0, 8) + "01";
    const start = sundayOf(first);
    return Array.from({ length: 6 }, (_, i) => dateAddDays(start, i * 7));
  }, [view, anchor]);
  const curMonth = anchor.slice(0, 7);
  const label = `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`;

  // ── 낙관적 재조정 (드래그/우선순위) ──
  async function patchTask(id: number, body: Record<string, unknown>, prev: CalTask, undoMsg?: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!res || !res.ok) {
      setTasks((cur) => cur.map((t) => (t.id === id ? prev : t))); // 롤백
      toast("변경에 실패해 되돌렸어요", "err");
      return;
    }
    notifyTaskUpdated();
    if (undoMsg) {
      undoRef.current = { id, prev };
      toast(undoMsg + " · 실행취소하려면 눌러 알림", "ok");
    }
  }
  const undoRef = useRef<{ id: number; prev: CalTask } | null>(null);

  function applyReschedule(t: CalTask, newStart: string, newEnd: string, mode: "move" | "start" | "end") {
    const prev = t;
    const nt: CalTask = { ...t, startDate: newStart, dueDate: newEnd };
    setTasks((cur) => cur.map((x) => (x.id === t.id ? nt : x)));
    const body = mode === "start" ? { startDate: newStart } : mode === "end" ? { dueDate: newEnd } : { startDate: newStart, dueDate: newEnd };
    const from = taskDays(prev), to = taskDays(nt);
    const msg = from && to ? `${t.title.slice(0, 14)} 일정 ${md(from.start)}~${md(from.end)} → ${md(to.start)}~${md(to.end)}로 변경됨` : "일정 변경됨";
    patchTask(t.id, body, prev, msg);
  }

  function setPriority(id: number, p: "high" | "mid" | "low") {
    setPrioMenu(null);
    const t = tasks.find((x) => x.id === id);
    if (!t || t.priority === p) return;
    const prev = t;
    setTasks((cur) => cur.map((x) => (x.id === id ? { ...x, priority: p } : x)));
    patchTask(id, { priority: p }, prev);
    toast(`우선순위 → ${PRIO[p].label}`);
  }

  return (
    <div className="hv" onClick={() => { setOverflow(null); setPrioMenu(null); }}>
      <div className="top"><div className="crumb">워크스페이스 / <b>캘린더</b></div><span className="sp" /></div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">CALENDAR</div>
            <h1>캘린더</h1>
            <p>드래그로 일정을 옮기고, 양끝을 끌어 기간을 조정하세요 · 날짜를 클릭하면 바로 추가</p>
          </div>
          <div className="head-r">
            <div className="cal-nav">
              <button className="nb" onClick={() => move(-1)} aria-label="이전">‹</button>
              <span className="cal-mo num">{label}</span>
              <button className="nb" onClick={() => move(1)} aria-label="다음">›</button>
              <button className="tbtn" onClick={() => setAnchor(today)}>오늘</button>
            </div>
            <div className="seg" role="group" aria-label="기간 보기">
              <button aria-pressed={view === "month"} onClick={() => setView("month")}>월</button>
              <button aria-pressed={view === "week"} onClick={() => setView("week")}>주</button>
            </div>
            <button className="btn-brand cal-new" onClick={(e) => openQuickCreate({ x: e.clientX - 300, y: e.clientY + 10 }, { dueDate: today })}>＋ 새 업무</button>
          </div>
        </div>

        <section className={`tile cal2 ${view}`} aria-label={view === "month" ? "월 달력" : "주 달력"}>
          <div className="cal2-dow">
            {DOW.map((d, i) => <div key={d} className={`cal2-dowc${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{d}</div>)}
          </div>
          <div className="cal2-body">
            {weeks.map((ws) => (
              <WeekRow
                key={ws} weekStart={ws} tasks={tasks} today={today} curMonth={curMonth} view={view}
                onCreate={(date, x, y) => openQuickCreate({ x, y }, { startDate: date, dueDate: date })}
                onOpen={(id) => openTaskPanel(id)}
                onReschedule={applyReschedule}
                onOverflow={(date, x, y) => setOverflow({ date, x, y })}
                onPrio={(id, x, y) => setPrioMenu({ id, x, y })}
              />
            ))}
          </div>
        </section>
      </div>

      {/* +N 그날 목록 팝오버 */}
      {overflow && (
        <div className="cal2-pop" style={{ left: Math.min(overflow.x, window.innerWidth - 280), top: overflow.y }} onClick={(e) => e.stopPropagation()}>
          <div className="cal2-pop-h">{md(overflow.date)} 업무</div>
          {tasks.filter((t) => { const d = taskDays(t); return d && overflow.date >= d.start && overflow.date <= d.end; }).map((t) => (
            <button key={t.id} className="cal2-pop-i" onClick={() => { setOverflow(null); openTaskPanel(t.id); }}>
              <i style={{ background: areaColor(t.colorKey) }} />{t.title}
            </button>
          ))}
        </div>
      )}

      {/* 우선순위 드롭다운 */}
      {prioMenu && (
        <div className="cal2-prio" style={{ left: Math.min(prioMenu.x, window.innerWidth - 130), top: prioMenu.y }} onClick={(e) => e.stopPropagation()} role="menu">
          {(["high", "mid", "low"] as const).map((p) => (
            <button key={p} role="menuitem" onClick={() => setPriority(prioMenu.id, p)}>
              <i style={{ background: PRIO[p].color }} />{PRIO[p].label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── 한 주(7일) 행 — 배경 셀 + 스팬 막대 오버레이 + 드래그 ──
function WeekRow({
  weekStart, tasks, today, curMonth, view, onCreate, onOpen, onReschedule, onOverflow, onPrio,
}: {
  weekStart: string; tasks: CalTask[]; today: string; curMonth: string; view: "month" | "week";
  onCreate: (date: string, x: number, y: number) => void;
  onOpen: (id: number) => void;
  onReschedule: (t: CalTask, newStart: string, newEnd: string, mode: "move" | "start" | "end") => void;
  onOverflow: (date: string, x: number, y: number) => void;
  onPrio: (id: number, x: number, y: number) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: number; mode: "move" | "start" | "end"; deltaDays: number } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => dateAddDays(weekStart, i));
  const weekEnd = days[6];
  const maxRows = view === "week" ? MAX_ROWS_WEEK : MAX_ROWS_MONTH;

  // 이 주에 걸치는 업무 → 세그먼트 + 그리디 스택 행 배정
  const { segs, hiddenByDay } = useMemo(() => {
    const raw: Omit<Seg, "row">[] = [];
    for (const t of tasks) {
      const d = taskDays(t);
      if (!d) continue;
      if (d.end < weekStart || d.start > weekEnd) continue;
      const cs = d.start < weekStart ? weekStart : d.start;
      const ce = d.end > weekEnd ? weekEnd : d.end;
      raw.push({ task: t, col: dateDiffDays(cs, weekStart), span: dateDiffDays(ce, cs) + 1, isStart: d.start >= weekStart, isEnd: d.end <= weekEnd, s: d.start, e: d.end });
    }
    // 시작 열·긴 것 우선 정렬 후 겹치지 않는 행에 배치
    raw.sort((a, b) => a.col - b.col || b.span - a.span || a.task.id - b.task.id);
    const rowEnds: number[] = [];
    const placed: Seg[] = [];
    const hidden: Record<string, number> = {};
    for (const s of raw) {
      let r = rowEnds.findIndex((end) => end <= s.col);
      if (r === -1) { r = rowEnds.length; rowEnds.push(0); }
      rowEnds[r] = s.col + s.span;
      if (r < maxRows) placed.push({ ...s, row: r });
      else for (let c = s.col; c < s.col + s.span; c++) { const dd = dateAddDays(weekStart, c); hidden[dd] = (hidden[dd] ?? 0) + 1; }
    }
    return { segs: placed, hiddenByDay: hidden };
  }, [tasks, weekStart, weekEnd, maxRows]);

  // ── 드래그 (pointer: 마우스+터치) ──
  const dragInfo = useRef<{ id: number; mode: "move" | "start" | "end"; startX: number; cellW: number; t: CalTask } | null>(null);
  function onPointerDown(e: React.PointerEvent, t: CalTask, mode: "move" | "start" | "end") {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    // 본체 이동은 핸들·우선순위 인디케이터에서 시작된 경우 무시(그 요소가 처리)
    if (mode === "move" && (e.target as HTMLElement).closest(".cal2-h, .cal2-prio-i")) return;
    e.preventDefault(); e.stopPropagation();
    const rect = rowRef.current!.getBoundingClientRect();
    dragInfo.current = { id: t.id, mode, startX: e.clientX, cellW: rect.width / 7, t };
    setDrag({ id: t.id, mode, deltaDays: 0 });
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }
  function onMove(e: PointerEvent) {
    const info = dragInfo.current; if (!info) return;
    const delta = Math.round((e.clientX - info.startX) / info.cellW);
    setDrag((d) => (d ? { ...d, deltaDays: delta } : d));
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    const info = dragInfo.current; const d = drag ?? readDrag();
    dragInfo.current = null; setDrag(null);
    if (!info) return;
    const delta = d?.deltaDays ?? 0;
    const range = taskDays(info.t); if (!range) return;
    if (delta === 0) { onOpen(info.id); return; } // 이동 없음 = 클릭
    if (info.mode === "move") onReschedule(info.t, dateAddDays(range.start, delta), dateAddDays(range.end, delta), "move");
    else if (info.mode === "start") { const ns = dateAddDays(range.start, delta); if (ns <= range.end) onReschedule(info.t, ns, range.end, "start"); }
    else { const ne = dateAddDays(range.end, delta); if (ne >= range.start) onReschedule(info.t, range.start, ne, "end"); }
  }
  // drag state 최신값 참조(closure)
  const dragStateRef = useRef(drag); dragStateRef.current = drag;
  function readDrag() { return dragStateRef.current; }

  // 키보드 재조정
  function onKey(e: React.KeyboardEvent, t: CalTask) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const dir = e.key === "ArrowLeft" ? -1 : 1;
    const range = taskDays(t); if (!range) return;
    if (e.shiftKey) { const ne = dateAddDays(range.end, dir); if (ne >= range.start) onReschedule(t, range.start, ne, "end"); }
    else onReschedule(t, dateAddDays(range.start, dir), dateAddDays(range.end, dir), "move");
  }

  const rowH = view === "week" ? 26 : 23;
  const bodyH = view === "week" ? 520 : Math.max(96, 30 + maxRows * rowH + 16);

  return (
    <div className="cal2-week" style={{ height: bodyH }}>
      {/* 배경 셀 */}
      <div className="cal2-cells">
        {days.map((date) => {
          const inMonth = date.slice(0, 7) === curMonth;
          const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
          const isToday = date === today;
          const hid = hiddenByDay[date] ?? 0;
          return (
            <div key={date} className={`cal2-cell${inMonth || view === "week" ? "" : " out"}${dow === 0 || dow === 6 ? " wknd" : ""}`}
              onClick={(e) => { if ((e.target as HTMLElement).closest(".cal2-bar")) return; onCreate(date, e.clientX, e.clientY); }}>
              <div className="cal2-dnum-row">
                <span className={`cal2-dnum num${isToday ? " today" : ""}${dow === 0 ? " sun" : dow === 6 ? " sat" : ""}`}>{Number(date.slice(8))}</span>
                <button className="cal2-add" aria-label={`${md(date)}에 추가`} onClick={(e) => { e.stopPropagation(); onCreate(date, e.clientX, e.clientY); }}>＋</button>
              </div>
              {hid > 0 && <button className="cal2-more" onClick={(e) => { e.stopPropagation(); onOverflow(date, e.clientX, e.clientY); }}>+{hid}</button>}
            </div>
          );
        })}
      </div>

      {/* 스팬 막대 오버레이 */}
      <div className="cal2-bars" ref={rowRef}>
        {segs.map((s) => {
          const t = s.task;
          const dd = drag && drag.id === t.id ? drag.deltaDays : 0;
          const late = !!t.dueDate && t.dueDate.slice(0, 10) < today && t.status !== "done";
          const dueSoon = !!t.dueDate && t.dueDate.slice(0, 10) >= today && t.dueDate.slice(0, 10) <= dateAddDays(today, 2) && t.status !== "done";
          const col = areaColor(t.colorKey);
          const left = `calc(${(s.col / 7) * 100}% + ${dd * (100 / 7)}%)`;
          const width = `calc(${(s.span / 7) * 100}% - 4px)`;
          return (
            <div
              key={t.id + "@" + s.col}
              className={`cal2-bar${s.isStart ? " s-start" : ""}${s.isEnd ? " s-end" : ""}${drag?.id === t.id ? " dragging" : ""}`}
              style={{ left, width, top: 30 + s.row * rowH, background: `color-mix(in srgb, ${col} 16%, var(--card))`, borderColor: `color-mix(in srgb, ${col} 40%, var(--card))` }}
              role="button" tabIndex={0} title={`${t.title}${t.assigneeName ? ` · ${t.assigneeName}` : ""} · ${s.s.slice(5)}~${s.e.slice(5)}${late ? " · 지연" : dueSoon ? " · 마감 임박" : ""}  (드래그로 이동, 양끝으로 기간, ←/→ 키)`}
              onPointerDown={(e) => onPointerDown(e, t, "move")}
              onKeyDown={(e) => onKey(e, t)}
            >
              {/* 우선순위 인디케이터 */}
              <span className={`cal2-prio-i p-${t.priority}`} style={{ background: PRIO[(t.priority as keyof typeof PRIO)] ? PRIO[t.priority as keyof typeof PRIO].color : "var(--slate)" }}
                role="button" aria-label="우선순위 변경"
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPrio(t.id, e.clientX, e.clientY); }} />
              {s.isStart && <span className="cal2-led" style={{ background: col }} />}
              <span className="cal2-bar-t">{t.title}</span>
              {(late || dueSoon) && <i className="cal2-cap" aria-hidden="true" />}
              {/* 리사이즈 핸들 */}
              {s.isStart && <span className="cal2-h l" onPointerDown={(e) => onPointerDown(e, t, "start")} aria-hidden="true" />}
              {s.isEnd && <span className="cal2-h r" onPointerDown={(e) => onPointerDown(e, t, "end")} aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
