// 홈 대시보드 집계 (Phase 3) — 모든 수치는 서버가 DB에서 산출한다 (금지 3: LLM 수치 생성 금지와 동일 원칙).
// /api/home/summary 라우트와 홈 서버 페이지가 공유한다.
import { query, queryOne, getInboxCount } from "./db";
import { visibleTaskSql } from "./visibility";
import { getCurrentMonthGoals } from "./goals";
import {
  judgeGoalStatus, countableSql, doneSql, projectProgressSql, projectCountedSql, taskProgressSql,
  goalCountedSql,
} from "./progress";
import { getDecidedStaleDays, signalVisibilityClause } from "./signals";
import { creditState } from "./agent";
import { decisionsThisWeek } from "./decisions";
import { recentActivity } from "./activity";
import { rollActivity, isRailActivity, type RolledActivity } from "./activity-roll";

const TZ_OFFSET = "+09:00"; // Asia/Seoul — 팀 기준 시간대

export function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function kstDayStart(dateStr: string): string {
  return `${dateStr}T00:00:00${TZ_OFFSET}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** pg의 "YYYY-MM-DD HH:MM:SS+00" 텍스트를 전 브라우저 호환 ISO로 정규화 */
export function isoify(ts: string): string {
  let out = ts.replace(" ", "T");
  if (/[+-]\d{2}$/.test(out)) out += ":00";
  return out;
}

export interface Metric {
  key: string;
  label: string;
  value: string;
  em?: string; // 값 뒤 보조 표기 (/25, 일 등)
  deltaText: string;
  deltaTone: "up" | "dn" | "fl";
  spark: number[]; // 7포인트, 과거→현재
  alert?: boolean;
  placeholder?: boolean; // 자리만(다음 단계 활성화) — 값·추세 저강조 표기
  href?: string; // 클릭 시 이동 (필터된 목록/인박스). placeholder는 없음.
}

export interface LaneEvent {
  id: number;
  title: string;
  startAt: string;
  endAt: string;
  colorKey: string | null;
  isTeam: boolean;
  participantIds: number[];
}

export interface LaneTask {
  id: number;
  title: string;
  startDate: string | null;
  dueDate: string | null;
  status: string;
  colorKey: string | null;
  projectName: string | null;   // §C2 기한 막대 목록의 묶기 기준
  areaName: string | null;   // 히어로 영역 롤업용
  areaColorKey: string | null;
  origin: "human" | "agent";
  assigneeId: number | null;
  assigneeName: string | null;
  priority: string;          // high | mid | low (표기: 높음/보통/낮음)
  blocked: boolean;
  blockedBy: number | null;
  /** §C1 — 이 업무 때문에 막혀 있는 **남의** 업무 수. 0 이면 아무도 안 기다린다. */
  blockingOthers: number;
  blockingWho: string | null;
  late: boolean;
  dday: string | null; // D-3 / D+2
  progress: number; // 0~100 (수동 진행률)
}

export interface Lane {
  actorId: number;
  name: string;
  /** 에이전트 상태 — working(작성 중)/pending(보고 대기)/idle */
  assistantStatus: "working" | "pending" | "idle";
  tasks: LaneTask[];
}

export interface HomeSummary {
  today: string;
  greetingName: string; // short_name 우선, 없으면 display_name
  greetingSub: string;
  metrics: Metric[];
  lanes: Lane[];
  /**
   * §C2 기한 막대 목록의 재료 — **레인과 같은 행에서 나온다.**
   * 레인은 담당자별로 나누느라 담당 없는 업무가 빠지는데, 목록은 그러면 안 된다.
   * 그래서 레인을 만들기 전의 원본을 그대로 한 번 더 싣는다. **새 쿼리는 없다.**
   */
  openTasks: LaneTask[];
  events: LaneEvent[]; // 오늘(또는 조회 기간) 일정 전체 — 레인 배치는 클라이언트
  eventCount: number;
  taskCount: number;
  monthGoals: {
    id: number;
    title: string;
    progress: number | null; // null = 산출 불가 → "-"
    colorKey: string | null;
    projectName: string | null;
    droppedCount: number; // N>0이면 "중단 N건" 라벨
  }[];
  projectProgress: {
    id: number;
    name: string;
    colorKey: string | null;
    total: number;
    done: number;
    percent: number | null; // 업무 0건이면 null → "-"
  }[];
  // 현황 분석 (파트 2) — 서버 집계만
  weeklyDone: { weekStart: string; count: number }[]; // 최근 8주 완료 건수 (오래된→최신)
  assigneeLoad: { name: string; doing: number; waiting: number }[]; // 담당자별 오픈 업무 부하
  isoWeek: number;
  dueSoon: {
    id: number;
    title: string;
    projectName: string | null;
    colorKey: string | null;
    assigneeId: number | null;
    assigneeName: string | null;
    status: string;
    dueDate: string;
    dday: string;
    overdue: boolean;
  }[];
  signals: HomeSignal[];
  stalledCount: number;
  huddles: {
    id: number;
    title: string;
    body: string;
    authorName: string;
    commentCount: number;
  }[];
  // ── 홈 재편 (테마 재편 §3) ──
  annualGoals: {
    id: number;
    title: string;
    progress: number | null;
    /** 자동 판정(수동 지정 우선). 판정 불가 시 null — 분기 목표와 같은 규칙 */
    status: "ontrack" | "risk" | "wait" | "done" | null;
    colorKey: string | null;
  }[];
  annualLabel: string; // 예: 2026
  quarterGoals: {
    id: number;
    title: string;
    progress: number | null;
    /** 자동 판정(수동 지정 우선). 판정 불가 시 null */
    status: "ontrack" | "risk" | "wait" | "done" | null;
    colorKey: string | null;
    /** 레벨 태그 표기 (Q1~Q4) — §D4 1열 */
    periodLabel: string;
    /** 오늘이 이 분기 안인가 — 필터칩 "이번 분기" 판별 (§D1) */
    current: boolean;
  }[];
  quarterLabel: string; // 예: 2026 Q3
  /** 내 개인 목표 수 — 홈은 팀 목표만 보여주고 한 줄 링크로 안내 (§E) */
  myGoalCount: number;
  /**
   * §C3 레일 「내 목표 진척」 — 025 개인 공간의 목표.
   * **본문은 업무를, 레일은 목표를 보여준다.** 둘이 같은 것을 말하면 레일을 둘 이유가 없다.
   * 지금 기간에 걸친 내 목표만. 없으면 블록이 「목표를 만들어 보세요」 한 줄로 선다.
   */
  myGoals: {
    id: number;
    title: string;
    /** 자동·수동을 이미 합친 값. 집계 대상이 없으면 null → 「집계 없음」 */
    progress: number | null;
    /** 집계 대상 업무 수 — 표본 가드(MIN_SAMPLE)를 화면이 걸 수 있게 함께 준다 */
    counted: number;
    /** `분기`·`월`·`연간` */
    level: string;
  }[];
  upcoming: {
    key: string;
    kind: "meeting" | "deadline" | "review";
    title: string;
    date: string;       // YYYY-MM-DD (정렬·표시)
    dday: string | null; // 마감만
    overdue: boolean;
  }[];
  decisionsWaiting: {
    id: number;
    title: string;
    authorName: string;
    commentCount: number;
    ageDays: number;
    alert: boolean; // 14일 초과
  }[];
  /** 이번 주 확정된 결정 수 — "결정 대기" 모듈 하단 한 줄 링크 (MD-P-2026-004 §D) */
  decisionsThisWeek: number;
  myFocus: {
    key: string;
    kind: "mention" | "approval" | "task" | "reply";
    summary: string;
    time: string | null; // 멘션·답글만 mono 시각
    href: string;
    /** 안읽음 — 굵게 + 좌측 코랄 점 (MD-P-2026-018 §B 규격 재사용, MD-P-2026-020 §D4) */
    unread: boolean;
  }[];
  /**
   * §C3 레일 「팀 활동」 — 최근 활동을 **묶어서** 6줄.
   * 「오늘의 활동」이 아니다. 날짜 조건을 걸면 조용한 날에 빈 카드가 되고,
   * **빈 카드는 신뢰를 깎는다**(「다가오는 일정」을 기각한 것과 같은 이유).
   */
  teamActivity: RolledActivity[];
  /** 팀 현황 탭 (MD-P-2026-020 §D5) — 기존 담당자별 집계를 재사용해 한 번에 뽑는다 */
  teamStatus: {
    actorId: number;
    name: string;
    doing: number;      // 진행 중 (todo/doing/review)
    late: number;       // 지연 (기한 경과)
    avgProgress: number | null; // 평균 진척. 오픈 업무 0건이면 null → "—"
  }[];
  agent: {
    status: "working" | "pending" | "idle";
    spentTokens: number;
    won: number;
  };
}

export interface HomeSignal {
  id: number;
  kind: "signal" | "draft"; // draft = 에이전트 승인 대기 초안 (에이전트 생성물)
  type: string;
  title: string;
  meta: string;
  badge: "stale" | "wait" | "priv" | "decided" | "tome" | null;
  badgeLabel: string | null;
  agent: boolean;
  stalled: boolean;
}

function dday(due: string, today: string): string {
  const diff = Math.round(
    (new Date(`${due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000
  );
  return diff < 0 ? `D+${-diff}` : diff === 0 ? "D-DAY" : `D-${diff}`;
}

