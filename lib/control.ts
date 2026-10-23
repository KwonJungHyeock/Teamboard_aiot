// 관제 — 팀 목표 · 데이터 · 사람 · 위험 신호를 한 번에 모은다 (2026-10 관제 패널).
//
// ── 감시가 아니라 **막힌 데를 같이 보는** 화면이다 ────────────────
//
// 지시: 「팀 전체가 같은 화면」. 그래서 팀장 전용 숫자가 없다 — 누가 열어도 같은
// 것을 본다. 대신 **업무 공개 규칙은 그대로 지킨다**: 남의 비공개 업무는 숫자에도
// 이름에도 안 들어간다(`visibleTaskSql`). 사람별 줄도 같은 거르개를 지난다.
//
// 「얼마나 오래 앉아 있었나」 같은 것은 재지 않는다. 일의 상태(지남 · 소식 없음 ·
// 몰림)만 본다. 마지막 기록 시각은 팀 활동(`activity_log` · `activity`)에서만 온다 —
// 개인 기록(`work_log`)은 시각조차 안 쓴다.
//
// ── 기준은 여기 한 곳 ───────────────────────────────────────────
// 아침 알림(`lib/control-watch.ts`)도 같은 기준을 쓴다. 두 벌이면 화면과 알림이 갈린다.
//
// **서버 전용.** `pg` 를 끌고 오므로 클라이언트 부품은 이 파일을 import 하지 않는다
// (화면은 서버 페이지가 만든 값을 props 로 받는다).
import { query, queryOne } from "./db";
import { visibleTaskSql } from "./visibility";
import { kstToday } from "./home";
import { effectiveGoalStatus, elapsedRatio, type GoalStatus } from "./progress";

/** 진행 · 검토인데 이만큼 손이 안 닿았으면 「소식 없음」 */
export const QUIET_DAYS = 3;
/** 이번 주(일요일까지) 마감이 이만큼이면 「몰림」 */
export const HEAVY_WEEK = 3;
/** 안 끝난 일이 이만큼이면 「몰림」 */
export const HEAVY_OPEN = 6;
/** 이 안에 활동이 있으면 「작업 중」 — 사람 고리가 돌고 타일 테두리가 숨쉰다 */
export const LIVE_MINUTES = 30;
/**
 * 「주의」 기준 — 남은 날에 비해 덜 된 일. 하루에 12%p 는 해야 마감에 닿는다고 본다
 * (8일 남짓 걸리는 일 기준). 남은 날 × 12 를 100 에서 뺀 것보다 진행률이 낮으면 주의.
 */
export const PACE_PER_DAY = 12;

const OPEN = `('todo','doing','review')`;

export interface ControlGoal {
  id: number; title: string; level: "year" | "quarter" | "month";
  periodStart: string; periodEnd: string;
  progress: number | null; elapsed: number; status: GoalStatus | null;
}
export interface ControlPerson {
  id: number; name: string; role: string | null;
  nowTitle: string | null; nowId: number | null;
  open: number; late: number; quiet: number; week: number;
  heavy: boolean; lastSeen: string | null;
  /** `LIVE_MINUTES` 안에 활동이 있었나 */
  working: boolean;
}
export interface ControlSignal {
  kind: "late" | "quiet" | "heavy";
  taskId: number | null; title: string; who: string | null; days: number;
}
/** 안내판 · 타일이 함께 쓰는 상태 낱말 다섯 */
export type BoardState = "ok" | "warn" | "late" | "review" | "done";
export interface BoardRow {
  id: number; title: string; who: string | null; due: string; state: BoardState; progress: number;
}
export interface WallTile {
  id: number; title: string; who: string | null; due: string | null; state: BoardState; live: boolean; progress: number;
}
export interface WallGroup { id: number; title: string; progress: number | null; tiles: WallTile[]; more: number }
export interface FeedItem { at: string; kind: "done" | "new" | "touch"; title: string; who: string | null; taskId: number }
export interface ControlData {
  today: string;
  kpi: { doing: number; doneToday: number; late: number; quiet: number; open: number };
  flow: { day: string; done: number; made: number }[];
  goals: ControlGoal[];
  people: ControlPerson[];
  signals: ControlSignal[];
  board: BoardRow[];
  /** 2주 넘게 밀린 안 끝난 업무 수 — 안내판에는 줄 대신 이 수만 */
  oldLate: number;
  wall: WallGroup[];
  /** 지금 기간 분기 목표에 안 걸린 안 끝난 업무 수 */
  loose: number;
  feed: FeedItem[];
}

