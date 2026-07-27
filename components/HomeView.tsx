"use client";

// 홈 대시보드 (Phase 3) — SPEC 4.1의 6요소를 프로토타입 레이아웃 그대로 조립.
// ③ "이번 달 목표 진척"은 SPEC 우선 규칙에 따라 프로토타입의 "프로젝트 진행" 자리를 대체.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import EmptyState from "./EmptyState";
import MetricCards from "./MetricCards";
import NewMenu from "./NewMenu";
import SignalPanel from "./SignalPanel";
import TaskTable from "./TaskTable";
import TeamTimeline, { type TimelineView } from "./TeamTimeline";
import { openTaskPanel } from "@/lib/task-panel";

// 실시간 시계 (Mission Deck 헤더) — KST, 모노. 매초 갱신.
function Clock() {
  const [now, setNow] = useState<string>("");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    const tick = () => setNow(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="clock" aria-label="현재 시각 (KST)">
      <span className="clock-t">{now || "--:--:--"}</span>
      <span className="clock-z">KST</span>
    </span>
  );
}

// 존 소제목 아이콘 (사이드바 섹션 아이콘과 통일) — wayfinding 색(절제 예외)
const ZONE_IC: Record<string, React.ReactNode> = {
  status: (<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>),
  schedule: (<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>),
  progress: <path d="M4 20V11M10 20V4M16 20v-6M3 20h18" />,
  collab: (<><circle cx="8" cy="9" r="2.6" /><circle cx="16" cy="9" r="2.6" /><path d="M2.5 19c0-2.6 2.4-4.5 5.5-4.5M21.5 19c0-2.6-2.4-4.5-5.5-4.5" /></>),
};
function ZoneHead({ tone, children }: { tone: keyof typeof ZONE_IC; children: React.ReactNode }) {
  return (
    <div className="zone-h">
      <span className={`zico z-${tone}`} aria-hidden="true"><svg viewBox="0 0 24 24">{ZONE_IC[tone]}</svg></span>
      {children}
    </div>
  );
}

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

// 진척 바 색 — 프로젝트/영역 색키를 의미색 토큰으로 (wayfinding)
function barColor(ck: string | null): string {
  switch (ck) {
    case "play": case "purple": return "var(--play)";
    case "green": case "train": return "var(--green)";
    case "edu": case "blue": case "team": default: return "var(--edu)";
  }
}

