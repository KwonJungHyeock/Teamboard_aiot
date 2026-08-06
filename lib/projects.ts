// 프로젝트 워크스페이스 (MD-P-2026-005) — 진척 롤업 · 캔버스 · 목표 연동.
// 진척 계산은 lib/progress.ts 하나로 모았다 (MD-P-2026-024 §3). 여기서 새 공식을 만들지 않는다.
import { query, queryOne } from "./db";
import {
  aggregateTasks, countableSql, projectProgressSql, projectCountedSql,
  type ProgressTask,
} from "./progress";

export const PROJECT_STATUSES = ["active", "hold", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "진행", hold: "보류", done: "완료", archived: "보관",
};

export interface ProjectTaskRow {
  id: number; title: string; status: string; priority: string;
  assigneeId: number | null; assigneeName: string | null;
  startDate: string | null; dueDate: string | null; progress: number;
  colorKey: string | null; areaName: string | null; blocked: boolean;
  resolution: string | null; parentTaskId: number | null;
  childCounted: number; childDone: number;
}

/**
 * 프로젝트 진척 — 최상위 업무만(§3 규칙 3), 집계 대상 0건이면 null("-").
 * 하위 업무는 상위 업무의 진척에 이미 반영돼 있으므로 분모에 다시 넣지 않는다.
 */
export function rollupProgress(tasks: (ProgressTask & { parentTaskId?: number | null })[]): number | null {
  return aggregateTasks(tasks.filter((t) => (t.parentTaskId ?? null) === null));
}

/** 프로젝트 소속 업무 (proposed 제외). 하위 업무 집계값을 함께 실어 온다. */
export async function projectTasks(projectId: number): Promise<ProjectTaskRow[]> {
  const rows = await query<{
    id: number; title: string; status: string; priority: string;
    assignee_id: number | null; assignee_name: string | null;
    start_date: string | null; due_date: string | null; progress: number;
    color_key: string | null; area_name: string | null; blocked: boolean;
    resolution: string | null; parent_task_id: number | null;
    child_counted: string; child_done: string;
  }>(
    `SELECT t.id, t.title, t.status, t.priority, t.assignee_id, a.display_name AS assignee_name,
            t.start_date::text, t.due_date::text, t.progress, p.color_key, ar.name AS area_name, t.blocked,
            t.resolution, t.parent_task_id,
            (SELECT count(*) FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")})::text AS child_counted,
            (SELECT count(*) FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}
                                           AND c.status = 'done'
                                           AND (c.resolution IS NULL OR c.resolution <> 'deferred'))::text AS child_done
     FROM task t
     LEFT JOIN actor a ON a.id = t.assignee_id
     LEFT JOIN project p ON p.id = t.project_id
     LEFT JOIN area ar ON ar.id = t.area_id
     WHERE t.project_id = $1 AND t.is_active = true AND t.status <> 'proposed'
     ORDER BY t.sort_order ASC, t.due_date ASC NULLS LAST, t.id DESC`,
    [projectId]
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, priority: r.priority,
    assigneeId: r.assignee_id, assigneeName: r.assignee_name,
    startDate: r.start_date, dueDate: r.due_date, progress: r.progress ?? 0,
    colorKey: r.color_key, areaName: r.area_name, blocked: r.blocked ?? false,
    resolution: r.resolution, parentTaskId: r.parent_task_id,
    childCounted: Number(r.child_counted), childDone: Number(r.child_done),
  }));
}

/**
 * 목표에 연결된 프로젝트들의 진척 + 각 프로젝트의 집계 대상 업무 수.
 * 목표 집계에서 프로젝트마다 무게를 다르게 주기 위해 건수를 함께 돌려준다(§3 규칙 4).
 * 예전에는 프로젝트마다 projectTasks() 를 다시 부르는 N+1 이었다 — 쿼리 1개로 줄였다.
 */
export async function projectProgressForGoal(
  goalId: number
): Promise<{ progress: number | null; countedTasks: number }[]> {
  const rows = await query<{ progress: string | null; counted: string }>(
    `SELECT ${projectProgressSql("p.id")}::text AS progress,
            ${projectCountedSql("p.id")}::text  AS counted
       FROM project p
      WHERE p.goal_id = $1 AND p.is_active = true AND p.status <> 'archived'`,
    [goalId]
  );
  return rows.map((r) => ({
    progress: r.progress === null ? null : Math.round(Number(r.progress)),
    countedTasks: Number(r.counted),
  }));
}

/**
 * 목표에 직접 연결된 업무 — 개인 목표처럼 프로젝트 없이 붙는 경우(§3 규칙 4).
 *
 * **이미 프로젝트를 통해 세어진 업무는 뺀다(§3 규칙 3 — 이중 계산 금지).**
 * 업무가 목표에 직접 연결돼 있으면서 그 업무의 프로젝트도 같은 목표에 연결돼 있으면,
 * 프로젝트 진척에 이미 반영된 것이다. 여기서 또 세면 그 프로젝트만 두 번 반영된다.
 */