const OPEN_TASK = `t.is_active = true AND t.status IN ('todo','doing','review')`; // proposed·done·dropped 제외

// ── 개인 업무 경계 (MD-P-2026-025 §A3) ────────────────────────────────
//
// 홈은 **팀 전체 현황판**이다 (§A1 — "개인 화면이 아니다").
// 그래서 팀 지표에서는 개인 업무를 아예 뺀다. 내 개인 업무라도 팀 숫자는 아니다.
//   · 팀 지표·구성원 부하·프로젝트 집계  → TEAM_TASK
//   · "내 차례"·"내 업무" 같은 내 패널     → mineOk(viewerId)
//
// viewerId 는 서명된 세션 토큰에서 온 number 다. 그래도 Number() 로 한 번 더
// 강제해 숫자가 아닌 것이 SQL 로 흘러들 여지를 없앤다(숫자가 아니면 NaN → 구문 오류).
const TEAM_TASK = `t.visibility = 'team'`;
const mineOk = (viewerId: number, t = "t") => visibleTaskSql(String(Number(viewerId)), t);

/**
 * 7일치 스파크를 **쿼리 한 번**으로 뽑는다 (MD-P-2026-022 §B).
 * 예전에는 날짜마다 count(*) 를 한 번씩 돌려 스파크 3종에 21회가 나갔다.
 * generate_series 로 날짜 축을 만들고 각 날짜에 스칼라 서브쿼리를 붙인다 —
 * "그 시점 기준" 집계라 단순 GROUP BY 로는 표현되지 않기 때문이다(§B [기준과 다르게] 참조).
 * countSql 안에서 그날은 d.day 로 참조한다. KST 자정은 (X::timestamp AT TIME ZONE 'Asia/Seoul').
 */
async function sparkSeries(countSql: string, today: string): Promise<number[]> {
  const rows = await query<{ n: string }>(
    `WITH d AS (SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day)
     SELECT (${countSql})::text AS n FROM d ORDER BY d.day`,
    [addDays(today, -6), today]
  );
  return rows.map((r) => Number(r.n));
}
const KST_START = (expr: string) => `((${expr})::timestamp AT TIME ZONE 'Asia/Seoul')`;

