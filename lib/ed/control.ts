// 업무 현황(디자인 v1.0 · DESIGN.md 5.2) — 팀원 · 목표 미니바 · 팀원별 최근 활동.
// 업무 숫자는 화면이 `/api/tasks` 로 센다(같은 거르개). 여기서는 업무 밖의 것만 모은다.
//
// 마지막 활동 시각은 팀 활동(`activity_log` · `activity`)에서만 온다 — lib/control.ts 와 같은 기준.
// 최근 활동 줄은 남의 비공개 업무에 달린 것을 뺀다(줄에 업무 제목이 들어 있다).
// **서버 전용.**
import { query } from "../db";
import { visibleTaskSql } from "../visibility";
import { kstToday } from "../home";
import { elapsedRatio } from "../progress";

export interface MonPerson { id: number; name: string; lastSeen: string | null; feed: { message: string; at: string }[] }
export interface MonGoal { id: number; level: "year" | "quarter" | "month"; title: string; progress: number; expect: number }
export interface MonData { today: string; people: MonPerson[]; goals: MonGoal[] }

export async function getMonitor(viewerId: number): Promise<MonData> {
  const today = kstToday();
  const people = await query<{ id: number; name: string; last_seen: string | null }>(
    `SELECT a.id, a.display_name AS name,
            greatest((SELECT max(l.created_at) FROM activity_log l WHERE l.user_id = a.id),
                     (SELECT max(v.created_at) FROM activity v WHERE v.actor_id = a.id))::text AS last_seen
       FROM actor a LEFT JOIN account ac ON ac.actor_id = a.id
      WHERE a.type = 'human' AND a.is_active AND coalesce(ac.role, 'member') <> 'viewer'
      ORDER BY (ac.role IN ('admin','lead')) DESC NULLS LAST, a.id`);
  const feed = await query<{ user_id: number; message: string; at: string }>(
    `SELECT x.user_id, x.message, x.at FROM (
       SELECT l.user_id, l.message, l.created_at::text AS at,
              row_number() OVER (PARTITION BY l.user_id ORDER BY l.created_at DESC) AS n
         FROM activity_log l LEFT JOIN task t ON t.id = l.task_id
        WHERE l.user_id IS NOT NULL AND coalesce(l.level, 'info') NOT IN ('warn','error')
          AND (t.id IS NULL OR ${visibleTaskSql("$1")})) x
      WHERE x.n <= 6 ORDER BY x.at DESC`, [viewerId]);
  const goals = await query<{ id: number; title: string; period_type: "year" | "quarter" | "month"; period_start: string; period_end: string; progress: number | null }>(
    `SELECT DISTINCT ON (g.period_type) g.id, g.title, g.period_type, g.period_start::text, g.period_end::text, g.progress
       FROM goal g
      WHERE g.is_active AND g.scope = 'team' AND g.period_start <= $1::date AND g.period_end >= $1::date
      ORDER BY g.period_type, g.parent_id NULLS FIRST, g.id`, [today]);
  const order = { year: 0, quarter: 1, month: 2 } as const;
  return {
    today,
    people: people.map((p) => ({
      id: p.id, name: p.name, lastSeen: p.last_seen,
      feed: feed.filter((f) => f.user_id === p.id).map((f) => ({ message: f.message, at: f.at })),
    })),
    goals: goals.sort((a, b) => order[a.period_type] - order[b.period_type]).map((g) => ({
      id: g.id, level: g.period_type, title: g.title, progress: Math.round(g.progress ?? 0),
      expect: Math.round(elapsedRatio(g.period_start, g.period_end, today) * 100),
    })),
  };
}
