"use client";

// 팀 타임라인 — 주간 날짜 일정표(캘린더 그리드).
// 좌측 고정 lane 열(팀 공통 + 팀원) + 상단 날짜 축. 업무는 마감일 칸에 얇은 상태색 바로 표시.
// 일=오늘 1열 / 주=요일 7열(기본) / 월=주별 요약 열. 오늘 열 강조. 팀 공통 등록 lead 전용.
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lane, LaneEvent } from "@/lib/home";
import { openTaskPanel } from "@/lib/task-panel";

export type TimelineView = "day" | "week" | "month";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const MAX_BAR = 3; // 한 칸 최대 표시 바 (초과 시 +n)

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function weekStartOf(dateStr: string): string {
  const dow = (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7; // 월요일 기준
  return addDays(dateStr, -dow);
}
function monthStartOf(dateStr: string): string {
  return dateStr.slice(0, 8) + "01";
}
function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
export function rangeFor(view: TimelineView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: addDays(anchor, 1) };
  if (view === "week") {
    const start = weekStartOf(anchor);
    return { from: start, to: addDays(start, 7) };
  }
  const start = monthStartOf(anchor);
  return { from: start, to: addDays(start, daysInMonth(anchor)) };
}

interface Col { key: string; top: string; bot: string; isToday: boolean; from: string; to: string }

function columnsFor(view: TimelineView, anchor: string, today: string): Col[] {
  if (view === "day") {
    const dow = DOW[(new Date(`${anchor}T00:00:00Z`).getUTCDay() + 6) % 7];
    return [{ key: anchor, top: dow, bot: anchor.slice(5).replace("-", "."), isToday: anchor === today, from: anchor, to: anchor }];
  }
  if (view === "month") {
    const mStart = monthStartOf(anchor);
    const monthEnd = addDays(mStart, daysInMonth(anchor) - 1);
    const cols: Col[] = [];
    let idx = 1;
    for (let d = weekStartOf(mStart); d <= monthEnd; d = addDays(d, 7)) {
      const wEnd = addDays(d, 6);
      cols.push({ key: d, top: `${idx}주`, bot: `${d.slice(8)}–${wEnd.slice(8)}`, isToday: today >= d && today <= wEnd, from: d, to: wEnd });
      idx++;
    }
    return cols;
  }
  const from = weekStartOf(anchor);
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(from, i);
    return { key: d, top: DOW[i], bot: d.slice(8), isToday: d === today, from: d, to: d };
  });
}

const AVATAR_GRADIENTS = [
  "linear-gradient(140deg,var(--edu),var(--play))",
  "linear-gradient(140deg,var(--play),#C084FC)",
  "linear-gradient(140deg,var(--train),var(--edu))",
  "linear-gradient(140deg,var(--team),var(--edu))",
];

interface GridItem { id: string; taskId: number | null; title: string; status: string; late: boolean; day: string }
interface GridLane { key: string; name: string; isCommon: boolean; actorId: number; grad?: string; assistantStatus: Lane["assistantStatus"]; items: GridItem[] }