export async function goalDirectTaskInput(goalId: number): Promise<ProgressTask[]> {
  return query<ProgressTask>(
    `SELECT t.status, t.progress, t.resolution,
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}) AS "childCounted",
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}
                                                AND c.status = 'done'
                                                AND (c.resolution IS NULL OR c.resolution <> 'deferred')) AS "childDone"
       FROM goal_task gt
       JOIN task t ON t.id = gt.task_id
       LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true AND p.status <> 'archived'
      WHERE gt.goal_id = $1 AND t.parent_task_id IS NULL AND ${countableSql("t")}
        AND (p.id IS NULL OR p.goal_id IS DISTINCT FROM $1)`,
    [goalId]
  );
}

/**
 * 목표 **서브트리**에 속한 집계 대상 업무 — 확정 정의가 말하는 "그 목표에 속한 업무 전체".
 *
 *   "목표 진척은 그 목표에 속한 업무 전체의 평균이다.
 *    프로젝트는 그룹핑 단위이며 계산 단위가 아니다.
 *    프로젝트를 통해 이미 세어진 업무는 직접 연결에서 제외한다."
 *
 * 프로젝트도 하위 목표도 계산 단위가 아니다 — 업무만 센다.
 * 같은 업무가 프로젝트로도 직접 연결로도 걸리면 `DISTINCT` 로 한 번만 센다.
 * 이 함수의 결과 건수는 `goalCountedSql()` 이 세는 수와 반드시 같아야 한다
 * (화면에 "업무 N건 기준"으로 나가는 그 분모다).
 */
export async function goalSubtreeTaskInput(goalId: number): Promise<ProgressTask[]> {
  return query<ProgressTask>(
    `WITH RECURSIVE sub AS (
       SELECT id FROM goal WHERE id = $1 AND is_active = true
       UNION ALL
       SELECT g.id FROM goal g JOIN sub ON g.parent_id = sub.id WHERE g.is_active = true
     )
     SELECT DISTINCT t.id, t.status, t.progress, t.resolution,
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}) AS "childCounted",
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}
                                                AND c.status = 'done'
                                                AND (c.resolution IS NULL OR c.resolution <> 'deferred')) AS "childDone"
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true AND p.status <> 'archived'
      WHERE t.parent_task_id IS NULL AND ${countableSql("t")}
        AND ( p.goal_id IN (SELECT id FROM sub)
           OR EXISTS (SELECT 1 FROM goal_task gt
                       WHERE gt.task_id = t.id AND gt.goal_id IN (SELECT id FROM sub)) )`,
    [goalId]
  );
}

/** 목표 상세 역방향 링크 — 이 목표에 연결된 프로젝트 목록. 쿼리 1개. */
export async function projectsForGoal(goalId: number): Promise<{ id: number; name: string; colorKey: string | null; status: string; progress: number | null }[]> {
  const rows = await query<{ id: number; name: string; color_key: string | null; status: string; progress: string | null }>(
    `SELECT p.id, p.name, p.color_key, p.status, ${projectProgressSql("p.id")}::text AS progress
       FROM project p
      WHERE p.goal_id = $1 AND p.is_active = true ORDER BY p.id`,
    [goalId]
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, colorKey: r.color_key, status: r.status,
    progress: r.progress === null ? null : Math.round(Number(r.progress)),
  }));
}

// ── 캔버스 ──
export interface CanvasBlock {
  id: string;
  type: "text" | "checklist" | "link" | "image";
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
  url?: string;
  meta?: { title?: string; domain?: string; thumbnail?: string; provider?: string };
  /** 이미지 블록 (MD-P-2026-014a) — 공개 URL이 아니라 Private Blob 의 pathname 을 저장한다 */
  pathname?: string;
  name?: string;
  size?: number;
  contentType?: string;
}

export interface CanvasDoc {
  blocks: CanvasBlock[];
  updatedAt: string | null;
  updatedByName: string | null;
}

export async function getCanvas(projectId: number): Promise<CanvasDoc> {
  const row = await queryOne<{ blocks: CanvasBlock[]; updated_at: string; updated_by_name: string | null }>(
    `SELECT c.blocks, c.updated_at::text, a.display_name AS updated_by_name
     FROM project_canvas c LEFT JOIN actor a ON a.id = c.updated_by
     WHERE c.project_id = $1`,
    [projectId]
  );
  if (!row) return { blocks: [], updatedAt: null, updatedByName: null };
  return {
    blocks: Array.isArray(row.blocks) ? row.blocks : [],
    updatedAt: row.updated_at,
    updatedByName: row.updated_by_name,
  };
}

export async function saveCanvas(projectId: number, blocks: CanvasBlock[], userId: number): Promise<CanvasDoc> {
  await query(
    `INSERT INTO project_canvas (project_id, blocks, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (project_id) DO UPDATE SET blocks = $2::jsonb, updated_by = $3, updated_at = now()`,
    [projectId, JSON.stringify(blocks), userId]
  );
  return getCanvas(projectId);
}