export async function buildHomeSummary(viewerId: number, isLead = false): Promise<HomeSummary> {
  const today = kstToday();
  const weekStartOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 월요일 기준
  const weekStart = addDays(today, -weekStartOffset);
  const in7 = addDays(today, 7);

  // ── 지표 1: 진행 중 업무 (doing) ──
  const doingNow = (await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM task t WHERE t.is_active = true AND t.status = 'doing' AND ${TEAM_TASK}`
  ))!.n;
  // 스파크: 일별 열린 업무 근사치 (생성됨 & 그 시점 미완료)
  const openSpark = await sparkSeries(
    `SELECT count(*) FROM task t
      WHERE t.is_active = true AND t.status <> 'proposed' AND ${TEAM_TASK}
        AND t.created_at < ${KST_START("d.day + 1")}
        AND (t.completed_at IS NULL OR t.completed_at >= ${KST_START("d.day + 1")})`,
    today
  );
  const createdThisWeek = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task t
       WHERE t.is_active = true AND t.status <> 'proposed' AND ${TEAM_TASK}
         AND t.created_at >= $1::timestamptz`,
      [kstDayStart(weekStart)]
    ))!.n
  );

  // ── 지표 2: 이번 주 완료 ──
  const doneThisWeek = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task t
       WHERE t.is_active = true AND t.status = 'done' AND ${TEAM_TASK}
         AND t.completed_at >= $1::timestamptz`,
      [kstDayStart(weekStart)]
    ))!.n
  );
  const weekDenominator =
    doneThisWeek +
    Number(
      (await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM task t
         WHERE ${OPEN_TASK} AND ${TEAM_TASK} AND t.due_date >= $1::date AND t.due_date < $2::date`,
        [weekStart, addDays(weekStart, 7)]
      ))!.n
    );
  const doneSpark = await sparkSeries(
    `SELECT count(*) FROM task t
      WHERE t.is_active = true AND t.status = 'done' AND ${TEAM_TASK}
        AND t.completed_at >= ${KST_START("d.day")} AND t.completed_at < ${KST_START("d.day + 1")}`,
    today
  );

  // ── 지표 3: 내 차례 (지금 나에게 공이 온 것) ──
  // = 승인 대기(제안·초안) + 나에게 온 확인요청(review) + 리뷰 단계 내 업무 수
  const approvals = await getInboxCount(viewerId, isLead);
  const reviewToMe = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM signal s
       WHERE s.is_active = true AND s.type = 'review' AND s.status IN ('open','discussing')
         AND s.target_actor_id = $1`,
      [viewerId]
    ))!.n
  );
  const reviewMine = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task t
       WHERE t.is_active = true AND t.status = 'review' AND t.assignee_id = $1
         AND ${mineOk(viewerId)}`,
      [viewerId]
    ))!.n
  );
  const myTurn = approvals + reviewToMe + reviewMine;

  // ── 지표 4: 지연·정체 ──
  const thresholds = ((await queryOne<{ value: any }>(
    `SELECT value FROM config WHERE key = 'signal_thresholds'`
  ))?.value ?? { decision: 14, review: 7, memo: null, risk: 0 }) as Record<string, number | null>;

  const overdueTasks = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task t WHERE ${OPEN_TASK} AND ${TEAM_TASK} AND t.due_date < $1::date`,
      [today]
    ))!.n
  );
  const stalledSignalRow = await query<{ id: number; type: string; days: string }>(
    `SELECT s.id, s.type, floor(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400) AS days
     FROM signal s
     WHERE s.is_active = true AND s.status IN ('open','discussing') AND s.type IN ('decision','review','risk')`
  );
  const stalledSignals = stalledSignalRow.filter((s) => {
    const limit = thresholds[s.type];
    if (limit === null || limit === undefined) return false;
    return Number(s.days) >= limit;
  });
  const overdueSpark = await sparkSeries(
    `SELECT count(*) FROM task t
      WHERE t.is_active = true AND t.status <> 'proposed' AND t.status <> 'dropped' AND ${TEAM_TASK}
        AND t.due_date < d.day
        AND (t.completed_at IS NULL OR t.completed_at >= ${KST_START("d.day")})`,
    today
  );

  // 막힌 업무(blocked 플래그) — 진행 불가 신호. 대표 사유 1줄(가장 오래 막힌 것).
  const blockedRow = await queryOne<{ n: string; reason: string | null }>(
    `SELECT count(*) AS n,
            (SELECT blocked_reason FROM task
             WHERE is_active = true AND blocked = true AND status <> 'proposed' AND visibility = 'team'
             ORDER BY blocked_since ASC NULLS LAST LIMIT 1) AS reason
     FROM task WHERE is_active = true AND blocked = true AND status <> 'proposed' AND visibility = 'team'`
  );
  const blockedCount = Number(blockedRow?.n ?? 0);
  const blockedTopReason = blockedRow?.reason ?? null;

  const metrics: Metric[] = [
    {
      key: "doing",
      label: "진행 중 업무",
      value: doingNow,
      deltaText: `이번 주 신규 ${createdThisWeek}`,
      deltaTone: "up",
      spark: openSpark,
      href: "/tasks?status=doing",
    },
    {
      key: "done",
      label: "이번 주 완료",
      value: String(doneThisWeek),
      em: weekDenominator > 0 ? `/${weekDenominator}` : undefined,
      deltaText:
        weekDenominator > 0
          ? `${Math.round((doneThisWeek / weekDenominator) * 100)}% 달성`
          : "이번 주 대상 없음",
      deltaTone: "up",
      spark: doneSpark,
      href: "/tasks?status=done",
    },
    {
      key: "myTurn",
      label: "내 차례",
      value: String(myTurn),
      deltaText: `승인 ${approvals} · 확인요청 ${reviewToMe} · 리뷰 ${reviewMine}`,
      deltaTone: myTurn > 0 ? "up" : "fl",
      spark: [], // 현재 스냅샷 값 하나 — 추세 없음. 직선 방지 위해 스파크라인 미표시.
      alert: myTurn > 0,
      href: "/inbox",
    },
    {
      key: "stalled",
      label: "지연 · 정체",
      value: String(overdueTasks + stalledSignals.length),
      deltaText: `업무 ${overdueTasks} · 논의·결정 ${stalledSignals.length}`,
      deltaTone: "fl",
      spark: overdueSpark,
      alert: overdueTasks + stalledSignals.length > 0,
      href: "/tasks?due=overdue",
    },
    {
      key: "blocked",
      label: "막힌 업무",
      value: String(blockedCount),
      deltaText: blockedCount > 0 ? (blockedTopReason ?? "사유 미입력") : "막힌 업무 없음",
      deltaTone: blockedCount > 0 ? "dn" : "fl",
      spark: [],
      alert: blockedCount > 0,
      href: "/tasks?blocked=1",
    },
  ];

  // ── 레인: 활성 human + 각자 열린 업무 (기한 임박 앞쪽 정렬, proposed 제외) ──
  // 시스템/조직 관리 계정(robodynesystems)은 담당 레인에서 제외 — 실제 팀원만.
  const humans = await query<{ id: number; display_name: string }>(
    `SELECT id, display_name FROM actor
     WHERE type = 'human' AND is_active = true
       AND id NOT IN (SELECT actor_id FROM account WHERE email = 'robodynesystems')
     ORDER BY id`
  );
  const laneTasks = await query<{
    id: number;
    title: string;
    start_date: string | null;
    due_date: string | null;
    status: string;
    color_key: string | null;
    area_name: string | null;
    area_color: string | null;
    origin: "human" | "agent";
    assignee_id: number | null;
    assignee_name: string | null;
    priority: string;
    progress: number;
    project_name: string | null;
    blocked: boolean;
    blocked_by: number | null;
    blocking_others: number;
    blocking_who: string | null;
  }>(
    `SELECT t.id, t.title, t.start_date::text, t.due_date::text, t.status, p.color_key,
            p.name AS project_name,
            ar.name AS area_name, ar.color_key AS area_color,
            t.origin, t.assignee_id, ac.display_name AS assignee_name, t.priority, t.progress,
            t.blocked, t.blocked_by,
            -- §C1 「내가 막는 것」 — 이 업무를 원인으로 막혀 있는 **남의** 업무 수.
            -- 028 §B2 역방향 차단이 이미 서버에 있다. 여기서는 세기만 한다.
            (SELECT count(*)::int FROM task bk
              WHERE bk.blocked_by = t.id AND bk.is_active = true AND bk.blocked = true
                AND bk.assignee_id IS DISTINCT FROM t.assignee_id) AS blocking_others,
            (SELECT string_agg(DISTINCT bac.display_name, ' · ') FROM task bk
               LEFT JOIN actor bac ON bac.id = bk.assignee_id
              WHERE bk.blocked_by = t.id AND bk.is_active = true AND bk.blocked = true
                AND bk.assignee_id IS DISTINCT FROM t.assignee_id) AS blocking_who
     FROM task t
     LEFT JOIN project p ON p.id = t.project_id
     LEFT JOIN area ar ON ar.id = t.area_id
     LEFT JOIN actor ac ON ac.id = t.assignee_id
     WHERE ${OPEN_TASK} AND ${TEAM_TASK}
     ORDER BY t.due_date ASC NULLS LAST, t.priority = 'high' DESC, t.id`
  );
  // 에이전트 상태 (레인 이름 옆 상태 점) — working 우선, 없으면 pending, 없으면 idle
  const assistantStates = await query<{ user_id: number; status: string }>(
    `SELECT DISTINCT user_id, status FROM drafts WHERE status IN ('working','pending')`
  );
  const assistantStatusOf = (actorId: number): "working" | "pending" | "idle" => {
    if (assistantStates.some((s) => s.user_id === actorId && s.status === "working")) return "working";
    if (assistantStates.some((s) => s.user_id === actorId && s.status === "pending")) return "pending";
    return "idle";
  };

  const lanes: Lane[] = humans.map((h) => ({
    actorId: h.id,
    name: h.display_name,
    assistantStatus: assistantStatusOf(h.id),
    tasks: laneTasks
      .filter((t) => t.assignee_id === h.id)
      .map((t) => ({
        id: t.id,
        title: t.title,
        startDate: t.start_date,
        dueDate: t.due_date,
        status: t.status,
        colorKey: t.color_key,
        projectName: t.project_name,
        areaName: t.area_name,
        areaColorKey: t.area_color,
        origin: t.origin,
        assigneeId: t.assignee_id,
        assigneeName: t.assignee_name,
        priority: t.priority,
        blocked: t.blocked, blockedBy: t.blocked_by,
        blockingOthers: t.blocking_others, blockingWho: t.blocking_who,
        late: !!t.due_date && t.due_date < today,
        dday: t.due_date ? dday(t.due_date, today) : null,
        progress: t.progress ?? 0,
      })),
  }));

  // ── 오늘 일정 (팀 공통 + 개인) ──
  const events = await query<{
    id: number;
    title: string;
    start_at: string;
    end_at: string;
    color_key: string | null;
    is_team: boolean;
    participant_ids: number[] | null;
  }>(
    `SELECT e.id, e.title, e.start_at::text, e.end_at::text, p.color_key, e.is_team,
            array_agg(ep.actor_id) FILTER (WHERE ep.actor_id IS NOT NULL) AS participant_ids
     FROM event e
     LEFT JOIN project p ON p.id = e.project_id
     LEFT JOIN event_participant ep ON ep.event_id = e.id
     WHERE e.is_active = true AND e.start_at < $2::timestamptz AND e.end_at > $1::timestamptz
     GROUP BY e.id, p.color_key
     ORDER BY e.start_at`,
    [kstDayStart(today), kstDayStart(addDays(today, 1))]
  );

  // ── 이번 달 목표 진척 — 계산은 lib/goals.ts 단일 소스 (Phase 4) ──
  const monthGoals = await getCurrentMonthGoals(today);

  // ── 프로젝트 진행 ──
  // 진척·분모는 lib/progress.ts 정의를 그대로 쓴다 (MD-P-2026-024 §3). 여기서 따로 세지 않는다.
  const projectProgress = await query<{
    id: number;
    name: string;
    color_key: string | null;
    total: string;
    done: string;
    avg_progress: string | null;
  }>(
    `SELECT p.id, p.name, p.color_key,
            ${projectCountedSql("p.id")}::text AS total,
            (SELECT count(*) FROM task t
              WHERE t.project_id = p.id AND t.parent_task_id IS NULL
                AND ${countableSql("t")} AND ${doneSql("t")})::text AS done,
            ${projectProgressSql("p.id")}::text AS avg_progress
     FROM project p
     WHERE p.is_active = true
     ORDER BY p.id`
  );

  // ── 현황 분석 (파트 2) — 서버 집계만. LLM 수치생성 금지. ──
  // 주간 완료 추이: 최근 8주 완료 건수 (오래된→최신, 마지막이 이번 주)
  // 최근 8주 완료 건수 — 스파크와 같은 방식으로 한 번에 뽑는다 (MD-P-2026-022 §B).
  const weeklyDoneRows = await query<{ ws: string; n: string }>(
    `WITH w AS (SELECT generate_series($1::date, $2::date, interval '7 day')::date AS ws)
     SELECT w.ws::text AS ws,
            (SELECT count(*) FROM task t
              WHERE t.is_active = true AND t.status = 'done' AND ${TEAM_TASK}
                AND t.completed_at >= ${KST_START("w.ws")}
                AND t.completed_at <  ${KST_START("w.ws + 7")})::text AS n
       FROM w ORDER BY w.ws`,
    [addDays(weekStart, -49), weekStart]
  );
  const weeklyDone = weeklyDoneRows.map((r) => ({ weekStart: r.ws, count: Number(r.n) }));
  // 담당자별 부하: 오픈 업무(todo/doing/review)를 상태별로 (진행 / 대기·리뷰). 부하순 정렬.
  const assigneeLoadRows = await query<{ name: string; doing: string; waiting: string }>(
    `SELECT ac.display_name AS name,
            count(*) FILTER (WHERE t.status = 'doing') AS doing,
            count(*) FILTER (WHERE t.status IN ('todo', 'review')) AS waiting
     FROM actor ac
     JOIN task t ON t.assignee_id = ac.id AND t.is_active = true AND t.status IN ('todo', 'doing', 'review')
                AND t.visibility = 'team'
     WHERE ac.type = 'human' AND ac.is_active = true
       AND ac.id NOT IN (SELECT actor_id FROM account WHERE email = 'robodynesystems')
     GROUP BY ac.display_name
     ORDER BY count(*) DESC`
  );
  const assigneeLoad = assigneeLoadRows.map((a) => ({
    name: a.name, doing: Number(a.doing), waiting: Number(a.waiting),
  }));

  // 팀 현황 탭 (§D5) — 같은 오픈 업무 모집단을 한 번 더 훑어 지연·평균 진척까지 뽑는다.
  // 신규 데이터를 만들지 않는다. avg 는 오픈 업무 0건이면 null(= "—", 0% 아님).
  const teamStatusRows = await query<{
    id: number; name: string; doing: string; late: string; avg: string | null;
  }>(
    `SELECT ac.id, ac.display_name AS name,
            count(*) AS doing,
            count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < $1::date) AS late,
            round(avg(${taskProgressSql("t")})) AS avg
     FROM actor ac
     JOIN task t ON t.assignee_id = ac.id AND ${OPEN_TASK} AND ${TEAM_TASK}
     WHERE ac.type = 'human' AND ac.is_active = true
     GROUP BY ac.id, ac.display_name
     ORDER BY count(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < $1::date) DESC, count(*) DESC`,
    [today]
  );
  const teamStatus = teamStatusRows.map((r) => ({
    actorId: r.id,
    name: r.name,
    doing: Number(r.doing),
    late: Number(r.late),
    avgProgress: r.avg === null ? null : Number(r.avg),
  }));

  // 뷰어 호칭 (short_name 우선)
  const viewer = await queryOne<{ display_name: string; short_name: string | null }>(
    `SELECT display_name, short_name FROM actor WHERE id = $1`,
    [viewerId]
  );

  // ISO 주차 (프로젝트 진행 카드 부제 "W30")
  const isoWeek = (() => {
    const d = new Date(`${today}T00:00:00Z`);
    const day = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - day + 3);
    const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const firstDay = (firstThu.getUTCDay() + 6) % 7;
    firstThu.setUTCDate(firstThu.getUTCDate() - firstDay + 3);
    return 1 + Math.round((d.getTime() - firstThu.getTime()) / (7 * 86400000));
  })();

  // ── 마감 임박 (7일 이내 + 지연) ──
  const dueSoonRows = await query<{
    id: number;
    title: string;
    project_name: string | null;
    color_key: string | null;
    assignee_id: number | null;
    assignee_name: string | null;
    status: string;
    due_date: string;
  }>(
    `SELECT t.id, t.title, p.name AS project_name, p.color_key,
            t.assignee_id, a.display_name AS assignee_name, t.status, t.due_date::text
     FROM task t
     LEFT JOIN project p ON p.id = t.project_id
     LEFT JOIN actor a ON a.id = t.assignee_id
     WHERE ${OPEN_TASK} AND ${TEAM_TASK} AND t.due_date IS NOT NULL AND t.due_date <= $1::date
     ORDER BY t.due_date ASC
     LIMIT 8`,
    [in7]
  );

  // ── 시그널 패널 — 가시성·미실행결정 판정은 lib/signals 단일 소스와 동일 규칙 ──
  const decidedStaleDays = await getDecidedStaleDays();
  const signalRows = await query<{
    id: number;
    type: string;
    scope: string;
    title: string;
    status: string;
    author_name: string;
    author_type: string;
    target_actor_id: number | null;
    days: string;
    decided_days: string | null;
    comment_count: string;
  }>(
    `SELECT s.id, s.type, s.scope, s.title, s.status,
            a.display_name AS author_name, a.type AS author_type, s.target_actor_id,
            floor(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400) AS days,
            CASE WHEN s.decided_at IS NOT NULL
                 THEN floor(EXTRACT(EPOCH FROM (now() - s.decided_at)) / 86400) END AS decided_days,
            (SELECT count(*) FROM comment c WHERE c.signal_id = s.id) AS comment_count
     FROM signal s JOIN actor a ON a.id = s.author_id
     WHERE s.is_active = true AND s.status IN ('open','discussing','decided')
       AND ${signalVisibilityClause("$1")}
     ORDER BY s.created_at DESC
     LIMIT 14`,
    [viewerId]
  );
  const typeLabel: Record<string, string> = {
    decision: "결정",
    review: "확인 요청",
    memo: "메모",
    risk: "리스크",
  };
  const signalItems: (HomeSignal & { decidedStale: boolean; toMe: boolean })[] = signalRows.map((s) => {
    const limit = thresholds[s.type];
    const active = s.status === "open" || s.status === "discussing";
    const stalled =
      active && (s.type === "risk" ? true : limit !== null && limit !== undefined && Number(s.days) >= Number(limit));
    const decidedStale =
      s.status === "decided" && s.decided_days !== null && Number(s.decided_days) >= decidedStaleDays;
    const toMe = s.type === "review" && s.target_actor_id === viewerId && active;
    const badge = toMe
      ? "tome"
      : s.type === "risk" && active
        ? "stale"
        : decidedStale
          ? "decided"
          : stalled
            ? "stale"
            : s.scope === "private"
              ? "priv"
              : null;
    const badgeLabel = toMe
      ? "확인 요청"
      : s.type === "risk" && active
        ? "고정"
        : decidedStale
          ? "미실행"
          : stalled
            ? "정체"
            : s.scope === "private"
              ? "비공개"
              : null;
    return {
      id: s.id,
      kind: "signal",
      type: s.type,
      title: s.title,
      meta: [
        typeLabel[s.type] ?? s.type,
        s.scope === "private" ? "비공개" : s.author_name,
        s.status === "decided"
          ? `결정 후 ${s.decided_days ?? 0}일`
          : s.status === "discussing"
            ? `논의중 ${s.days}일`
            : `${s.days}일 경과`,
        Number(s.comment_count) > 0 ? `코멘트 ${s.comment_count}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      badge,
      badgeLabel,
      agent: s.author_type === "agent",
      stalled,
      decidedStale,
      toMe,
    };
  });
  // 사람 공간 원칙 — 홈 시그널 패널에는 에이전트 산출물(승인 대기 초안)을 넣지 않는다.
  // 에이전트 초안·제안은 "승인 인박스"에만 모인다 (사람 공간에는 승인된 것만 존재).
  // 우선순위: 나에게 온 확인 요청 → risk → 미실행 결정 → 정체 → 나머지
  const priority = signalItems.filter((s) => s.toMe || s.type === "risk" || s.decidedStale || s.stalled);
  const rest = signalItems.filter((s) => !priority.includes(s));
  const signals: HomeSignal[] = [...priority, ...rest]
    .slice(0, 10)
    .map(({ id, kind, type, title, meta, badge, badgeLabel, agent, stalled }) => ({
      id,
      kind,
      type,
      title,
      meta,
      badge,
      badgeLabel,
      agent,
      stalled,
    }));

  // ── 허들 피드 ──
  const huddles = await query<{
    id: number;
    title: string;
    body: string;
    author_name: string;
    comment_count: string;
  }>(
    `SELECT s.id, s.title, s.body, a.display_name AS author_name,
            (SELECT count(*) FROM comment c WHERE c.signal_id = s.id) AS comment_count
     FROM signal s JOIN actor a ON a.id = s.author_id
     WHERE s.is_active = true AND s.scope = 'huddle' AND s.status <> 'archived'
     ORDER BY s.created_at DESC LIMIT 4`
  );

  // ── 홈 재편 §3-1: 이번 분기 목표 (현재 분기만) ──
  const quarterRows = await query<{
    id: number; title: string; progress: string | null; color_key: string | null;
    status_manual: "ontrack" | "risk" | "wait" | "done" | null;
    period_start_d: string; period_end_d: string;
  }>(
    `SELECT g.id, g.title, g.progress::text, p.color_key, g.status_manual,
            g.period_start::text AS period_start_d, g.period_end::text AS period_end_d
     FROM goal g LEFT JOIN project p ON p.id = g.project_id
     WHERE g.is_active = true AND g.period_type = 'quarter' AND g.scope = 'team'
       AND g.period_start <= $1::date AND g.period_end >= $2::date
     ORDER BY g.period_start, g.id`,
    [`${today.slice(0, 4)}-12-31`, `${today.slice(0, 4)}-01-01`]
  );
  // 상태 판정은 lib/goals.ts 단일 소스 (§D). 진척이 null이면 판정하지 않는다(0% 취급 금지).
  const quarterGoals = quarterRows.map((g) => {
    const prog = g.progress === null ? null : Math.round(Number(g.progress));
    return {
      id: g.id, title: g.title, progress: prog,
      status: g.status_manual ?? judgeGoalStatus(prog, g.period_start_d, g.period_end_d, today),
      colorKey: g.color_key,
      // §D4 레벨 태그 + 필터칩(이번 분기 ⇄ 전체 기간) 판별용
      periodLabel: `Q${Math.floor((Number(g.period_start_d.slice(5, 7)) - 1) / 3) + 1}`,
      current: g.period_start_d <= today && g.period_end_d >= today,
    };
  });
  // 정렬: 리스크 > 온트랙 > 완료 > 판정 불가/대기
  const statusRank: Record<string, number> = { risk: 0, ontrack: 1, done: 2, wait: 3, none: 4 };
  quarterGoals.sort((a, b) => statusRank[a.status ?? "none"] - statusRank[b.status ?? "none"]);
  const qNum = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const quarterLabel = `${today.slice(0, 4)} Q${qNum}`;

  // §C: 연간 목표 (level=annual, 올해 커버) — 상단 큰 게이지
  const annualRows = await query<{
    id: number; title: string; progress: string | null; color_key: string | null;
    status_manual: "ontrack" | "risk" | "wait" | "done" | null;
    period_start_d: string; period_end_d: string;
  }>(
    `SELECT g.id, g.title, g.progress::text, p.color_key, g.status_manual,
            g.period_start::text AS period_start_d, g.period_end::text AS period_end_d
     FROM goal g LEFT JOIN project p ON p.id = g.project_id
     WHERE g.is_active = true AND g.scope = 'team'
       AND (g.level = 'annual' OR g.period_type = 'year')
       AND g.period_start <= $1::date AND g.period_end >= $1::date
     ORDER BY g.id LIMIT 2`,
    [today]
  );
  // 상태 판정은 분기 목표와 같은 단일 소스(judgeGoalStatus)를 쓴다.
  // 진척이 있는데 "집계 없음"으로 나오던 문제(MD-P-2026-020 실데이터 확인)를 여기서 막는다.
  const annualGoals = annualRows.map((g) => {
    const prog = g.progress === null ? null : Math.round(Number(g.progress));
    return {
      id: g.id, title: g.title,
      progress: prog,
      status: g.status_manual ?? judgeGoalStatus(prog, g.period_start_d, g.period_end_d, today),
      colorKey: g.color_key,
    };
  });

  // §E — 홈은 팀 목표만. 내 개인 목표는 건수만 한 줄로 안내한다.
  const myGoalRow = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM goal
      WHERE is_active = true AND scope = 'personal' AND owner_actor_id = $1
        AND period_start <= $2::date AND period_end >= $2::date`,
    [viewerId, today]
  );
  const myGoalCount = Number(myGoalRow?.n ?? 0);

  /**
   * §C3 레일 「내 목표 진척」 — 지금 기간에 걸친 내 개인 목표.
   *
   * 진척은 **다시 계산하지 않는다.** `goal.progress` 는 `recomputeGoalChain` 이
   * 유지하는 값이고, 분모(`counted`)는 `goalCountedSql` 이 센다 — 목표 상세와 같은 두 함수다.
   * 여기서 평균을 새로 내면 홈과 상세가 다른 숫자를 말하게 된다(진척 계산기가 아홉 갈래로
   * 갈렸던 그 경로다).
   */
  const myGoalRows = await query<{
    id: number; title: string; period_type: string;
    progress: string | null; progress_manual: string | null; counted: number;
  }>(
    `SELECT g.id, g.title, g.period_type, g.progress::text, g.progress_manual::text,
            ${goalCountedSql("g.id")}::int AS counted
       FROM goal g
      WHERE g.is_active = true AND g.scope = 'personal' AND g.owner_actor_id = $1
        AND g.period_start <= $2::date AND g.period_end >= $2::date
      ORDER BY g.period_type DESC, g.id
      LIMIT 5`,
    [viewerId, today]
  );
  const myGoals: HomeSummary["myGoals"] = myGoalRows.map((g) => {
    const manual = g.progress_manual === null ? null : Math.round(Number(g.progress_manual));
    return {
      id: g.id, title: g.title,
      progress: manual !== null ? manual : (g.progress === null ? null : Math.round(Number(g.progress))),
      counted: Number(g.counted ?? 0),
      level: g.period_type === "year" ? "연간" : g.period_type === "quarter" ? "분기" : "월",
    };
  });
  const annualLabel = today.slice(0, 4);

  // ── 홈 재편 §3-1: 다가오는 일정 (회의 event + 마감 task, 오늘~+14일) ──
  const in14 = addDays(today, 14);
  const upEvents = await query<{ id: number; title: string; start_at: string }>(
    `SELECT id, title, start_at::text FROM event
     WHERE is_active = true AND start_at >= $1::timestamptz AND start_at < $2::timestamptz
     ORDER BY start_at LIMIT 6`,
    [kstDayStart(today), kstDayStart(in14)]
  );
  // A1: 미래만 — 오늘 이상 ~ +14일. 지난 마감은 제외(타임라인 지연 표시로만).
  const upTasks = await query<{ id: number; title: string; due_date: string }>(
    `SELECT t.id, t.title, t.due_date::text FROM task t
     WHERE ${OPEN_TASK} AND ${mineOk(viewerId)} AND t.due_date IS NOT NULL
       AND t.due_date >= $1::date AND t.due_date <= $2::date
     ORDER BY t.due_date LIMIT 8`,
    [today, in14]
  );
  // (b) 예정 리뷰세션 — scheduled_at 미래(0012에서 컬럼 추가, 없으면 결과 없음)
  const upReviews = await query<{ id: number; title: string; scheduled_at: string }>(
    `SELECT id, title, scheduled_at::text FROM review_session
     WHERE is_active = true AND scheduled_at IS NOT NULL
       AND scheduled_at >= $1::timestamptz AND scheduled_at < $2::timestamptz
     ORDER BY scheduled_at LIMIT 6`,
    [kstDayStart(today), kstDayStart(in14)]
  );
  const upcoming = [
    ...upEvents.map((e) => ({
      key: `e${e.id}`, kind: "meeting" as const, title: e.title,
      date: isoify(e.start_at).slice(0, 10), dday: null, overdue: false,
    })),
    ...upReviews.map((r) => ({
      key: `r${r.id}`, kind: "review" as const, title: r.title,
      date: isoify(r.scheduled_at).slice(0, 10), dday: null, overdue: false,
    })),
    ...upTasks.map((t) => ({
      key: `t${t.id}`, kind: "deadline" as const, title: t.title,
      date: t.due_date, dday: dday(t.due_date, today), overdue: false,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);

  // ── 홈 재편 §3-3: 결정 대기 (논의중, 오래된 것 먼저) ──
  const decisionRows = await query<{
    id: number; title: string; author_name: string; comment_count: string; age_days: string;
  }>(
    `SELECT s.id, s.title, a.display_name AS author_name,
            (SELECT count(*) FROM comment c WHERE c.signal_id = s.id) AS comment_count,
            floor(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400) AS age_days
     FROM signal s JOIN actor a ON a.id = s.author_id
     WHERE s.is_active = true AND s.status = 'discussing'
       AND ${signalVisibilityClause("$1")}
     ORDER BY s.created_at ASC LIMIT 3`,
    [viewerId]
  );
  const decisionsWaiting = decisionRows.map((d) => ({
    id: d.id, title: d.title, authorName: d.author_name,
    commentCount: Number(d.comment_count), ageDays: Number(d.age_days),
    alert: Number(d.age_days) > 14,
  }));

  // ── 홈 재편 §3-3: 나의 초점 (안읽은 멘션 + 승인 대기 + 오늘/지연 내 업무) ──
  const myFocus: HomeSummary["myFocus"] = [];
  const mentionRows = await query<{ id: number; snippet: string; ref_type: string; ref_id: number | null; created_at: string }>(
    `SELECT id, snippet, ref_type, ref_id, created_at::text FROM notification
     WHERE user_id = $1 AND type = 'mention' AND read = false
     ORDER BY created_at DESC LIMIT 4`,
    [viewerId]
  );
  const refHref = (refType: string, refId: number | null) =>
    refType === "signal" ? `/signals?signal=${refId}` : refType === "task" ? `/tasks?task=${refId}` : "/notifications";
  for (const m of mentionRows) {
    myFocus.push({ key: `m${m.id}`, kind: "mention", summary: m.snippet, time: isoify(m.created_at), href: refHref(m.ref_type, m.ref_id), unread: true });
  }
  // 답글 (§D4) — 멘션과 같은 알림 테이블. 아이콘만 다르다.
  const replyRows = await query<{ id: number; snippet: string; ref_type: string; ref_id: number | null; created_at: string; read: boolean }>(
    `SELECT id, snippet, ref_type, ref_id, created_at::text, read FROM notification
     WHERE user_id = $1 AND type = 'reply'
     ORDER BY read ASC, created_at DESC LIMIT 3`,
    [viewerId]
  );
  for (const r of replyRows) {
    myFocus.push({ key: `r${r.id}`, kind: "reply", summary: r.snippet, time: isoify(r.created_at), href: refHref(r.ref_type, r.ref_id), unread: !r.read });
  }
  if (myTurn > 0) {
    myFocus.push({ key: "approval", kind: "approval", summary: `승인 대기 ${myTurn}건 — 확정이 필요해요`, time: null, href: "/inbox", unread: true });
  }
  const myTaskRows = await query<{ id: number; title: string; due_date: string }>(
    `SELECT id, title, due_date::text FROM task t
     WHERE ${OPEN_TASK} AND ${mineOk(viewerId)} AND t.assignee_id = $1
       AND t.due_date IS NOT NULL AND t.due_date <= $2::date
     ORDER BY t.due_date ASC LIMIT 4`,
    [viewerId, today]
  );
  for (const t of myTaskRows) {
    const over = t.due_date < today;
    myFocus.push({ key: `t${t.id}`, kind: "task", summary: `${over ? "지연" : "오늘 마감"} · ${t.title}`, time: null, href: `/tasks?task=${t.id}`, unread: over });
  }

  // 에이전트 상태 + 실사용량 (나의 초점 하단 칩)
  const credit = await creditState(viewerId);
  const myAgentStatus = assistantStatusOf(viewerId);
  const agentWon = Math.max(0, Math.round((credit.spent / 1000) * 6));

  // 인사말 보조 문구 — 데이터에서 도출
  const oldestStalledDecision = signalItems.find((s) => s.type === "decision" && s.stalled);
  const greetingSub = oldestStalledDecision
    ? `결정 대기 논의가 임계값을 넘겼어요. 먼저 처리하는 게 좋겠습니다.`
    : overdueTasks > 0
      ? `지연된 업무가 ${overdueTasks}건 있어요.`
      : `막힌 곳 없이 순항 중입니다.`;

  /**
   * §C3 레일 「팀 활동」 — 쿼리 **1개**.
   *
   * **120건을 읽는다.** 측정으로 정한 값이다 —
   * 30/40/60건은 5줄, **80건에서 6줄이 차고** 120건부터는 더 안 늘었다(포화).
   * 일괄 작업 한 번이 40건을 먹어서 60건까지 안 찼던 것이다.
   * 문턱의 1.5배를 잡아 오늘보다 큰 일괄 작업이 한 번 더 있어도 여섯 줄이 차게 했다.
   *
   * **6줄을 못 채우면 그대로 둔다.** 더 읽지 않는다 — 일괄 등록 한 번이 수천 건일 수 있고,
   * 여섯 줄을 쫓아 그걸 다 훑는 것은 값에 비해 비싸다. **3줄은 빈 카드가 아니라 사실이다.**
   *
   * 거르는 것과 묶는 것 **둘 다 서버에서** 한다. 화면에서 하면 120건을 받아 6건만 그린다.
   */
  const teamActivity = rollActivity(
    (await recentActivity(120, undefined, viewerId)).filter((a) => isRailActivity(a.message)),
    6
  );

  return {
    today,
    teamActivity,
    greetingName: viewer?.short_name || viewer?.display_name || "",
    greetingSub,
    metrics,
    lanes,
    // 담당 없는 업무도 목록에는 남아야 한다 — 레인에서 빠지는 것과 목록에서 빠지는 것은 다르다.
    openTasks: laneTasks.map((t) => ({
      id: t.id, title: t.title, startDate: t.start_date, dueDate: t.due_date,
      status: t.status, colorKey: t.color_key, projectName: t.project_name,
      areaName: t.area_name, areaColorKey: t.area_color, origin: t.origin,
      assigneeId: t.assignee_id, assigneeName: t.assignee_name, priority: t.priority,
      blocked: t.blocked, blockedBy: t.blocked_by,
      blockingOthers: t.blocking_others, blockingWho: t.blocking_who,
      late: !!t.due_date && t.due_date < today,
      dday: t.due_date ? dday(t.due_date, today) : null,
      progress: t.progress ?? 0,
    })),
    events: events.map((e) => ({
      id: e.id,
      title: e.title,
      startAt: isoify(e.start_at),
      endAt: isoify(e.end_at),
      colorKey: e.color_key,
      isTeam: e.is_team,
      participantIds: e.participant_ids ?? [],
    })),
    eventCount: events.length,
    taskCount: lanes.reduce((sum, lane) => sum + lane.tasks.length, 0),
    monthGoals,
    projectProgress: projectProgress.map((p) => ({
      id: p.id,
      name: p.name,
      colorKey: p.color_key,
      total: Number(p.total),
      done: Number(p.done),
      percent:
        Number(p.total) > 0 && p.avg_progress !== null ? Math.round(Number(p.avg_progress)) : null,
    })),
    weeklyDone,
    assigneeLoad,
    isoWeek,
    dueSoon: dueSoonRows.map((t) => ({
      id: t.id,
      title: t.title,
      projectName: t.project_name,
      colorKey: t.color_key,
      assigneeId: t.assignee_id,
      assigneeName: t.assignee_name,
      status: t.status,
      dueDate: t.due_date,
      dday: dday(t.due_date, today),
      overdue: t.due_date < today,
    })),
    signals,
    stalledCount: stalledSignals.length,
    huddles: huddles.map((h) => ({
      id: h.id,
      title: h.title,
      body: h.body,
      authorName: h.author_name,
      commentCount: Number(h.comment_count),
    })),
    annualGoals,
    myGoalCount,
    myGoals,
    annualLabel,
    quarterGoals,
    quarterLabel,
    upcoming,
    decisionsWaiting,
    myFocus,
    teamStatus,
    decisionsThisWeek: await decisionsThisWeek(weekStart),
    agent: { status: myAgentStatus, spentTokens: credit.spent, won: agentWon },
  };
}
