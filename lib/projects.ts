// 프로젝트 워크스페이스 (MD-P-2026-005) — 진척 롤업 · 캔버스 · 목표 연동.
// 진척 계산은 lib/progress.ts 하나로 모았다 (MD-P-2026-024 §3). 여기서 새 공식을 만들지 않는다.
import { query, queryOne } from "./db";
import {
  aggregateTasks, countableSql, goalSubtreeCte, goalLinkedInSql,
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

// MD-P-2026-030 §A3 — 여기 있던 세 함수를 없앴다.
//   projectProgressForGoal() · goalDirectTaskInput() · projectsForGoal()
// 셋 다 "프로젝트가 목표에 붙는다"는 두 번째 연결 경로를 위해서만 존재했다.
// 프로젝트 자신의 진척(projectProgressSql)은 그대로다 — 프로젝트 화면이 쓴다.
// 사라진 것은 **프로젝트를 목표 집계의 재료로 쓰는 경로**뿐이다.
// project.goal_id 컬럼은 지우지 않았다 (§A5). 읽지 않을 뿐이다.

/**
 * 목표 **서브트리**에 속한 집계 대상 업무 — 정의가 말하는 "그 목표에 속한 업무 전체".
 *
 *   "목표 진척은 그 목표(와 하위 목표)에 직접 연결된 업무 전체의 평균이다.
 *    업무만 목표에 붙는다. 프로젝트도 하위 목표도 계산 단위가 아니다."
 *
 * 연결 경로는 goal_task 하나뿐이다 (MD-P-2026-030 §A3).
 * 이 함수의 결과 건수는 `goalCountedSql()` 이 세는 수와 반드시 같아야 한다
 * (화면에 "업무 N건 기준"으로 나가는 그 분모다) — 그래서 둘 다 lib/progress.ts 의
 * 같은 조각(goalSubtreeCte · goalLinkedInSql)을 쓴다.
 */
export async function goalSubtreeTaskInput(goalId: number): Promise<ProgressTask[]> {
  return query<ProgressTask>(
    `${goalSubtreeCte("$1")}
     SELECT t.id, t.status, t.progress, t.resolution,
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}) AS "childCounted",
            (SELECT count(*)::int FROM task c WHERE c.parent_task_id = t.id AND ${countableSql("c")}
                                                AND c.status = 'done'
                                                AND (c.resolution IS NULL OR c.resolution <> 'deferred')) AS "childDone"
       FROM task t
      WHERE t.parent_task_id IS NULL AND ${countableSql("t")}
        AND ${goalLinkedInSql("t", "SELECT id FROM sub")}`,
    [goalId]
  );
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
