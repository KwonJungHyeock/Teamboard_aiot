"use client";

// 홈 (MD-P-2026-020 §D) — MD-P-2026-019 §B 페이지 뼈대 위에 재구성.
// 세로 순서 고정: 다크 히어로 타임라인 → 2열 그리드(좌 목표·결정 대기 / 우 일정·초점).
// 블록 규격(§D3)은 한 벌(.hm-blk)만 두고 네 블록이 공유한다. 화면별 중복 구현 금지.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { openPanel } from "@/lib/side-panel";
import { openTaskPanel } from "@/lib/task-panel";
import type { HomeSummary } from "@/lib/home";
import type { SessionUser } from "@/lib/types";
import { dueUrgency } from "@/lib/task-view";
import TaskTable, { type TaskTableRow } from "./TaskTable";
import { monthRange } from "@/lib/task-bars";
import { showsInMain } from "@/lib/area-policy";
import PageShell from "./PageShell";
import SectionEmpty from "./SectionEmpty";
import HeroTimeline from "./HeroTimeline";
import { openNewTaskPanel } from "@/lib/task-panel";
import { pfill } from "@/lib/progress-bar";

type TabKey = "overview" | "focus" | "team";
type Range = "quarter" | "all";

/** 필터바 우측 끝 NOW (§D1) — mono, 분 단위 갱신 */
function NowStamp() {
  const [t, setT] = useState("--:--");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
    });
    const tick = () => setT(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  return <span className="hm-now">NOW {t} KST</span>;
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

export default function HomeView({ summary, user }: { summary: HomeSummary; user: SessionUser }) {
  const [anchor, setAnchor] = useState<string>(summary.today);
  const [tab, setTab] = useState<TabKey>("overview");
  const [range, setRange] = useState<Range>("quarter");

  const subtitle = useMemo(() => {
    const d = new Date(`${summary.today}T12:00:00+09:00`);
    return `${summary.today.replace(/-/g, ".")} ${DOW[d.getDay()]} · 플랫폼팀`;
  }, [summary.today]);

  const quarters = range === "quarter" ? summary.quarterGoals.filter((g) => g.current) : summary.quarterGoals;

  return (
    <PageShell
      crumb={["워크스페이스", "홈"]}
      title="홈"
      subtitle={subtitle}
      actions={
        <>
          {/* §B: 주 액션 1개만 코랄 */}
          <Link className="btn-ghost" href="/settings">가져오기</Link>
          <button className="btn-primary" onClick={() => openNewTaskPanel()}>＋ 새 업무</button>
        </>
      }
      tabs={[
        { key: "overview", label: "개요" },
        { key: "focus", label: "내 초점", count: summary.myFocus.length },
        { key: "team", label: "팀 현황", count: summary.teamStatus.length },
      ]}
      activeTab={tab}
      onTab={(k) => setTab(k as TabKey)}
      filters={
        <>
          <button className={`pg-chip${range === "quarter" ? " on" : ""}`} onClick={() => setRange("quarter")}>이번 분기</button>
          <button className={`pg-chip${range === "all" ? " on" : ""}`} onClick={() => setRange("all")}>전체 기간</button>
        </>
      }
      filterSummary={<NowStamp />}
    >
      {tab === "overview" && (
        <>
          <HeroTimeline
            lanes={summary.lanes}
            today={summary.today}
            anchor={anchor}
            onAnchorChange={setAnchor}
            compact
          />
          {/* §C2 — 진행 중인 일. 홈에 목록이 **없던** 자리다(정리가 아니라 추가).
              메인(R&D · 플랫폼 · 교육자료)만 펼치고 상시는 접힌 한 줄로 건수만 보인다.
              상시라도 우선순위 높음은 메인으로 올라온다 — 분류는 lib/area-policy.ts 하나. */}
          <DeadlineList tasks={summary.openTasks} today={summary.today} />

          <div className="hm-g2">
            <div className="hm-col">
              <GoalsBlock annual={summary.annualGoals} annualLabel={summary.annualLabel} quarters={quarters} myGoalCount={summary.myGoalCount} />
              <DecisionsBlock items={summary.decisionsWaiting} decidedThisWeek={summary.decisionsThisWeek} />
            </div>
            <div className="hm-col">
              <UpcomingBlock items={summary.upcoming} today={summary.today} />
              <FocusBlock items={summary.myFocus} agent={summary.agent} />
            </div>
          </div>
        </>
      )}

      {tab === "focus" && <FocusTab items={summary.myFocus} />}
      {tab === "team" && <TeamTab rows={summary.teamStatus} />}
    </PageShell>
  );
}

/* ══════════ §D3 블록 공통 ══════════ */
function Block({
  title, count, more, moreHref, children, foot,
}: {
  title: string; count?: number; more?: string; moreHref?: string;
  children: React.ReactNode; foot?: React.ReactNode;
}) {
  return (
    <section className="hm-blk" aria-label={title}>
      <div className="hm-blk-h">
        <h2>{title}</h2>
        {count ? <em className="hm-badge num">{count}</em> : null}
        {more && moreHref && <Link className="hm-more" href={moreHref}>{more}</Link>}
      </div>
      {children}
      {foot}
    </section>
  );
}

/**
 * 홈 위젯의 빈 상태 — 공용 SectionEmpty 로 넘긴다 (MD-P-2026-026 §A · 확정 B-7).
 * 예전에는 여기서 코랄 `btn-primary` 를 그렸다. 홈 위젯 다섯 개가 동시에 비면
 * 한 화면에 주 액션 버튼이 다섯 개 떴고, 그중 무엇이 지금 할 일인지 알 수 없었다.
 * 섹션 빈 상태의 행동 유도는 텍스트 링크 하나까지다.
 */
function BlockEmpty({ text, cta, href }: { text: string; cta?: string; href?: string }) {
  return <SectionEmpty text={text} action={cta && href ? { label: `${cta} →`, href } : undefined} />;
}

/* ══════════ §D4 목표 ══════════ */
const GOAL_STATUS: Record<string, { cls: string; label: string }> = {
  risk: { cls: "risk", label: "리스크" },
  ontrack: { cls: "ok", label: "온트랙" },
  done: { cls: "ok", label: "완료" },
  wait: { cls: "wait", label: "대기" },
};

function GoalsBlock({ annual, annualLabel, quarters, myGoalCount }: {
  annual: HomeSummary["annualGoals"];
  annualLabel: string;
  quarters: HomeSummary["quarterGoals"];
  myGoalCount: number;
}) {
  const rows = [
    ...annual.map((g) => ({ id: g.id, tag: "연간", title: g.title, status: g.status as string | null, progress: g.progress })),
    ...quarters.map((g) => ({ id: g.id, tag: g.periodLabel, title: g.title, status: g.status, progress: g.progress })),
  ];
  return (
    <Block title="목표" more="전체 관리 →" moreHref="/goals"
      foot={myGoalCount > 0 ? <Link className="hm-foot" href="/goals?scope=personal">내 목표 <b className="num">{myGoalCount}</b>건 →</Link> : null}>
      {rows.length === 0 ? (
        <BlockEmpty text="등록된 목표가 없어요" cta="목표 추가" href="/goals" />
      ) : rows.map((r) => {
        const st = r.status ? GOAL_STATUS[r.status] : null;
        return (
          <Link className="hm-row hm-row-goal" key={`${r.tag}-${r.id}`} href={`/goals?goal=${r.id}`}>
            <span className="hm-c1">
              <span className="hm-tag num">{r.tag}</span>
              <span className="hm-t">{r.title}</span>
            </span>
            <span className="hm-c2">
              {st ? <span className={`hm-chip ${st.cls}`}>{st.label}</span> : <span className="hm-chip wait">집계 없음</span>}
            </span>
            {/* 데이터 없음은 "—". 0% 로 적지 않는다 */}
            <span className={`hm-c3 num${r.progress === null ? " na" : ""}`}>{r.progress === null ? "—" : `${r.progress}%`}</span>
          </Link>
        );
      })}
    </Block>
  );
}

/* ══════════ §D4 결정 대기 ══════════ */
function DecisionsBlock({ items, decidedThisWeek }: {
  items: HomeSummary["decisionsWaiting"]; decidedThisWeek: number;
}) {
  return (
    <Block title="결정 대기" count={items.length} more="전체 관리 →" moreHref="/signals"
      foot={<Link className="hm-foot" href="/signals?tab=decision">이번 주 확정된 결정 <b className="num">{decidedThisWeek}</b>건 →</Link>}>
      {items.length === 0 ? (
        <BlockEmpty text="대기 중인 결정이 없어요" cta="논의·결정으로" href="/signals" />
      ) : items.map((d) => (
        <button className="hm-row hm-row-dec" key={d.id} onClick={() => openPanel("signal", d.id)}>
          <span className="hm-c1">
            {/* 14일 초과 = coral, 그 외 amber */}
            <i className={`hm-led ${d.alert ? "coral" : "amber"}`} aria-hidden="true" />
            <span className="hm-t">{d.title}</span>
          </span>
          <span className="hm-c2 hm-sub">답글 {d.commentCount}</span>
          <span className={`hm-c3 num${d.alert ? " over" : ""}`}>{d.ageDays}일</span>
        </button>
      ))}
    </Block>
  );
}

/* ══════════ §D4 다가오는 일정 ══════════ */
const UP_KIND: Record<string, { label: string; cls: string }> = {
  meeting: { label: "회의", cls: "blue" },
  review: { label: "리뷰", cls: "amber" },
  deadline: { label: "마감", cls: "coral" },
};
function UpcomingBlock({ items, today }: { items: HomeSummary["upcoming"]; today: string }) {
  // 미래만 — 과거 마감은 이 블록에 오지 않는다 (기존 규칙 유지)
  const future = items.filter((it) => it.date >= today);
  return (
    <Block title="다가오는 일정" more="전체 관리 →" moreHref="/calendar">
      {future.length === 0 ? (
        <BlockEmpty text="예정된 일정이 없어요" />
      ) : future.map((it) => {
        const k = UP_KIND[it.kind];
        const [, mm, dd] = it.date.split("-");
        // H-2 — 판정은 lib/task-view 의 dueUrgency 한 곳에서만.
        // 이 목록은 lib/home.ts 에서 `due_date >= today` 로 뽑는 **미래만** 담는 목록이라
        // 지연(D+N)이 올 수 없다. 그래서 late 분기를 두지 않는다 — 안 그리는 분기는 안 만든다.
        const urg = dueUrgency(it.dday);
        return (
          <Link className="hm-row hm-row-up" key={it.key} href={it.kind === "meeting" ? "/calendar" : "/tasks"}>
            <span className="hm-c1 hm-date num">{it.date === today ? "오늘" : `${Number(mm)}/${Number(dd)}`}</span>
            <span className="hm-c2 hm-t">{it.title}</span>
            <span className="hm-c3">
              {it.dday
                ? <em className={`hm-dd num${urg === "soon" ? " over" : ""}`}>{it.dday}</em>
                : <span className={`hm-chip ${k.cls}`}>{k.label}</span>}
            </span>
          </Link>
        );
      })}
    </Block>
  );
}

/* ══════════ §D4 나의 초점 ══════════ */
const FOCUS_IC: Record<string, { cls: string; glyph: string }> = {
  mention: { cls: "purple", glyph: "@" },
  approval: { cls: "coral", glyph: "!" },
  task: { cls: "teal", glyph: "◱" },
  reply: { cls: "blue", glyph: "↩" },
};
function focusTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

function FocusRow({ f }: { f: HomeSummary["myFocus"][number] }) {
  const ic = FOCUS_IC[f.kind] ?? FOCUS_IC.task;
  return (
    <Link className={`hm-row hm-row-focus${f.unread ? " unread" : ""}`} href={f.href}>
      <span className={`hm-ic ${ic.cls}`} aria-hidden="true">{ic.glyph}</span>
      <span className="hm-t">{f.summary}</span>
      {f.time && <span className="hm-time num">{focusTime(f.time)}</span>}
    </Link>
  );
}

function FocusBlock({ items, agent }: { items: HomeSummary["myFocus"]; agent: HomeSummary["agent"] }) {
  const AS: Record<string, { label: string; cls: string }> = {
    working: { label: "작업 중", cls: "working" },
    pending: { label: "보고 대기", cls: "pending" },
    idle: { label: "대기", cls: "idle" },
  };
  const a = AS[agent.status];
  const unread = items.filter((i) => i.unread).length;
  return (
    <Block title="나의 초점" count={unread} more="전체 관리 →" moreHref="/inbox"
      foot={
        <Link className={`hm-agent s-${a.cls}`} href="/assistant">
          <i className={`hm-led ${a.cls}`} aria-hidden="true" />
          에이전트 {a.label}
          <span className="hm-agent-n num">{agent.spentTokens.toLocaleString()} tok · ₩{agent.won.toLocaleString()}</span>
        </Link>
      }>
      {items.length === 0
        ? <BlockEmpty text="지금 처리할 것이 없어요" />
        : items.slice(0, 5).map((f) => <FocusRow key={f.key} f={f} />)}
    </Block>
  );
}

/* ══════════ §D5 내 초점 탭 — 목록 행(38px) ══════════ */
function FocusTab({ items }: { items: HomeSummary["myFocus"] }) {
  if (items.length === 0) {
    return <div className="dl"><SectionEmpty text="지금 처리할 것이 없어요" /></div>;
  }
  return (
    <div className="dl">
      <div className="dl-head">
        <span className="dl-c" style={{ flex: "0 0 60px" }}>종류</span>
        <span className="dl-c">내용</span>
        <span className="dl-c num" style={{ flex: "0 0 84px" }}>시각</span>
      </div>
      {items.map((f) => {
        const ic = FOCUS_IC[f.kind] ?? FOCUS_IC.task;
        const label = { mention: "멘션", approval: "승인", task: "업무", reply: "답글" }[f.kind];
        return (
          <Link className={`dl-row click hm-dlrow${f.unread ? " unread" : ""}`} key={f.key} href={f.href}>
            <span className="dl-c" style={{ flex: "0 0 60px" }}>
              <span className={`hm-ic sm ${ic.cls}`} aria-hidden="true">{ic.glyph}</span>
              <span className="hm-sub">{label}</span>
            </span>
            <span className="dl-c">{f.summary}</span>
            <span className="dl-c num" style={{ flex: "0 0 84px" }}>{focusTime(f.time)}</span>
          </Link>
        );
      })}
    </div>
  );
}

/* ══════════ §D5 팀 현황 탭 — 목록 행(38px) ══════════ */
function TeamTab({ rows }: { rows: HomeSummary["teamStatus"] }) {
  if (rows.length === 0) {
    return <div className="dl"><SectionEmpty text="진행 중인 업무가 있는 팀원이 없어요" /></div>;
  }
  return (
    <div className="dl">
      <div className="dl-head">
        <span className="dl-c">담당자</span>
        <span className="dl-c num" style={{ flex: "0 0 80px" }}>진행 중</span>
        <span className="dl-c num" style={{ flex: "0 0 80px" }}>지연</span>
        <span className="dl-c num" style={{ flex: "0 0 110px" }}>평균 진척</span>
      </div>
      {rows.map((r) => (
        <Link className={`dl-row click${r.late > 0 ? " risk" : ""}`} key={r.actorId} href={`/tasks?assignee=${r.actorId}`}>
          <span className="dl-c">{r.name}</span>
          <span className="dl-c num" style={{ flex: "0 0 80px" }}>{r.doing}</span>
          <span className={`dl-c num${r.late > 0 ? " hm-over" : ""}`} style={{ flex: "0 0 80px" }}>{r.late > 0 ? r.late : "—"}</span>
          <span className="dl-c num" style={{ flex: "0 0 110px" }}>
            <span className="dl-bar">
              <i><b style={pfill(r.avgProgress ?? 0)} /></i>
              <em className={r.avgProgress === null ? "dl-bar-na" : ""}>{r.avgProgress === null ? "—" : `${r.avgProgress}%`}</em>
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ══════════ §C2 진행 중인 일 — 기한 막대 목록 ══════════
   **넷이 같은 컴포넌트를 쓴다**(§C4). 여기서 새로 만드는 것은 목록이 아니라
   "무엇을 담을지"뿐이다. 그리는 일은 TaskTable 이 한다. */
function DeadlineList({ tasks, today }: { tasks: HomeSummary["openTasks"]; today: string }) {
  const [openRoutine, setOpenRoutine] = useState(false);
  const main = tasks.filter(showsInMain);
  const routine = tasks.filter((t) => !showsInMain(t));
  const toRow = (t: HomeSummary["openTasks"][number]): TaskTableRow => ({
    id: t.id, title: t.title, projectName: t.projectName, colorKey: t.colorKey,
    assigneeName: t.assigneeName, status: t.status, priority: t.priority,
    areaName: t.areaName ?? undefined, progress: t.progress,
    dday: t.dday, overdue: t.late,
    startDate: t.startDate, dueDate: t.dueDate,
  });
  const range = today ? monthRange(today) : undefined;
  return (
    <>
      <TaskTable
        rows={main.map(toRow)}
        title="진행 중인 일"
        sub={`${main.length}건`}
        variant="full"
        timeline={range}
        groupBy="project"
        emptyText="진행 중인 업무가 없어요"
        onRowClick={(id) => openTaskPanel(id)}
      />
      {routine.length > 0 && (
        <section className="card hm-routine">
          {/* 상시는 접힌 한 줄. **건수와 지연만** 보인다 — 펼치는 것은 사용자가 정한다. */}
          <button className="fold" onClick={() => setOpenRoutine((v) => !v)} aria-expanded={openRoutine}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.8" strokeLinecap="round" className={openRoutine ? "open" : undefined}>
              <path d="M6 3.6L10.4 8 6 12.4" />
            </svg>
            <span className="t">상시 업무</span>
            <span className="m">
              {Array.from(new Set(routine.map((t) => t.areaName).filter(Boolean))).join(" · ")} · {routine.length}건
            </span>
            {routine.filter((t) => t.late).length > 0 && (
              <span className="r"><span className="st bad">지연 {routine.filter((t) => t.late).length}</span></span>
            )}
          </button>
          {openRoutine && (
            <TaskTable
              rows={routine.map(toRow)}
              title=""
              variant="full"
              timeline={range}
              groupBy="project"
              emptyText="상시 업무가 없어요"
              onRowClick={(id) => openTaskPanel(id)}
            />
          )}
        </section>
      )}
    </>
  );
}
