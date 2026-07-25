"use client";

// 홈 대시보드 (Phase 3) — SPEC 4.1의 6요소를 프로토타입 레이아웃 그대로 조립.
// ③ "이번 달 목표 진척"은 SPEC 우선 규칙에 따라 프로토타입의 "프로젝트 진행" 자리를 대체.
import { useMemo, useState } from "react";
import Link from "next/link";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import EmptyState from "./EmptyState";
import MetricCards from "./MetricCards";
import NewMenu from "./NewMenu";
import RingGauge from "./RingGauge";
import SignalPanel from "./SignalPanel";
import TaskTable from "./TaskTable";
import TeamTimeline, { type TimelineView } from "./TeamTimeline";
import { openTaskPanel } from "@/lib/task-panel";

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

  const dateLabel = useMemo(() => {
    const d = new Date(`${summary.today}T00:00:00+09:00`);
    const dow = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][d.getUTCDay() === undefined ? 0 : new Date(`${summary.today}T12:00:00+09:00`).getDay()];
    return `${summary.today.replace(/-/g, ".")} ${dow}`;
  }, [summary.today]);

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
        <NewMenu />
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

        {/* ── 1순위: 항상 크게 ── */}
        {/* 팀 타임라인 — 전폭 */}
        <div className="fullrow">
          <TeamTimeline
            lanes={summary.lanes}
            initialEvents={summary.events}
            today={summary.today}
            view={view}
            anchor={summary.today}
            isLead={user.role === "lead"}
          />
        </div>

        {/* 지연·마감 임박 + 시그널 — 2열 (홈에서 가장 자주 보는 두 축) */}
        <div className="cols">
          <TaskTable
            rows={summary.dueSoon}
            title="지연 · 마감 임박"
            sub={`지연 ${summary.dueSoon.filter((t) => t.overdue).length} · 7일 이내 ${summary.dueSoon.filter((t) => !t.overdue).length}`}
            emptyText="지연·마감 임박 업무가 없어요"
            emptyHint="마감이 임박하거나 지난 업무가 없습니다. 좋은 상태예요."
            onRowClick={(id) => openTaskPanel(id)}
          />
          <SignalPanel items={summary.signals} stalledCount={summary.stalledCount} />
        </div>

        {/* ── 2순위(요약+링, 클릭 시 확대) 좌 · 3순위(허들 접힘) 우 ── */}
        <div className="cols">
          <div className="stack">
            <SummaryProgress
              title="프로젝트 진행"
              sub={`W${summary.isoWeek}`}
              rows={summary.projectProgress.map((p) => ({
                id: `p${p.id}`,
                label: p.name,
                percent: p.percent,
                colorKey: p.colorKey,
                meta: p.total > 0 ? `${p.done}/${p.total}` : undefined,
              }))}
              done={summary.projectProgress.reduce((a, p) => a + p.done, 0)}
              total={summary.projectProgress.reduce((a, p) => a + p.total, 0)}
              emptyText="아직 진행 중인 프로젝트가 없어요"
              emptyHint="영역 공간에서 업무를 추가하면 소속 프로젝트 진행률이 여기에 모입니다."
              emptyAction={<Link className="btn small primary" href="/projects">프로젝트 보기</Link>}
            />
            <SummaryProgress
              title="이번 달 목표"
              sub={`${summary.monthGoals.length}개`}
              rows={summary.monthGoals.map((g) => ({
                id: `g${g.id}`,
                label: g.title,
                percent: g.progress,
                colorKey: g.colorKey,
                meta: g.droppedCount > 0 ? `중단 ${g.droppedCount}` : undefined,
              }))}
              emptyText="이번 달 목표가 없어요"
              emptyHint="연간·분기 목표 아래 이번 달 목표를 세우면 진척이 자동 집계됩니다."
              emptyAction={<Link className="btn small primary" href="/goals">목표 세우기</Link>}
            />
          </div>

          {/* 허들 — 3순위. 접힌 상태로 최근 1건만, 나머지는 펼치기 */}
          <HuddleFeed huddles={summary.huddles} />
        </div>
      </div>
    </div>
  );
}

