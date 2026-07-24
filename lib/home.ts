// 홈 대시보드 집계 (Phase 3) — 모든 수치는 서버가 DB에서 산출한다 (금지 3: LLM 수치 생성 금지와 동일 원칙).
// /api/home/summary 라우트와 홈 서버 페이지가 공유한다.
import { query, queryOne } from "./db";
import { getCurrentMonthGoals } from "./goals";
import { getDecidedStaleDays, signalVisibilityClause } from "./signals";

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
  origin: "human" | "agent";
  assigneeId: number | null;
  late: boolean;
  dday: string | null; // D-3 / D+2
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
  isoWeek: number;
  dueSoon: {
    id: number;
    title: string;
    projectName: string | null;
    colorKey: string | null;
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

export async function buildHomeSummary(viewerId: number): Promise<HomeSummary> {
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

  // ── 지표 3: 평균 결정 소요 (최근 90일 해결된 decision) ──
  const decisionAvg = await queryOne<{ avg_days: string | null; n: string }>(
    `SELECT round(avg(EXTRACT(EPOCH FROM (s.resolved_at - s.created_at)) / 86400)::numeric, 1) AS avg_days,
            count(*) AS n
     FROM signal s
     WHERE s.is_active = true AND s.type = 'decision' AND s.resolved_at IS NOT NULL
       AND s.resolved_at > now() - interval '90 days'`
  );
  // 카드 숫자(90일 평균)와 동일 지표의 추세: 각 날짜 시점의 "직전 90일 평균 결정 소요일"
  const decisionSpark = await sparkSeries(
    async (day) =>
      Number(
        (await queryOne<{ avg_days: string | null }>(
          `SELECT round(avg(EXTRACT(EPOCH FROM (s.resolved_at - s.created_at)) / 86400)::numeric, 1) AS avg_days
           FROM signal s
           WHERE s.is_active = true AND s.type = 'decision' AND s.resolved_at IS NOT NULL
             AND s.resolved_at >= $1::timestamptz - interval '90 days'
             AND s.resolved_at < $1::timestamptz`,
          [kstDayStart(addDays(day, 1))]
        ))!.avg_days ?? 0
      ),
    today
  );

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

  const metrics: Metric[] = [
    {
      key: "doing",
      label: "진행 중 업무",
      value: doingNow,
      deltaText: `이번 주 신규 ${createdThisWeek}`,
      deltaTone: "up",
      spark: openSpark,
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
    },
    {
      key: "decision",
      label: "평균 결정 소요",
      value: decisionAvg?.avg_days ?? "—",
      em: decisionAvg?.avg_days ? "일" : undefined,
      deltaText: `최근 90일 결정 ${decisionAvg?.n ?? 0}건`,
      deltaTone: Number(decisionAvg?.avg_days ?? 0) > (thresholds.decision ?? 14) ? "dn" : "up",
      spark: decisionSpark,
    },
    {
      key: "stalled",
      label: "지연 · 정체",
      value: String(overdueTasks + stalledSignals.length),
      deltaText: `업무 ${overdueTasks} · 시그널 ${stalledSignals.length}`,
      deltaTone: "fl",
      spark: overdueSpark,
      alert: overdueTasks + stalledSignals.length > 0,
    },
  ];

  // ── 레인: 활성 human + 각자 열린 업무 (기한 임박 앞쪽 정렬, proposed 제외) ──
  const humans = await query<{ id: number; display_name: string }>(
    `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
  );
  const laneTasks = await query<{
    id: number;
    title: string;
    start_date: string | null;
    due_date: string | null;
    status: string;
    color_key: string | null;
    origin: "human" | "agent";
    assignee_id: number | null;
  }>(
    `SELECT t.id, t.title, t.start_date::text, t.due_date::text, t.status, p.color_key, t.origin, t.assignee_id
     FROM task t LEFT JOIN project p ON p.id = t.project_id
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
        origin: t.origin,
        assigneeId: t.assignee_id,
        late: !!t.due_date && t.due_date < today,
        dday: t.due_date ? dday(t.due_date, today) : null,
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
  const projectProgress = await query<{
    id: number;
    name: string;
    color_key: string | null;
    total: string;
    done: string;
  }>(
    `SELECT p.id, p.name, p.color_key,
            count(t.id) FILTER (WHERE t.status <> 'proposed') AS total,
            count(t.id) FILTER (WHERE t.status = 'done') AS done
     FROM project p
     LEFT JOIN task t ON t.project_id = p.id AND t.is_active = true
     WHERE p.is_active = true
     GROUP BY p.id
     ORDER BY p.id`
  );

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
    assignee_name: string | null;
    status: string;
    due_date: string;
  }>(
    `SELECT t.id, t.title, p.name AS project_name, p.color_key,
            a.display_name AS assignee_name, t.status, t.due_date::text
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
  // 에이전트 승인 대기 초안 → 에이전트 생성물로 패널에 표시 (구 관제뷰 "막힌 곳" 요소 흡수)
  const pendingDrafts = await query<{
    id: number;
    title: string;
    task_type: string;
    user_name: string;
    assistant_name: string;
  }>(
    `SELECT d.id, d.title, d.task_type, u.display_name AS user_name, a.display_name AS assistant_name
     FROM drafts d JOIN actor u ON u.id = d.user_id JOIN actor a ON a.id = d.assistant_id
     WHERE d.status = 'pending' ORDER BY d.created_at ASC LIMIT 6`
  );
  const draftItems: HomeSignal[] = pendingDrafts.map((d) => ({
    id: d.id,
    kind: "draft",
    type: "review",
    title: d.title,
    meta: `${d.assistant_name} 초안 · ${d.task_type} · ${d.user_name} 담당`,
    badge: "wait",
    badgeLabel: "승인 대기",
    agent: true,
    stalled: false,
  }));
  // 우선순위: 나에게 온 확인 요청 → risk → 미실행 결정 → 정체 → 승인 대기 초안 → 나머지
  const priority = signalItems.filter((s) => s.toMe || s.type === "risk" || s.decidedStale || s.stalled);
  const rest = signalItems.filter((s) => !priority.includes(s));
  const signals: HomeSignal[] = [...priority, ...draftItems, ...rest]
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

  // 인사말 보조 문구 — 데이터에서 도출
  const oldestStalledDecision = signalItems.find((s) => s.type === "decision" && s.stalled);
  const greetingSub = oldestStalledDecision
    ? `결정 대기 시그널이 임계값을 넘겼어요. 먼저 처리하는 게 좋겠습니다.`
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
        Number(p.total) > 0 ? Math.round((Number(p.done) / Number(p.total)) * 100) : null,
    })),
    isoWeek,
    dueSoon: dueSoonRows.map((t) => ({
      id: t.id,
      title: t.title,
      projectName: t.project_name,
      colorKey: t.color_key,
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
  };
}
