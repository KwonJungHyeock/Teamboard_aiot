"use client";

// 홈 대시보드 (Phase 3) — SPEC 4.1의 6요소를 프로토타입 레이아웃 그대로 조립.
// ③ "이번 달 목표 진척"은 SPEC 우선 규칙에 따라 프로토타입의 "프로젝트 진행" 자리를 대체.
import { useMemo, useState } from "react";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser, SignalType } from "@/lib/types";
import MetricCards from "./MetricCards";
import TaskTable from "./TaskTable";
import TeamTimeline, { type TimelineView } from "./TeamTimeline";

const SIGNAL_TABS: { key: "all" | SignalType; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "decision", label: "결정" },
  { key: "review", label: "확인" },
  { key: "memo", label: "메모" },
  { key: "risk", label: "리스크" },
];

function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false })
      .format(new Date())
  );
  if (hour < 6) return "늦은 밤이에요";
  if (hour < 12) return "좋은 아침이에요";
  if (hour < 18) return "좋은 오후예요";
  return "좋은 저녁이에요";
}

export default function HomeView({
  summary,
  user,
}: {
  summary: HomeSummary;
  user: SessionUser;
}) {
  const [view, setView] = useState<TimelineView>("day");
  const [signalTab, setSignalTab] = useState<"all" | SignalType>("all");

  const dateLabel = useMemo(() => {
    const d = new Date(`${summary.today}T00:00:00+09:00`);
    const dow = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay() === undefined ? 0 : new Date(`${summary.today}T12:00:00+09:00`).getDay()];
    return `${summary.today.replace(/-/g, ".")} ${dow}`;
  }, [summary.today]);

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: summary.signals.length };
    for (const tab of SIGNAL_TABS.slice(1)) {
      counts[tab.key] = summary.signals.filter((s) => s.type === tab.key).length;
    }
    return counts;
  }, [summary.signals]);

  const visibleSignals =
    signalTab === "all" ? summary.signals : summary.signals.filter((s) => s.type === signalTab);

  function openPalette() {
    window.dispatchEvent(new CustomEvent("tb:open-palette"));
  }

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>홈</b>
        </div>
        <span className="sp" />
        <button className="iconbtn" onClick={openPalette} aria-label="검색">
          <svg viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </button>
        <button className="newbtn" onClick={openPalette}>
          ＋ 새로 만들기
        </button>
      </div>

      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">{dateLabel} · 플랫폼팀</div>
            <h1>
              {greeting()}, {summary.greetingName || user.name}님
            </h1>
            <p>{summary.greetingSub}</p>
          </div>
          <div className="seg" role="group" aria-label="기간 보기">
            {(["day", "week", "month"] as TimelineView[]).map((v) => (
              <button
                key={v}
                aria-pressed={view === v}
                onClick={() => setView(v)}
              >
                {v === "day" ? "일" : v === "week" ? "주" : "월"}
              </button>
            ))}
          </div>
        </div>

        <MetricCards metrics={summary.metrics} />

        <div className="cols">
          <div className="stack">
            <TeamTimeline
              lanes={summary.lanes}
              initialEvents={summary.events}
              today={summary.today}
              view={view}
              anchor={summary.today}
              isLead={user.role === "lead"}
            />
            <TaskTable rows={summary.dueSoon} />
          </div>

          <div className="stack">
            {/* 이번 달 목표 진척 (SPEC 4.1 ③) */}
            <section className="card" aria-label="이번 달 목표">
              <div className="ch">
                <h2>이번 달 목표</h2>
                <span className="sub">{summary.monthGoals.length}개</span>
              </div>
              {summary.monthGoals.length === 0 && (
                <p style={{ color: "var(--lo)", fontSize: 12 }}>
                  이번 달 목표가 없습니다. 목표 화면에서 추가하세요.
                </p>
              )}
              {summary.monthGoals.map((goal) => (
                <div className="pr" key={goal.id}>
                  <div className="pr-t">
                    <span>{goal.title}</span>
                    <span>{goal.progress === null ? "-" : `${goal.progress}%`}</span>
                  </div>
                  <div className="bar">
                    <i
                      className={goal.colorKey ?? "edu"}
                      style={{ width: `${Math.min(goal.progress ?? 0, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </section>

            {/* 프로젝트 진행 — 구 관제뷰 "프로젝트별 진행률" 흡수 (발주 지시: 목표 다음 카드) */}
            <section className="card" aria-label="프로젝트 진행">
              <div className="ch">
                <h2>프로젝트 진행</h2>
                <span className="sub">W{summary.isoWeek}</span>
              </div>
              {summary.projectProgress.map((project) => (
                <div className="pr" key={project.id}>
                  <div className="pr-t">
                    <span>{project.name}</span>
                    <span>
                      {project.percent === null ? "-" : `${project.percent}%`}
                      {project.total > 0 && (
                        <span style={{ color: "var(--lo)", marginLeft: 6 }}>
                          {project.done}/{project.total}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="bar">
                    <i
                      className={project.colorKey ?? "edu"}
                      style={{ width: `${Math.min(project.percent ?? 0, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </section>

            {/* 시그널 패널 (타입 필터, 정체 상단 고정 — 서버 정렬) */}
            <section className="card" aria-label="시그널">
              <div className="ch">
                <h2>시그널</h2>
                <span className="sub">정체 {summary.stalledCount}</span>
              </div>
              <div className="tabs" role="group" aria-label="시그널 필터">
                {SIGNAL_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    className="tab"
                    aria-pressed={signalTab === tab.key}
                    onClick={() => setSignalTab(tab.key)}
                  >
                    {tab.label}
                    <span className="n">{tabCounts[tab.key] ?? 0}</span>
                  </button>
                ))}
              </div>
              <div>
                {visibleSignals.length === 0 && (
                  <p style={{ color: "var(--lo)", fontSize: 12, padding: "8px 0" }}>
                    표시할 시그널이 없습니다.
                  </p>
                )}
                {visibleSignals.map((signal) => (
                  <div
                    className={`sig ${signal.agent ? "ag" : ""}`}
                    key={`${signal.kind}-${signal.id}`}
                  >
                    <span className={`dt ${signal.type}`} />
                    <div className="bd">
                      <div className="tt">
                        {signal.agent && (
                          <span className="atag">
                            <span className="mo" />
                            {signal.kind === "draft" ? "부사수" : "에이전트"}
                          </span>
                        )}
                        {signal.title}
                      </div>
                      <div className="mt">{signal.meta}</div>
                    </div>
                    {signal.badge && <span className={`bg ${signal.badge}`}>{signal.badgeLabel}</span>}
                  </div>
                ))}
              </div>
            </section>

            {/* 허들 피드 */}
            <section className="card" aria-label="허들">
              <div className="ch">
                <h2>허들</h2>
                <span className="sub">공유 {summary.huddles.length}</span>
              </div>
              {summary.huddles.length === 0 && (
                <p style={{ color: "var(--lo)", fontSize: 12 }}>
                  공유된 메모가 없습니다. 시그널에서 메모를 허들로 보내보세요.
                </p>
              )}
              {summary.huddles.map((huddle) => (
                <div className="hud" key={huddle.id}>
                  <div className="h">{huddle.title}</div>
                  <div className="b">{huddle.body}</div>
                  <div className="f">
                    <span className="w">
                      <span
                        className="av"
                        style={{
                          width: 15,
                          height: 15,
                          flexBasis: 15,
                          fontSize: 8.5,
                          background: "linear-gradient(140deg,var(--edu),var(--play))",
                        }}
                      >
                        {huddle.authorName.slice(0, 1)}
                      </span>
                      {huddle.authorName}
                    </span>
                    <span>코멘트 {huddle.commentCount}</span>
                    <span className="acts">
                      <button className="p" disabled title="Phase 6에서 제공">
                        결정으로 승격
                      </button>
                      <button disabled title="Phase 6에서 제공">
                        Task 생성
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
