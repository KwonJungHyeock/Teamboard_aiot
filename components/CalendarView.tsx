"use client";

// 캘린더 — 월 달력형(7열 일~토 그리드) 기본. 날짜별 업무 pill, 오늘 강조·주말 구분,
// 날짜 클릭 → 그 날짜로 빠른 생성. 일/주 토글은 기존 간트(TeamTimeline) 재사용.
import { useMemo, useState } from "react";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import TeamTimeline, { type TimelineView } from "./TeamTimeline";
import { openTaskPanel } from "@/lib/task-panel";
import { openQuickCreate } from "@/lib/quick";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const MONTH_MAX_PILL = 3;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}
function monthMatrix(anchor: string): string[] {
  const first = anchor.slice(0, 8) + "01";
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay(); // 0=일
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

interface Pill { id: number; title: string; status: string; late: boolean; colorKey: string | null }

export default function CalendarView({ summary, user }: { summary: HomeSummary; user: SessionUser }) {
  const [view, setView] = useState<TimelineView>("month");
  const [anchor, setAnchor] = useState(summary.today);

  function move(direction: -1 | 1) {
    if (view === "day") setAnchor(addDays(anchor, direction));
    else if (view === "week") setAnchor(addDays(anchor, direction * 7));
    else setAnchor(addMonths(anchor, direction));
  }

  // 날짜별 업무 pill (마감일 기준). lanes 전체 task를 날짜로 묶는다.
  const byDate = useMemo(() => {
    const map = new Map<string, Pill[]>();
    for (const lane of summary.lanes) {
      for (const t of lane.tasks) {
        if (!t.dueDate) continue;
        const arr = map.get(t.dueDate) ?? [];
        arr.push({ id: t.id, title: t.title, status: t.status, late: t.late, colorKey: t.colorKey });
        map.set(t.dueDate, arr);
      }
    }
    return map;
  }, [summary.lanes]);

  const cells = useMemo(() => monthMatrix(anchor), [anchor]);
  const curMonth = anchor.slice(0, 7);
  const label = `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`;

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">워크스페이스 / <b>캘린더</b></div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">CALENDAR</div>
            <h1>캘린더</h1>
            <p>일정 {summary.eventCount}건 · 열린 업무 {summary.taskCount}건 · 날짜를 클릭해 바로 추가</p>
          </div>
          <div className="head-r">
            <span className="cal-mo num">{label}</span>
            <div className="seg" role="group" aria-label="기간 이동">
              <button onClick={() => move(-1)} aria-label="이전">‹</button>
              <button aria-pressed={anchor === summary.today} onClick={() => setAnchor(summary.today)}>오늘</button>
              <button onClick={() => move(1)} aria-label="다음">›</button>
            </div>
            <div className="seg" role="group" aria-label="기간 보기">
              {(["day", "week", "month"] as TimelineView[]).map((v) => (
                <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "day" ? "일" : v === "week" ? "주" : "월"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {view === "month" ? (
          <section className="tile cal-tile" aria-label="월 달력">
            <div className="cal-dow">
              {DOW.map((d, i) => <div key={d} className={`cal-dowc${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{d}</div>)}
            </div>
            <div className="cal-grid">
              {cells.map((date) => {
                const inMonth = date.slice(0, 7) === curMonth;
                const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
                const isToday = date === summary.today;
                const pills = byDate.get(date) ?? [];
                const shown = pills.slice(0, MONTH_MAX_PILL);
                return (
                  <div
                    key={date}
                    className={`cal-cell${inMonth ? "" : " out"}${dow === 0 || dow === 6 ? " wknd" : ""}${isToday ? " today" : ""}`}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest(".cal-pill")) return;
                      openQuickCreate({ x: e.clientX, y: e.clientY }, { dueDate: date });
                    }}
                  >
                    <div className="cal-cell-h">
                      <span className="cal-dnum num">{Number(date.slice(8))}</span>
                      <button className="cal-add" aria-label="이 날짜에 업무 추가" onClick={(e) => { e.stopPropagation(); openQuickCreate({ x: e.clientX, y: e.clientY }, { dueDate: date }); }}>＋</button>
                    </div>
                    <div className="cal-pills">
                      {shown.map((p) => (
                        <button
                          key={p.id}
                          className={`cal-pill st-${p.status}${p.late ? " late" : ""}`}
                          onClick={(e) => { e.stopPropagation(); openTaskPanel(p.id); }}
                          title={p.title}
                        >
                          <i className={`cal-pdot ${p.colorKey ?? "team"}`} />{p.title}
                        </button>
                      ))}
                      {pills.length > MONTH_MAX_PILL && <span className="cal-more">+{pills.length - MONTH_MAX_PILL}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : (
          <TeamTimeline
            lanes={summary.lanes}
            initialEvents={summary.events}
            today={summary.today}
            view={view}
            anchor={anchor}
            isLead={user.role === "lead"}
            onAnchorChange={setAnchor}
            onEmptyCreate={({ actorId, date }) => openQuickCreate({ x: window.innerWidth / 2 - 160, y: 160 }, { assigneeId: actorId, dueDate: date })}
          />
        )}
      </div>
    </div>
  );
}