export default function HomeView({
  summary,
  user,
}: {
  summary: HomeSummary;
  user: SessionUser;
}) {
  const [view, setView] = useState<TimelineView>("month"); // v5 — 기본 월 뷰
  const [anchor, setAnchor] = useState<string>(summary.today);

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
          <div className="head-r">
            <Clock />
            <div className="seg" role="group" aria-label="기간 보기">
              {(["day", "week", "month"] as TimelineView[]).map((v) => (
                <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>
                  {v === "day" ? "일" : v === "week" ? "주" : "월"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {(() => {
          const metric = (k: string) => summary.metrics.find((m) => m.key === k);
          const overdueCount = summary.dueSoon.filter((t) => t.overdue).length;
          const overdueTop = summary.dueSoon.filter((t) => t.overdue).slice(0, 2).map((t) => t.title).join(" · ");
          const stalledTop = summary.signals.find((s) => s.stalled);
          const projPcts = summary.projectProgress.map((p) => p.percent).filter((x): x is number => x !== null);
          const avgProgress = projPcts.length ? Math.round(projPcts.reduce((a, b) => a + b, 0) / projPcts.length) : null;
          const goalPcts = summary.monthGoals.map((g) => g.progress).filter((x): x is number => x !== null);
          const goalAvg = goalPcts.length ? Math.round(goalPcts.reduce((a, b) => a + b, 0) / goalPcts.length) : null;
          const doneM = metric("done"), doingM = metric("doing"), turnM = metric("myTurn"), stalledM = metric("stalled");

          const focus = [
            { key: "inbox", n: Number(turnM?.value ?? 0), tone: "amber", label: "승인 대기", sub: "에이전트 제안·확인 요청 확정", href: "/inbox" },
            { key: "over", n: overdueCount, tone: "coral", label: "지연 업무", sub: overdueTop || "지연된 업무를 확인하세요", href: "/tasks?due=overdue" },
            { key: "stall", n: summary.stalledCount, tone: "play", label: "정체된 논의", sub: stalledTop ? `${stalledTop.title} · ${stalledTop.meta}` : "정체된 논의·결정 확인", href: "/signals" },
          ];

          return (
            <div className="bento">
              {/* 히어로 타임라인 — 좌·2행 span */}
              <TeamTimeline
                lanes={summary.lanes}
                initialEvents={summary.events}
                today={summary.today}
                view={view}
                anchor={anchor}
                isLead={user.role === "lead"}
                onAnchorChange={setAnchor}
              />

              {/* 🔥 지금 할 일 — 실행 포커스 */}
              <section className="tile focus-tile" aria-label="지금 할 일">
                <div className="ft">🔥 지금 할 일</div>
                <div className="fs">내 차례 · 급한 것부터</div>
                {focus.map((f) => (
                  <Link className="fi" key={f.key} href={f.href}>
                    <span className="n" style={{ background: `var(--${f.tone})` }}>{f.n}</span>
                    <span className="x">{f.label}<small>{f.sub}</small></span>
                    <span className="go" aria-hidden="true">›</span>
                  </Link>
                ))}
              </section>

              {/* 미니 KPI 스트립 — 4구획 */}
              <section className="tile" aria-label="핵심 지표">
                <div className="mstrip">
                  <Link className="ms" href={doingM?.href ?? "/tasks?status=doing"}><div className="v num">{doingM?.value ?? "0"}</div><div className="l">진행 중</div></Link>
                  <Link className="ms" href={doneM?.href ?? "/tasks?status=done"}><div className="v num">{doneM?.value ?? "0"}{doneM?.em && <span className="ms-em">{doneM.em}</span>}</div><div className="l">이번 주 완료</div></Link>
                  <Link className="ms" href={stalledM?.href ?? "/tasks?due=overdue"}><div className="v num v-coral">{stalledM?.value ?? "0"}</div><div className="l">지연 · 정체</div></Link>
                  <Link className="ms" href="/status"><div className="v num v-green">{avgProgress ?? "—"}{avgProgress !== null && <span className="ms-em">%</span>}</div><div className="l">평균 진척</div></Link>
                </div>
              </section>

              {/* 프로젝트 진척도 */}
              <section className="tile" aria-label="프로젝트 진척도">
                <div className="th"><span className="i" aria-hidden="true">📈</span><h3>프로젝트 진척도</h3><span className="m">W{summary.isoWeek} · 평균 {avgProgress ?? 0}%</span></div>
                {summary.projectProgress.length === 0 ? (
                  <EmptyState compact title="진행 중 프로젝트가 없어요" hint="업무를 추가하면 소속 프로젝트 진척이 모입니다." action={<Link className="btn small primary" href="/projects">프로젝트 보기</Link>} />
                ) : (
                  <div className="pb2">
                    {summary.projectProgress.map((p) => (
                      <div className="pi-row" key={p.id}>
                        <div className="pi"><span className="pi-l">{p.name}</span><span className="p num">{p.percent === null ? "-" : `${p.percent}%`}</span></div>
                        <div className="t2"><i style={{ width: `${Math.max(p.percent ?? 0, 2)}%`, background: barColor(p.colorKey) }} /></div>
                      </div>
                    ))}
                    <div className="pi-row">
                      <div className="pi"><span className="pi-l">이번 달 목표 평균</span><span className="p num">{goalAvg === null ? "-" : `${goalAvg}%`}</span></div>
                      <div className="t2"><i style={{ width: `${Math.max(goalAvg ?? 0, 2)}%`, background: "var(--amber)" }} /></div>
                    </div>
                  </div>
                )}
              </section>

              {/* 논의 · 결정 (협업) */}
              <section className="tile" aria-label="논의·결정">
                <div className="th"><span className="i" aria-hidden="true">💬</span><h3>논의 · 결정</h3><span className="m">정체 {summary.stalledCount}</span></div>
                {summary.signals.length === 0 ? (
                  <EmptyState compact title="논의·결정이 없어요" hint="결정·리스크·확인 요청이 여기에 모입니다." action={<Link className="btn small" href="/signals">논의·결정으로 가기</Link>} />
                ) : (
                  <div className="clist">
                    {summary.signals.slice(0, 5).map((s) => (
                      <Link className="cli" key={s.id} href="/signals">
                        <span className="dotc" style={{ background: s.stalled ? "var(--coral)" : s.badge === "wait" ? "var(--amber)" : "var(--muted)" }} />
                        <span className="cli-t">{s.title}</span>
                        {s.badgeLabel && <span className="cli-d" style={{ color: s.stalled ? "var(--coral-text)" : "var(--muted)" }}>{s.badgeLabel}</span>}
                      </Link>
                    ))}
                  </div>
                )}
                <Link className="collab-more" href="/huddle">허들룸 공유 {summary.huddles.length} →</Link>
              </section>
            </div>
          );
        })()}
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
  ringColor,
  accent,
}: {
  title: string;
  sub: string;
  rows: SummaryRow[];
  done?: number;
  total?: number;
  emptyText: string;
  emptyHint?: string;
  emptyAction?: React.ReactNode;
  ringColor?: string;
  accent?: string;
}) {
  // 집계 진행률 — done/total(가중) 우선, 없으면 percent 단순 평균 (부제 표기용).
  const withPct = rows.filter((r) => r.percent !== null);
  const overall =
    total && total > 0
      ? Math.round(((done ?? 0) / total) * 100)
      : withPct.length > 0
      ? Math.round(withPct.reduce((a, r) => a + (r.percent ?? 0), 0) / withPct.length)
      : null;
  // 막대 색 — 진행=blue(중립) / 목표=green(달성). 도넛 잔재 제거, 개별 진행 바로 표기.
  const fill = ringColor === "green" ? "pf-green" : "pf-blue";

  return (
    <section className={`card sumcard${accent ? ` acc-${accent}` : ""}`} aria-label={title}>
      <div className="ch">
        <h2>{title}</h2>
        <span className="sub">{sub}{overall !== null ? ` · 평균 ${overall}%` : ""}</span>
      </div>
      {rows.length === 0 ? (
        <EmptyState compact title={emptyText} hint={emptyHint} action={emptyAction} />
      ) : (
        <div className="prbars">
          {rows.map((r) => (
            <div className="pr" key={r.id}>
              <div className="pr-t">
                <span className="pr-l">{r.label}</span>
                <span className="pr-v">
                  {r.meta && <em className="gdrop">{r.meta}</em>}
                  {r.percent === null ? "-" : `${r.percent}%`}
                </span>
              </div>
              <div className="bar">
                <i className={fill} style={{ width: `${Math.min(r.percent ?? 0, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── 3순위 허들룸 — 접힌 상태로 최근 1건, 나머지는 "더 보기" ──
function HuddleFeed({
  huddles,
}: {
  huddles: HomeSummary["huddles"];
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? huddles : huddles.slice(0, 1);
  return (
    <section className="card huddle-lo acc-ink" aria-label="허들룸">
      <div className="ch">
        <h2>허들룸</h2>
        <span className="sub">공유 {huddles.length}</span>
      </div>
      {huddles.length === 0 && (
        <EmptyState
          compact
          title="공유된 허들룸이 없어요"
          hint="논의·결정에서 메모를 허들룸으로 보내면 팀이 함께 볼 결정·논의로 올라옵니다."
          action={<Link className="btn small" href="/signals">논의·결정으로 가기</Link>}
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