/** 이번 주 일요일(서울 날짜) — `lib/v3/today.ts` 의 `weekEnd` 와 같은 정의 */
function weekEnd(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? 0 : 7 - dow));
  return d.toISOString().slice(0, 10);
}

export async function getControl(viewerId: number): Promise<ControlData> {
  const today = kstToday();
  const wk = weekEnd(today);
  const vis = visibleTaskSql("$1");
  const quiet = `t.status IN ('doing','review') AND t.updated_at < now() - interval '${QUIET_DAYS} days'`;
  const lateSql = `t.status IN ${OPEN} AND t.due_date < $2::date`;

  const k = await queryOne<{ doing: string; done_today: string; late: string; quiet: string; open: string }>(
    `SELECT count(*) FILTER (WHERE t.status = 'doing') AS doing,
            count(*) FILTER (WHERE t.status = 'done'
                               AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date = $2::date) AS done_today,
            count(*) FILTER (WHERE ${lateSql}) AS late,
            count(*) FILTER (WHERE ${quiet}) AS quiet,
            count(*) FILTER (WHERE t.status IN ${OPEN}) AS open
       FROM task t WHERE t.is_active AND ${vis}`,
    [viewerId, today]
  );

  const flow = await query<{ day: string; done: string; made: string }>(
    `SELECT d::date::text AS day,
            (SELECT count(*) FROM task t WHERE t.is_active AND ${vis} AND t.status = 'done'
               AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date = d::date) AS done,
            (SELECT count(*) FROM task t WHERE t.is_active AND ${vis}
               AND (t.created_at AT TIME ZONE 'Asia/Seoul')::date = d::date) AS made
       FROM generate_series($2::date - 13, $2::date, interval '1 day') AS d
      ORDER BY d`,
    [viewerId, today]
  );

  const goalRows = await query<{
    id: number; title: string; period_type: "year" | "quarter" | "month";
    period_start: string; period_end: string; progress: number | null; status_manual: string | null;
  }>(
    `SELECT g.id, g.title, g.period_type, g.period_start::text, g.period_end::text, g.progress, g.status_manual
       FROM goal g
      WHERE g.is_active AND g.scope = 'team' AND g.period_start <= $1::date AND g.period_end >= $1::date
      ORDER BY CASE g.period_type WHEN 'year' THEN 0 WHEN 'quarter' THEN 1 ELSE 2 END, g.id`,
    [today]
  );

  const peopleRows = await query<{
    id: number; name: string; role: string | null; now_title: string | null; now_id: number | null;
    open: string; late: string; quiet: string; week: string; last_seen: string | null; working: boolean | null;
  }>(
    `SELECT a.id, a.display_name AS name, ac.role,
            nw.title AS now_title, nw.id AS now_id,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND t.status IN ${OPEN}) AS open,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND ${lateSql}) AS late,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND ${quiet}) AS quiet,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND t.status IN ${OPEN}
                AND t.due_date BETWEEN $2::date AND $3::date) AS week,
            greatest((SELECT max(l.created_at) FROM activity_log l WHERE l.user_id = a.id),
                     (SELECT max(v.created_at) FROM activity v WHERE v.actor_id = a.id))::text AS last_seen,
            greatest((SELECT max(l.created_at) FROM activity_log l WHERE l.user_id = a.id),
                     (SELECT max(v.created_at) FROM activity v WHERE v.actor_id = a.id))
              > now() - interval '${LIVE_MINUTES} minutes' AS working
       FROM actor a
       LEFT JOIN account ac ON ac.actor_id = a.id
       LEFT JOIN LATERAL (
         SELECT t.id, t.title FROM task t
          WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND t.status = 'doing'
          ORDER BY t.updated_at DESC LIMIT 1) nw ON true
      WHERE a.type = 'human' AND a.is_active AND coalesce(ac.role, 'member') <> 'viewer'
      ORDER BY (ac.role IN ('admin','lead')) DESC NULLS LAST, a.id`,
    [viewerId, today, wk]
  );

  const sig = await query<{ kind: "late" | "quiet"; id: number; title: string; who: string | null; days: number }>(
    `(SELECT 'late' AS kind, t.id, t.title, a.display_name AS who, ($2::date - t.due_date) AS days
        FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active AND ${vis} AND ${lateSql}
       ORDER BY t.due_date ASC, t.id LIMIT 6)
     UNION ALL
     (SELECT 'quiet' AS kind, t.id, t.title, a.display_name AS who,
             ($2::date - (t.updated_at AT TIME ZONE 'Asia/Seoul')::date) AS days
        FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active AND ${vis} AND ${quiet} AND NOT coalesce((${lateSql}), false)
       ORDER BY t.updated_at ASC, t.id LIMIT 6)`,
    [viewerId, today]
  );

  const people: ControlPerson[] = peopleRows.map((p) => {
    const open = Number(p.open), week = Number(p.week);
    return {
      id: p.id, name: p.name, role: p.role, nowTitle: p.now_title, nowId: p.now_id,
      open, late: Number(p.late), quiet: Number(p.quiet), week,
      heavy: week >= HEAVY_WEEK || open >= HEAVY_OPEN, lastSeen: p.last_seen, working: !!p.working,
    };
  });

  const signals: ControlSignal[] = [
    ...sig.map((s) => ({ kind: s.kind, taskId: s.id, title: s.title, who: s.who, days: Number(s.days) })),
    ...people.filter((p) => p.heavy).map((p) => ({
      kind: "heavy" as const, taskId: null, title: `진행 ${p.open}건 · 이번 주 마감 ${p.week}건`, who: p.name, days: 0,
    })),
  ];

  /* ── 마감 안내판 — 2주 안 마감 + 오늘 끝낸 것. 지난 것부터 ─────────── */
  const stateSql = `CASE
      WHEN t.status = 'done' THEN 'done'
      WHEN t.due_date < $2::date THEN 'late'
      WHEN t.status = 'review' THEN 'review'
      WHEN (${quiet}) OR t.progress < 100 - ${PACE_PER_DAY} * (t.due_date - $2::date) THEN 'warn'
      ELSE 'ok' END`;
  /*
   * 안내판은 **다가오는 마감**이 주인공이다. 오래 밀린 일(2주 넘게 지남)이 판을 다 차지하면
   * 내일 마감이 안 보인다 — 실제 데이터로 캡처해 보니 100일 넘게 밀린 일이 판을 채웠다.
   * 그래서: 최근 2주 안에 지난 것 3줄까지 + 오늘부터 2주 안 + 오늘 끝낸 것. 오래 밀린 것은 수만 센다.
   */
  const boardRows = await query<{ id: number; title: string; who: string | null; due: string; state: BoardState; progress: number }>(
    `(SELECT t.id, t.title, a.display_name AS who, t.due_date::text AS due, ${stateSql} AS state, t.progress, 0 AS grp
        FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active AND ${vis} AND t.status IN ${OPEN}
         AND t.due_date < $2::date AND t.due_date >= $2::date - 14
       ORDER BY t.due_date DESC, t.id LIMIT 3)
     UNION ALL
     (SELECT t.id, t.title, a.display_name, t.due_date::text, ${stateSql}, t.progress, 1
        FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active AND ${vis} AND t.due_date IS NOT NULL
         AND ((t.status IN ${OPEN} AND t.due_date BETWEEN $2::date AND $2::date + 14)
           OR (t.status = 'done' AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date = $2::date))
       ORDER BY (t.status = 'done'), t.due_date ASC, t.id LIMIT 7)`,
    [viewerId, today]
  );
  const oldLate = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM task t
      WHERE t.is_active AND ${vis} AND t.status IN ${OPEN} AND t.due_date < $2::date - 14`,
    [viewerId, today]
  );

  /* ── 상태 벽 — 지금 분기 팀 목표마다, 그 목표(와 아래 월 목표 · 그 프로젝트)에 걸린 업무 ── */
  const quarters = await query<{ id: number; title: string; progress: number | null }>(
    `SELECT g.id, g.title, g.progress FROM goal g
      WHERE g.is_active AND g.scope = 'team' AND g.period_type = 'quarter'
        AND g.period_start <= $1::date AND g.period_end >= $1::date
      ORDER BY g.id LIMIT 4`,
    [today]
  );
  const qids = quarters.map((q) => q.id);
  const tileRows = qids.length === 0 ? [] : await query<{
    gid: number; id: number; title: string; who: string | null; due: string | null; state: BoardState; live: boolean; progress: number;
  }>(
    `WITH tree AS (
       SELECT q.id AS gid, q.id AS goal_id FROM goal q WHERE q.id = ANY($3::int[])
       UNION ALL
       SELECT c.parent_id, c.id FROM goal c WHERE c.is_active AND c.parent_id = ANY($3::int[])
     ), linked AS (
       SELECT tr.gid, gt.task_id FROM tree tr JOIN goal_task gt ON gt.goal_id = tr.goal_id
       UNION
       SELECT tr.gid, t.id FROM tree tr JOIN project p ON p.goal_id = tr.goal_id
         JOIN task t ON t.project_id = p.id
     )
     SELECT DISTINCT ON (l.gid, t.id) l.gid, t.id, t.title, a.display_name AS who, t.due_date::text AS due,
            ${stateSql.replace("t.due_date - $2::date", "coalesce(t.due_date, $2::date + 14) - $2::date").replace("WHEN t.due_date < $2::date", "WHEN t.due_date IS NOT NULL AND t.due_date < $2::date")} AS state,
            (t.status = 'doing' AND (t.updated_at > now() - interval '${LIVE_MINUTES} minutes'
              OR EXISTS (SELECT 1 FROM activity_log al WHERE al.task_id = t.id
                           AND al.created_at > now() - interval '${LIVE_MINUTES} minutes'))) AS live,
            t.progress
       FROM linked l JOIN task t ON t.id = l.task_id
       LEFT JOIN actor a ON a.id = t.assignee_id
      WHERE t.is_active AND ${vis} AND t.parent_task_id IS NULL
        AND (t.status IN ${OPEN} OR (t.status = 'done' AND t.completed_at > now() - interval '3 days'))`,
    [viewerId, today, qids]
  );
  const order: Record<BoardState, number> = { late: 0, warn: 1, review: 2, ok: 3, done: 4 };
  const wall: WallGroup[] = quarters.map((q) => {
    // 지금 손대는 칸이 맨 앞 — 밀린 일이 많은 목표에서 「지금」이 9칸 밖으로 밀려나지 않게(검사기로 찾았다)
    const all = tileRows.filter((r) => r.gid === q.id)
      .sort((a, b) => Number(!!b.live) - Number(!!a.live) || order[a.state] - order[b.state]
        || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
    return {
      id: q.id, title: q.title, progress: q.progress, more: Math.max(0, all.length - 9),
      tiles: all.slice(0, 9).map((r) => ({ id: r.id, title: r.title, who: r.who, due: r.due, state: r.state, live: !!r.live, progress: r.progress })),
    };
  });
  const linkedIds = new Set(tileRows.map((r) => r.id));
  const looseRow = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM task t
      WHERE t.is_active AND ${vis} AND t.status IN ${OPEN} AND t.parent_task_id IS NULL
        AND NOT (t.id = ANY($2::int[]))`,
    [viewerId, Array.from(linkedIds)]
  );

  /* ── 흐르는 띠 — 업무 표에서 바로(끝냄 · 새로 · 손댐). 공개 규칙을 지난 것만 ── */
  const feedRows = await query<{ at: string; kind: FeedItem["kind"]; title: string; who: string | null; id: number }>(
    `SELECT * FROM (
       SELECT t.completed_at AS ts, 'done' AS kind, t.title, a.display_name AS who, t.id
         FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
        WHERE t.is_active AND ${vis} AND t.status = 'done' AND t.completed_at > now() - interval '2 days'
       UNION ALL
       SELECT t.created_at, 'new', t.title, c.display_name, t.id
         FROM task t LEFT JOIN actor c ON c.id = t.created_by
        WHERE t.is_active AND ${vis} AND t.created_at > now() - interval '2 days'
       UNION ALL
       SELECT t.updated_at, 'touch', t.title, a.display_name, t.id
         FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
        WHERE t.is_active AND ${vis} AND t.status IN ('doing','review') AND t.updated_at > now() - interval '1 day'
     ) x(ts, kind, title, who, id)
     ORDER BY ts DESC LIMIT 10`.replace("SELECT * FROM", "SELECT to_char(ts AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS at, kind, title, who, id FROM"),
    [viewerId]
  );

  return {
    today,
    board: boardRows.map((b) => ({ id: b.id, title: b.title, who: b.who, due: b.due, state: b.state, progress: Number(b.progress) })),
    oldLate: Number(oldLate?.n ?? 0),
    wall,
    loose: Number(looseRow?.n ?? 0),
    feed: feedRows.map((f) => ({ at: f.at, kind: f.kind, title: f.title, who: f.who, taskId: f.id })),
    kpi: {
      doing: Number(k?.doing ?? 0), doneToday: Number(k?.done_today ?? 0),
      late: Number(k?.late ?? 0), quiet: Number(k?.quiet ?? 0), open: Number(k?.open ?? 0),
    },
    flow: flow.map((f) => ({ day: f.day, done: Number(f.done), made: Number(f.made) })),
    goals: goalRows.map((g) => ({
      id: g.id, title: g.title, level: g.period_type, periodStart: g.period_start, periodEnd: g.period_end,
      progress: g.progress,
      elapsed: Math.round(elapsedRatio(g.period_start, g.period_end, today) * 100),
      status: effectiveGoalStatus(g, g.progress, today),
    })),
    people,
    signals,
  };
}
