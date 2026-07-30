// 홈 대시보드 집계 (Phase 3) — 모든 수치는 서버가 DB에서 산출한다 (금지 3: LLM 수치 생성 금지와 동일 원칙).
// /api/home/summary 라우트와 홈 서버 페이지가 공유한다.
import { query, queryOne, getInboxCount } from "./db";
import { getCurrentMonthGoals } from "./goals";
import { getDecidedStaleDays, signalVisibilityClause } from "./signals";
import { creditState } from "./agent";

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
  areaName: string | null;   // 히어로 영역 롤업용
  areaColorKey: string | null;
  origin: "human" | "agent";
  assigneeId: number | null;
  assigneeName: string | null;
  priority: string;          // high | mid | low (표기: 높음/보통/낮음)
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
    colorKey: string | null;
  }[];
  annualLabel: string; // 예: 2026
  quarterGoals: {
    id: number;
    title: string;
    progress: number | null;
    status: "ontrack" | "risk" | "wait";
    colorKey: string | null;
  }[];
  quarterLabel: string; // 예: 2026 Q3
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
  myFocus: {
    key: string;
    kind: "mention" | "approval" | "task";
    summary: string;
    time: string | null; // 멘션만 mono 시각
    href: string;
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

async function sparkSeries(sqlPerDay: (day: string) => Promise<number>, today: string): Promise<number[]> {
  const out: number[] = [];
  for (let i = 6; i >= 0; i--) out.push(await sqlPerDay(addDays(today, -i)));
  return out;
}

export async function buildHomeSummary(viewerId: number, isLead = false): Promise<HomeSummary> {
  const today = kstToday();
  const weekStartOffset = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 월요일 기준
  const weekStart = addDays(today, -weekStartOffset);
  const in7 = addDays(today, 7);

  // ── 지표 1: 진행 중 업무 (doing) ──
  const doingNow = (await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM task t WHERE t.is_active = true AND t.status = 'doing'`
  ))!.n;
  // 스파크: 일별 열린 업무 근사치 (생성됨 & 그 시점 미완료)
  const openSpark = await sparkSeries(
    async (day) =>
      Number(
        (await queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM task t
           WHERE t.is_active = true AND t.status <> 'proposed'
             AND t.created_at < $1::timestamptz
             AND (t.completed_at IS NULL OR t.completed_at >= $1::timestamptz)`,
          [kstDayStart(addDays(day, 1))]
        ))!.n
      ),
    today
  );
  const createdThisWeek = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task t
       WHERE t.is_active = true AND t.status <> 'proposed' AND t.created_at >= $1::timestamptz`,
      [kstDayStart(weekStart)]
    ))!.n
  );

  // ── 지표 2: 이번 주 완료 ──
  const doneThisWeek = Number(
    (await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task t
       WHERE t.is_active = true AND t.status = 'done' AND t.completed_at >= $1::timestamptz`,
      [kstDayStart(weekStart)]
    ))!.n
  );
  const weekDenominator =
    doneThisWeek +
    Number(
      (await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM task t
         WHERE ${OPEN_TASK} AND t.due_date >= $1::date AND t.due_date < $2::date`,
        [weekStart, addDays(weekStart, 7)]
      ))!.n
    );
  const doneSpark = await sparkSeries(
    async (day) =>
      Number(
        (await queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM task t
           WHERE t.is_active = true AND t.status = 'done'
             AND t.completed_at >= $1::timestamptz AND t.completed_at < $2::timestamptz`,
          [kstDayStart(day), kstDayStart(addDays(day, 1))]
        ))!.n
      ),
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
       WHERE t.is_active = true AND t.status = 'review' AND t.assignee_id = $1`,
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
      `SELECT count(*) AS n FROM task t WHERE ${OPEN_TASK} AND t.due_date < $1::date`,
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
    async (day) =>
      Number(
        (await queryOne<{ n: string }>(
          `SELECT count(*) AS n FROM task t
           WHERE t.is_active = true AND t.status <> 'proposed' AND t.status <> 'dropped'
             AND t.due_date < $1::date
             AND (t.completed_at IS NULL OR t.completed_at >= $2::timestamptz)`,
          [day, kstDayStart(day)]
        ))!.n
      ),
    today
  );

  // 막힌 업무(blocked 플래그) — 진행 불가 신호. 대표 사유 1줄(가장 오래 막힌 것).
  const blockedRow = await queryOne<{ n: string; reason: string | null }>(
    `SELECT count(*) AS n,
            (SELECT blocked_reason FROM task
             WHERE is_active = true AND blocked = true AND status <> 'proposed'
             ORDER BY blocked_since ASC NULLS LAST LIMIT 1) AS reason
     FROM task WHERE is_active = true AND blocked = true AND status <> 'proposed'`
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
  }>(
    `SELECT t.id, t.title, t.start_date::text, t.due_date::text, t.status, p.color_key,
            ar.name AS area_name, ar.color_key AS area_color,
            t.origin, t.assignee_id, ac.display_name AS assignee_name, t.priority, t.progress
     FROM task t
     LEFT JOIN project p ON p.id = t.project_id
     LEFT JOIN area ar ON ar.id = t.area_id
     LEFT JOIN actor ac ON ac.id = t.assignee_id
     WHERE ${OPEN_TASK}
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
        areaName: t.area_name,
        areaColorKey: t.area_color,
        origin: t.origin,
        assigneeId: t.assignee_id,
        assigneeName: t.assignee_name,
        priority: t.priority,
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

  // ── 프로젝트 진행 (구 관제뷰 "프로젝트별 진행률" 흡수) — 활성 업무 완료율 ──
  // 프로젝트 진척도 = 소속(비proposed) task 진행률 평균 (수동 progress 반영). done/total은 라벨용.
  const projectProgress = await query<{
    id: number;
    name: string;
    color_key: string | null;
    total: string;
    done: string;
    avg_progress: string | null;
  }>(
    `SELECT p.id, p.name, p.color_key,
            count(t.id) FILTER (WHERE t.status <> 'proposed') AS total,
            count(t.id) FILTER (WHERE t.status = 'done') AS done,
            avg(CASE WHEN t.status = 'done' THEN 100 ELSE t.progress END) FILTER (WHERE t.status <> 'proposed') AS avg_progress
     FROM project p
     LEFT JOIN task t ON t.project_id = p.id AND t.is_active = true
     WHERE p.is_active = true
     GROUP BY p.id
     ORDER BY p.id`
  );

  // ── 현황 분석 (파트 2) — 서버 집계만. LLM 수치생성 금지. ──
  // 주간 완료 추이: 최근 8주 완료 건수 (오래된→최신, 마지막이 이번 주)
  const weeklyDone: { weekStart: string; count: number }[] = [];
  for (let i = 7; i >= 0; i--) {
    const ws = addDays(weekStart, -7 * i);
    const count = Number(
      (await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM task t
         WHERE t.is_active = true AND t.status = 'done'
           AND t.completed_at >= $1::timestamptz AND t.completed_at < $2::timestamptz`,
        [kstDayStart(ws), kstDayStart(addDays(ws, 7))]
      ))!.n
    );
    weeklyDone.push({ weekStart: ws, count });
  }
  // 담당자별 부하: 오픈 업무(todo/doing/review)를 상태별로 (진행 / 대기·리뷰). 부하순 정렬.
  const assigneeLoadRows = await query<{ name: string; doing: string; waiting: string }>(
    `SELECT ac.display_name AS name,
            count(*) FILTER (WHERE t.status = 'doing') AS doing,
            count(*) FILTER (WHERE t.status IN ('todo', 'review')) AS waiting
     FROM actor ac
     JOIN task t ON t.assignee_id = ac.id AND t.is_active = true AND t.status IN ('todo', 'doing', 'review')
     WHERE ac.type = 'human' AND ac.is_active = true
       AND ac.id NOT IN (SELECT actor_id FROM account WHERE email = 'robodynesystems')
     GROUP BY ac.display_name
     ORDER BY count(*) DESC`
  );
  const assigneeLoad = assigneeLoadRows.map((a) => ({
    name: a.name, doing: Number(a.doing), waiting: Number(a.waiting),
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
     WHERE ${OPEN_TASK} AND t.due_date IS NOT NULL AND t.due_date <= $1::date
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
    elapsed: string; period_start: string;
  }>(
    `SELECT g.id, g.title, g.progress::text, p.color_key,
            LEAST(1, GREATEST(0, EXTRACT(EPOCH FROM (now() - g.period_start)) /
              NULLIF(EXTRACT(EPOCH FROM ((g.period_end + interval '1 day') - g.period_start)), 0)))::text AS elapsed,
            to_char(g.period_start, 'YYYY') AS period_start
     FROM goal g LEFT JOIN project p ON p.id = g.project_id
     WHERE g.is_active = true AND g.period_type = 'quarter'
       AND g.period_start <= $1::date AND g.period_end >= $1::date
     ORDER BY g.id`,
    [today]
  );
  const quarterGoals = quarterRows.map((g) => {
    const prog = g.progress === null ? null : Math.round(Number(g.progress));
    const elapsed = Number(g.elapsed) * 100; // 분기 경과 %
    let status: "ontrack" | "risk" | "wait";
    if (prog === null || prog === 0) status = "wait";
    else if (prog < elapsed - 15) status = "risk"; // 일정 대비 15%p 이상 지연
    else status = "ontrack";
    return { id: g.id, title: g.title, progress: prog, status, colorKey: g.color_key };
  });
  // 정렬: 리스크 > 온트랙 > 대기
  const statusRank = { risk: 0, ontrack: 1, wait: 2 } as const;
  quarterGoals.sort((a, b) => statusRank[a.status] - statusRank[b.status]);
  const qNum = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const quarterLabel = `${today.slice(0, 4)} Q${qNum}`;

  // §C: 연간 목표 (level=annual, 올해 커버) — 상단 큰 게이지
  const annualRows = await query<{ id: number; title: string; progress: string | null; color_key: string | null }>(
    `SELECT g.id, g.title, g.progress::text, p.color_key
     FROM goal g LEFT JOIN project p ON p.id = g.project_id
     WHERE g.is_active = true
       AND (g.level = 'annual' OR g.period_type = 'year')
       AND g.period_start <= $1::date AND g.period_end >= $1::date
     ORDER BY g.id LIMIT 2`,
    [today]
  );
  const annualGoals = annualRows.map((g) => ({
    id: g.id, title: g.title,
    progress: g.progress === null ? null : Math.round(Number(g.progress)),
    colorKey: g.color_key,
  }));
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
     WHERE ${OPEN_TASK} AND t.due_date IS NOT NULL
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
  for (const m of mentionRows) {
    const href = m.ref_type === "signal" ? `/signals?signal=${m.ref_id}` : m.ref_type === "task" ? `/tasks?task=${m.ref_id}` : "/notifications";
    myFocus.push({ key: `m${m.id}`, kind: "mention", summary: m.snippet, time: isoify(m.created_at), href });
  }
  if (myTurn > 0) {
    myFocus.push({ key: "approval", kind: "approval", summary: `승인 대기 ${myTurn}건 — 확정이 필요해요`, time: null, href: "/inbox" });
  }
  const myTaskRows = await query<{ id: number; title: string; due_date: string }>(
    `SELECT id, title, due_date::text FROM task t
     WHERE ${OPEN_TASK} AND t.assignee_id = $1 AND t.due_date IS NOT NULL AND t.due_date <= $2::date
     ORDER BY t.due_date ASC LIMIT 4`,
    [viewerId, today]
  );
  for (const t of myTaskRows) {
    const over = t.due_date < today;
    myFocus.push({ key: `t${t.id}`, kind: "task", summary: `${over ? "지연" : "오늘 마감"} · ${t.title}`, time: null, href: `/tasks?task=${t.id}` });
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

  return {
    today,
    greetingName: viewer?.short_name || viewer?.display_name || "",
    greetingSub,
    metrics,
    lanes,
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
    annualLabel,
    quarterGoals,
    quarterLabel,
    upcoming,
    decisionsWaiting,
    myFocus,
    agent: { status: myAgentStatus, spentTokens: credit.spent, won: agentWon },
  };
}