// ── 2순위 요약 카드 — 한 줄 요약 + 링 게이지 하나. 클릭 시 개별 진행률 바 확대 ──
type SummaryRow = {
  id: string;
  label: string;
  percent: number | null;
  colorKey?: string | null;
  meta?: string;
};

function SummaryProgress({
  title,
  sub,
  rows,
  done,
  total,
  emptyText,
  emptyHint,
  emptyAction,
}: {
  title: string;
  sub: string;
  rows: SummaryRow[];
  done?: number;
  total?: number;
  emptyText: string;
  emptyHint?: string;
  emptyAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // 집계 진행률 — done/total(가중) 우선, 없으면 percent 단순 평균.
  const withPct = rows.filter((r) => r.percent !== null);
  const overall =
    total && total > 0
      ? Math.round(((done ?? 0) / total) * 100)
      : withPct.length > 0
      ? Math.round(withPct.reduce((a, r) => a + (r.percent ?? 0), 0) / withPct.length)
      : null;
  const topColor = rows[0]?.colorKey ?? "edu";

  return (
    <section className="card sumcard" aria-label={title}>
      <div className="ch">
        <h2>{title}</h2>
        <span className="sub">{sub}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title={emptyText} hint={emptyHint} action={emptyAction} />
      ) : (
        <>
          <button
            className="sumhead"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <RingGauge percent={overall} colorKey={topColor ?? "edu"} />
            <span className="suml">
              <b>
                {rows.length}개 · 평균 {overall === null ? "–" : `${overall}%`}
              </b>
              <em>
                {total && total > 0 ? `완료 ${done}/${total} · ` : ""}
                {open ? "접기" : "펼쳐 보기"}
              </em>
            </span>
            <svg className={`sumcv ${open ? "on" : ""}`} viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 10l4 4 4-4" />
            </svg>
          </button>
          {open && (
            <div className="sumbody">
              {rows.map((r) => (
                <div className="pr" key={r.id}>
                  <div className="pr-t">
                    <span>{r.label}</span>
                    <span>
                      {r.meta && (
                        <em className="gdrop" style={{ marginRight: 6 }}>
                          {r.meta}
                        </em>
                      )}
                      {r.percent === null ? "-" : `${r.percent}%`}
                    </span>
                  </div>
                  <div className="bar">
                    <i
                      className={r.colorKey ?? "edu"}
                      style={{ width: `${Math.min(r.percent ?? 0, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ── 3순위 허들 — 접힌 상태로 최근 1건, 나머지는 "더 보기" ──
function HuddleFeed({
  huddles,
}: {
  huddles: HomeSummary["huddles"];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? huddles : huddles.slice(0, 1);
  return (
    <section className="card huddle-lo" aria-label="허들">
      <div className="ch">
        <h2>허들</h2>
        <span className="sub">공유 {huddles.length}</span>
      </div>
      {huddles.length === 0 && (
        <EmptyState
          compact
          title="공유된 허들이 없어요"
          hint="시그널에서 메모를 허들로 보내면 팀이 함께 볼 결정·논의로 올라옵니다."
          action={<Link className="btn small" href="/signals">시그널로 가기</Link>}
        />
      )}
      {visible.map((huddle) => (
        <div className="hud" key={huddle.id}>
          <div className="h">{huddle.title}</div>
          <div className="b">{huddle.body}</div>
          <div className="f">
            <span className="w">
              <span
                className="av"
                style={{
                  width: 18,
                  height: 18,
                  flexBasis: 18,
                  fontSize: 10.5,
                  background: "linear-gradient(140deg,var(--edu),var(--play))",
                }}
              >
                {huddle.authorName.slice(0, 1)}
              </span>
              {huddle.authorName}
            </span>
            <span>코멘트 {huddle.commentCount}</span>
          </div>
        </div>
      ))}
      {huddles.length > 1 && (
        <button className="lk mu" style={{ marginTop: 10 }} onClick={() => setExpanded((v) => !v)}>
          {expanded ? "접기" : `+ ${huddles.length - 1}건 더 보기`}
        </button>
      )}
    </section>
  );
}
