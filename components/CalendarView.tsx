"use client";

// 캘린더 (Phase 3) — 홈 팀 타임라인의 확대판. 동일 컴포넌트, 기간 이동 + 일·주·월 토글.
import { useState } from "react";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import TeamTimeline, { type TimelineView } from "./TeamTimeline";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return d.toISOString().slice(0, 10);
}

export default function CalendarView({
  summary,
  user,
}: {
  summary: HomeSummary;
  user: SessionUser;
}) {
  const [view, setView] = useState<TimelineView>("week");
  const [anchor, setAnchor] = useState(summary.today);

  function move(direction: -1 | 1) {
    if (view === "day") setAnchor(addDays(anchor, direction));
    else if (view === "week") setAnchor(addDays(anchor, direction * 7));
    else setAnchor(addMonths(anchor, direction));
  }

  const label =
    view === "month"
      ? anchor.slice(0, 7).replace("-", ".")
      : anchor.replace(/-/g, ".");

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>캘린더</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">{label}</div>
            <h1>캘린더</h1>
            <p>일정 {summary.eventCount}건 · 열린 업무 {summary.taskCount}건</p>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <div className="seg" role="group" aria-label="기간 이동">
              <button aria-pressed={false} onClick={() => move(-1)} aria-label="이전 기간">
                ←
              </button>
              <button aria-pressed={anchor === summary.today} onClick={() => setAnchor(summary.today)}>
                오늘
              </button>
              <button aria-pressed={false} onClick={() => move(1)} aria-label="다음 기간">
                →
              </button>
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

        <TeamTimeline
          lanes={summary.lanes}
          initialEvents={summary.events}
          today={summary.today}
          view={view}
          anchor={anchor}
          isLead={user.role === "lead"}
          expanded
        />
      </div>
    </div>
  );
}
