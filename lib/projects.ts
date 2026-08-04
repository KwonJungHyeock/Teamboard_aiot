// 프로젝트 워크스페이스 (MD-P-2026-005) — 진척 롤업 · 캔버스 · 목표 연동.
// 진척 = 소속 업무 진척의 "업무 기간 길이" 가중 평균 (§E). 날짜는 공용 taskDays 단일 소스.
import { query, queryOne } from "./db";
import { taskDays, dateDiffDays } from "./task-view";

export const PROJECT_STATUSES = ["active", "hold", "done", "archived"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export const PROJECT_STATUS_LABEL: Record<string, string> = {
  active: "진행", hold: "보류", done: "완료", archived: "보관",
};

/** 업무 1건의 가중치 = 기간 길이(일, 최소 1). 기간 없으면 1. */
function taskWeight(t: { startDate: string | null; dueDate: string | null }): number {
  const d = taskDays(t);
  if (!d) return 1;
  return Math.max(1, dateDiffDays(d.end, d.start) + 1);
}

/** 업무 1건의 진척 — 완료는 100으로 간주. */
function taskProgress(t: { status: string; progress: number }): number {
  return t.status === "done" ? 100 : (t.progress ?? 0);
}

export interface ProjectTaskRow {
  id: number; title: string; status: string; priority: string;
  assigneeId: number | null; assigneeName: string | null;
  startDate: string | null; dueDate: string | null; progress: number;
  colorKey: string | null; areaName: string | null; blocked: boolean;
}

/** 프로젝트 진척 — 업무 기간 가중 평균. 업무 없으면 null("-"). */
export function rollupProgress(tasks: { status: string; progress: number; startDate: string | null; dueDate: string | null }[]): number | null {
  const counted = tasks.filter((t) => t.status !== "dropped" && t.status !== "proposed");
  if (counted.length === 0) return null;
  let wsum = 0, psum = 0;
  for (const t of counted) {
    const w = taskWeight(t);
    wsum += w;
    psum += taskProgress(t) * w;
  }
  return wsum === 0 ? null : Math.round(psum / wsum);
}

/** 프로젝트 소속 업무 (proposed 제외). */
export async function projectTasks(projectId: number): Promise<ProjectTaskRow[]> {
  const rows = await query<{
    id: number; title: string; status: string; priority: string;
    assignee_id: number | null; assignee_name: string | null;
    start_date: string | null; due_date: string | null; progress: number;
    color_key: string | null; area_name: string | null; blocked: boolean;
  }>(
    `SELECT t.id, t.title, t.status, t.priority, t.assignee_id, a.display_name AS assignee_name,
            t.start_date::text, t.due_date::text, t.progress, p.color_key, ar.name AS area_name, t.blocked
     FROM task t
     LEFT JOIN actor a ON a.id = t.assignee_id
     LEFT JOIN project p ON p.id = t.project_id
     LEFT JOIN area ar ON ar.id = t.area_id
     WHERE t.project_id = $1 AND t.is_active = true AND t.status <> 'proposed'
     ORDER BY t.due_date ASC NULLS LAST, t.id DESC`,
    [projectId]
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, priority: r.priority,
    assigneeId: r.assignee_id, assigneeName: r.assignee_name,
    startDate: r.start_date, dueDate: r.due_date, progress: r.progress ?? 0,
    colorKey: r.color_key, areaName: r.area_name, blocked: r.blocked ?? false,
  }));
}

/** 목표에 연결된 프로젝트들의 진척 — §E 목표 자동 집계용. */
export async function projectProgressForGoal(goalId: number): Promise<number | null> {
  const projects = await query<{ id: number }>(
    `SELECT id FROM project WHERE goal_id = $1 AND is_active = true AND status <> 'archived'`,
    [goalId]
  );
  if (projects.length === 0) return null;
  const values: number[] = [];
  for (const p of projects) {
    const tasks = await projectTasks(p.id);
    const v = rollupProgress(tasks);
    if (v !== null) values.push(v);
  }
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** 목표 상세 역방향 링크 — 이 목표에 연결된 프로젝트 목록. */
export async function projectsForGoal(goalId: number): Promise<{ id: number; name: string; colorKey: string | null; status: string; progress: number | null }[]> {
  const rows = await query<{ id: number; name: string; color_key: string | null; status: string }>(
    `SELECT id, name, color_key, status FROM project
     WHERE goal_id = $1 AND is_active = true ORDER BY id`,
    [goalId]
  );
  const out = [];
  for (const r of rows) {
    const tasks = await projectTasks(r.id);
    out.push({ id: r.id, name: r.name, colorKey: r.color_key, status: r.status, progress: rollupProgress(tasks) });
  }
  return out;
}

// ── 캔버스 ──
export interface CanvasBlock {
  id: string;
  type: "text" | "checklist" | "link" | "image";
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
  url?: string;
  meta?: { title?: string; domain?: string; thumbnail?: string; provider?: string };
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
