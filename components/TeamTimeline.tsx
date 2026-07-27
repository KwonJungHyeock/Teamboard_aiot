"use client";

// 팀 타임라인 — 간트 스타일 (파트 6). 각 업무를 시작일→마감일 가로 바로, 날짜 축에 실제 기간만큼 배치.
// 사람별 레인(팀 공통 최상단). 바 색=상태 의미색, 바 안에 진행률(%)만큼 채움. 오늘 세로선·주말 음영·지난 마감 코랄.
// 일/주/월 줌. 바 제목 truncate, hover 툴팁(기간·담당·진행률). 색 절제(상태색만), chartjunk 없음.
import { Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lane, LaneEvent } from "@/lib/home";
import { openTaskPanel } from "@/lib/task-panel";

export type TimelineView = "day" | "week" | "month";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];

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
function diffDays(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000
  );
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

interface DayMeta { date: string; dowIdx: number; weekend: boolean; isToday: boolean; label: string | null }

function buildDays(view: TimelineView, from: string, n: number, today: string): DayMeta[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(from, i);
    const dowIdx = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    let label: string | null = null;
    if (view === "week" || view === "day") label = `${DOW[dowIdx]} ${date.slice(8)}`;
    else if (dowIdx === 0 || i === 0) label = `${Number(date.slice(5, 7))}/${date.slice(8)}`; // 월: 주 시작만
    return { date, dowIdx, weekend: dowIdx >= 5, isToday: date === today, label };
  });
}

const AVATAR_GRADIENTS = [
  "linear-gradient(140deg,var(--edu),var(--play))",
  "linear-gradient(140deg,var(--play),#C084FC)",
  "linear-gradient(140deg,var(--train),var(--edu))",
  "linear-gradient(140deg,var(--team),var(--edu))",
];

interface Bar {
  id: string; taskId: number | null; title: string; status: string; late: boolean;
  progress: number; startIdx: number; span: number; range: string; assignee: string;
}
interface GLane { key: string; name: string; isCommon: boolean; grad?: string; assistantStatus: Lane["assistantStatus"]; bars: Bar[] }