export default function TeamTimeline({
  lanes,
  initialEvents,
  today,
  view,
  anchor,
  isLead,
  onEmptyCreate,
}: {
  lanes: Lane[];
  initialEvents: LaneEvent[];
  today: string;
  view: TimelineView;
  anchor: string;
  isLead: boolean;
  expanded?: boolean;
  onEmptyCreate?: (opts: { actorId: number; date: string }) => void;
}) {
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const isInitialRange = view === "day" && anchor === today;
  const [fetched, setFetched] = useState<LaneEvent[] | null>(null);
  const [openCells, setOpenCells] = useState<Set<string>>(new Set());
  const toggleCell = (k: string) =>
    setOpenCells((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

  // 팀 공통 일정 — 표시 범위(주/월)로 조회 (오늘 일 뷰는 서버 데이터 재사용)
  useEffect(() => {
    if (isInitialRange) { setFetched(null); return; }
    let alive = true;
    fetch(`/api/events?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((data) => alive && setFetched(data.events ?? []))
      .catch(() => alive && setFetched([]));
    return () => { alive = false; };
  }, [range.from, range.to, isInitialRange]);

  const events = fetched ?? initialEvents;
  const teamEvents = events.filter((e) => e.isTeam);
  const cols = useMemo(() => columnsFor(view, anchor, today), [view, anchor, today]);

  const gridLanes: GridLane[] = [
    {
      key: "common", name: "팀 공통", isCommon: true, actorId: 0, assistantStatus: "idle",
      items: teamEvents.map((e) => ({ id: `e${e.id}`, taskId: null, title: e.title, status: "event", late: false, day: e.startAt.slice(0, 10) })),
    },
    ...lanes.map((l, i) => ({
      key: `m${l.actorId}`, name: l.name, isCommon: false, actorId: l.actorId, grad: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], assistantStatus: l.assistantStatus,
      items: l.tasks.filter((t) => t.dueDate).map((t) => ({ id: `t${t.id}`, taskId: t.id, title: t.title, status: t.status, late: t.late, day: t.dueDate as string })),
    })),
  ];

  const taskCount = lanes.reduce((s, l) => s + l.tasks.length, 0);

  return (
    <section className="card cal acc-blue" aria-label="팀 타임라인">
      <div className="ch">
        <h2>팀 타임라인</h2>
        <span className="sub">공통 {teamEvents.length} · 업무 {taskCount}</span>
      </div>

      <div className="tlg-wrap">
        <div className="tlg" style={{ gridTemplateColumns: `104px repeat(${cols.length}, minmax(0, 1fr))` }}>
          {/* 헤더 행 — 좌상단 빈칸 + 날짜 축 */}
          <div className="tlg-corner" />
          {cols.map((c) => (
            <div className={`tlg-dh${c.isToday ? " today" : ""}`} key={c.key}>
              <span className="tlg-dow">{c.top}</span>
              <span className="tlg-date">{c.bot}</span>
            </div>
          ))}

          {/* lane 행 — 항상 4행(팀 공통 + 팀원) 노출 */}
          {gridLanes.map((lane) => (
            <Fragment key={lane.key}>
              <div className="tlg-lane-l">
                {lane.isCommon ? (
                  <span className="tlg-cico">공통</span>
                ) : (
                  <span className="av" style={{ background: lane.grad }}>{lane.name.slice(0, 1)}</span>
                )}
                <span className="tlg-lane-n">{lane.name}</span>
                {!lane.isCommon && lane.assistantStatus !== "idle" && (
                  <Link href="/assistant" className={`agdot ${lane.assistantStatus}`} title={lane.assistantStatus === "working" ? "에이전트 작동중" : "에이전트 보고 대기"} aria-label={lane.assistantStatus === "working" ? "에이전트 작동중" : "에이전트 보고 대기"} />
                )}
              </div>
              {cols.map((c) => {
                const items = lane.items.filter((it) => it.day >= c.from && it.day <= c.to);
                const ck = `${lane.key}|${c.key}`;
                const open = openCells.has(ck);
                const shown = open ? items : items.slice(0, MAX_BAR);
                const hidden = items.length - shown.length;
                return (
                  <div className={`tlg-cell${c.isToday ? " today" : ""}`} key={c.key}>
                    {shown.map((it) => (
                      <button
                        key={it.id}
                        className={`tlg-bar st-${it.status}${it.late ? " late" : ""}`}
                        onClick={it.taskId ? () => openTaskPanel(it.taskId as number) : undefined}
                        disabled={!it.taskId}
                        title={it.title}
                      >
                        {it.title}
                      </button>
                    ))}
                    {hidden > 0 && (
                      <button className="tlg-more" onClick={() => toggleCell(ck)}>+{hidden}</button>
                    )}
                    {open && items.length > MAX_BAR && (
                      <button className="tlg-more" onClick={() => toggleCell(ck)}>접기</button>
                    )}
                    {/* 빈칸 추가 — 팀 공통은 lead 전용, 팀원 칸은 담당 지정 추가(캘린더). 홈은 onEmptyCreate 없음(읽기전용) */}
                    {onEmptyCreate && (lane.isCommon ? isLead : true) && (
                      <button
                        className="tlg-add"
                        onClick={() => onEmptyCreate({ actorId: lane.actorId, date: c.from })}
                        title={lane.isCommon ? "공통 일정 추가" : `${lane.name} 업무 추가`}
                        aria-label={lane.isCommon ? "공통 일정 추가" : `${lane.name} 업무 추가`}
                      >
                        ＋
                      </button>
                    )}
                  </div>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>

      <div className="cf">
        {isLead ? (
          <Link className="lk" href="/members">＋ 팀원 추가</Link>
        ) : (
          <span />
        )}
        <span className="tl-legend">마감일 기준 · 오늘 열 강조</span>
      </div>
    </section>
  );
}
