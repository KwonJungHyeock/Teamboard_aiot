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
}
export interface ControlSignal {
  kind: "late" | "quiet" | "heavy";
  taskId: number | null; title: string; who: string | null; days: number;
}
export interface ControlData {
  today: string;
  kpi: { doing: number; doneToday: number; late: number; quiet: number; open: number };
  flow: { day: string; done: number; made: number }[];
  goals: ControlGoal[];
  people: ControlPerson[];
  signals: ControlSignal[];
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
    open: string; late: string; quiet: string; week: string; last_seen: string | null;
  }>(
    `SELECT a.id, a.display_name AS name, ac.role,
            nw.title AS now_title, nw.id AS now_id,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND t.status IN ${OPEN}) AS open,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND ${lateSql}) AS late,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND ${quiet}) AS quiet,
            (SELECT count(*) FROM task t WHERE t.assignee_id = a.id AND t.is_active AND ${vis} AND t.status IN ${OPEN}
                AND t.due_date BETWEEN $2::date AND $3::date) AS week,
            greatest((SELECT max(l.created_at) FROM activity_log l WHERE l.user_id = a.id),
                     (SELECT max(v.created_at) FROM activity v WHERE v.actor_id = a.id))::text AS last_seen
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
      heavy: week >= HEAVY_WEEK || open >= HEAVY_OPEN, lastSeen: p.last_seen,
    };
  });

  const signals: ControlSignal[] = [
    ...sig.map((s) => ({ kind: s.kind, taskId: s.id, title: s.title, who: s.who, days: Number(s.days) })),
    ...people.filter((p) => p.heavy).map((p) => ({
      kind: "heavy" as const, taskId: null, title: `진행 ${p.open}건 · 이번 주 마감 ${p.week}건`, who: p.name, days: 0,
    })),
  ];

  return {
    today,
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