export default function TeamTimeline({
  lanes, initialEvents, today, view, anchor,
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
  const n = Math.max(1, diffDays(range.to, range.from));
  const isInitialRange = view === "day" && anchor === today;
  const [fetched, setFetched] = useState<LaneEvent[] | null>(null);

  // 팀 공통 일정 — 표시 범위로 조회 (오늘 일 뷰는 서버 데이터 재사용)
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
  const days = useMemo(() => buildDays(view, range.from, n, today), [view, range.from, n, today]);
  const lastIdx = n - 1;

  // 업무 → 바 (시작~마감을 범위로 클램프). 시작·마감 한쪽만 있으면 점(1일)으로.
  function toBar(id: string, taskId: number | null, title: string, status: string, late: boolean, progress: number, start: string | null, due: string | null, assignee: string): Bar | null {
    const s = start ?? due;
    const e = due ?? start;
    if (!s || !e) return null;
    const si = diffDays(s, range.from);
    const ei = diffDays(e, range.from);
    if (ei < 0 || si > lastIdx) return null; // 범위 밖
    const startIdx = Math.max(0, si);
    const endIdx = Math.min(lastIdx, ei);
    const range2 = start && due ? `${start.slice(5)}~${due.slice(5)}` : (due ? `~${due.slice(5)}` : `${start!.slice(5)}~`);
    return { id, taskId, title, status, late, progress, startIdx, span: endIdx - startIdx + 1, range: range2, assignee };
  }

  const gridLanes: GLane[] = [
    {
      key: "common", name: "팀 공통", isCommon: true, assistantStatus: "idle",
      bars: teamEvents
        .map((e) => toBar(`e${e.id}`, null, e.title, "event", false, 0, e.startAt.slice(0, 10), e.endAt.slice(0, 10), "팀 공통"))
        .filter((b): b is Bar => !!b),
    },
    ...lanes.map((l, i) => ({
      key: `m${l.actorId}`, name: l.name, isCommon: false,
      grad: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length], assistantStatus: l.assistantStatus,
      bars: l.tasks
        .map((t) => toBar(`t${t.id}`, t.id, t.title, t.status, t.late, t.progress, t.startDate, t.dueDate, l.name))
        .filter((b): b is Bar => !!b),
    })),
  ];

  const taskCount = lanes.reduce((s, l) => s + l.tasks.length, 0);
  const pct = (i: number) => (i / n) * 100;

  return (
    <section className="card gt acc-blue" aria-label="팀 타임라인">
      <div className="ch">
        <h2>팀 타임라인</h2>
        <span className="sub">공통 {teamEvents.length} · 업무 {taskCount} · {view === "day" ? "일" : view === "week" ? "주" : "월"}</span>
      </div>

      <div className="gt-wrap">
        <div className="gt-grid">
          {/* 헤더 축 */}
          <div className="gt-corner" />
          <div className="gt-axis">
            {days.map((d, i) => (
              <div
                key={d.date}
                className={`gt-acol${d.weekend ? " wknd" : ""}${d.isToday ? " today" : ""}`}
                style={{ left: `${pct(i)}%`, width: `${100 / n}%` }}
              >
                {d.label && <span className="gt-alabel">{d.label}</span>}
              </div>
            ))}
            {today >= range.from && today < range.to && (
              <div className="gt-todayline" style={{ left: `${pct(diffDays(today, range.from) + 0.5)}%` }} aria-hidden="true" />
            )}
          </div>

          {/* 레인 */}
          {gridLanes.map((lane) => (
            <Fragment key={lane.key}>
              <div className="gt-lane-l">
                {lane.isCommon ? (
                  <span className="gt-cico">공통</span>
                ) : (
                  <span className="av" style={{ background: lane.grad }}>{lane.name.slice(0, 1)}</span>
                )}
                <span className="gt-lane-n">{lane.name}</span>
                {!lane.isCommon && lane.assistantStatus !== "idle" && (
                  <Link href="/assistant" className={`agdot ${lane.assistantStatus}`} title={lane.assistantStatus === "working" ? "에이전트 작동중" : "에이전트 보고 대기"} aria-label="에이전트 상태" />
                )}
              </div>
              <div className="gt-track">
                {/* 배경: 주말 음영 · 오늘 선 */}
                <div className="gt-bg" aria-hidden="true">
                  {days.map((d, i) => (
                    <div key={d.date} className={`gt-bgcol${d.weekend ? " wknd" : ""}${d.isToday ? " today" : ""}`} style={{ left: `${pct(i)}%`, width: `${100 / n}%` }} />
                  ))}
                  {today >= range.from && today < range.to && (
                    <div className="gt-todayline" style={{ left: `${pct(diffDays(today, range.from) + 0.5)}%` }} />
                  )}
                </div>
                {lane.bars.length === 0 ? (
                  <div className="gt-line gt-none">—</div>
                ) : (
                  lane.bars.map((b) => (
                    <div className="gt-line" key={b.id}>
                      <button
                        className={`gt-bar st-${b.status}${b.late ? " late" : ""}`}
                        style={{ left: `${pct(b.startIdx)}%`, width: `calc(${(b.span / n) * 100}% - 2px)` }}
                        onClick={b.taskId ? () => openTaskPanel(b.taskId as number) : undefined}
                        disabled={!b.taskId}
                        title={`${b.title} · ${b.assignee} · ${b.range} · 진행률 ${b.progress}%`}
                      >
                        {b.status !== "event" && b.status !== "done" && (
                          <i className="gt-fill" style={{ width: `${b.progress}%` }} aria-hidden="true" />
                        )}
                        <span className="gt-bar-t">{b.title}</span>
                      </button>
                    </div>
                  ))
                )}
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      <div className="cf">
        <span className="gt-legend">
          <i className="lg st-doing" />진행 <i className="lg st-todo" />대기 <i className="lg st-review" />리뷰 <i className="lg st-done" />완료 <i className="lg late" />지난 마감
        </span>
        <span className="tl-legend">시작~마감 기간 · 채움=진행률 · 세로선=오늘</span>
      </div>
    </section>
  );
}
