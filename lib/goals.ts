// 목표 집계·롤업 (Phase 4) — 진척 계산의 유일한 소스 (검수 포인트 1).
// 규칙 (SPEC 2.2):
//   월    = 연결 Task 완료율 (progress_mode='auto') 또는 수동 값 (manual — Task에 영향받지 않음)
//   분기  = 하위 월 목표 평균, 연간 = 하위 분기 평균
//   진척을 산출할 수 없으면 null (하위 0개·연결 Task 0개 auto) → UI는 "-" 표시
//   목표 미연결 Task는 집계 제외 대상일 뿐 오류가 아니다 (D-014)
import { query } from "./db";
import type { GoalPeriodType } from "./types";

export interface GoalNode {
  id: number;
  parentId: number | null;
  periodType: GoalPeriodType;
  periodStart: string;
  periodEnd: string;
  title: string;
  description: string;
  targetMetric: string | null;
  targetValue: number | null;
  currentValue: number | null;
  progressMode: "auto" | "manual";
  /** 계산된 진척 (0~100). 산출 불가 시 null → "-" */
  progress: number | null;
  ownerActorId: number | null;
  ownerName: string | null;
  projectId: number | null;
  projectName: string | null;
  colorKey: string | null;
  /** 월 목표에 연결된 Task (다른 주기에는 빈 배열) */
  tasks: GoalTaskRef[];
  children: GoalNode[];
}

export interface GoalTaskRef {
  id: number;
  title: string;
  status: string;
  assigneeName: string | null;
  dueDate: string | null;
}

/** 월 목표 1건의 진척 — auto: 연결 Task 완료율, manual: 저장값. 산출 불가 시 null */
export function monthProgress(
  progressMode: "auto" | "manual",
  storedProgress: number,
  linkedTasks: { status: string }[]
): number | null {
  if (progressMode === "manual") return Math.round(storedProgress);
  if (linkedTasks.length === 0) return null;
  const done = linkedTasks.filter((t) => t.status === "done").length;
  return Math.round((done / linkedTasks.length) * 100);
}

/** 하위 진척들의 평균 — null(산출 불가) 하위는 제외, 전부 null이면 null */
export function rollup(childProgress: (number | null)[]): number | null {
  const valid = childProgress.filter((p): p is number => p !== null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** 전체 목표 트리 (연간 > 분기 > 월) — 진척 계산 포함. year 지정 시 해당 연도만 */
export async function getGoalTree(year?: number): Promise<GoalNode[]> {
  const yearFilter = year ? `AND EXTRACT(YEAR FROM g.period_start) = ${Number(year)}` : "";
  const rows = await query<{
    id: number;
    parent_id: number | null;
    period_type: GoalPeriodType;
    period_start: string;
    period_end: string;
    title: string;
    description: string;
    target_metric: string | null;
    target_value: string | null;
    current_value: string | null;
    progress_mode: "auto" | "manual";
    progress: string;
    owner_actor_id: number | null;
    owner_name: string | null;
    project_id: number | null;
    project_name: string | null;
    color_key: string | null;
  }>(
    `SELECT g.id, g.parent_id, g.period_type, g.period_start::text, g.period_end::text,
            g.title, g.description, g.target_metric, g.target_value::text, g.current_value::text,
            g.progress_mode, g.progress::text, g.owner_actor_id,
            o.display_name AS owner_name, g.project_id, p.name AS project_name, p.color_key
     FROM goal g
     LEFT JOIN actor o ON o.id = g.owner_actor_id
     LEFT JOIN project p ON p.id = g.project_id
     WHERE g.is_active = true ${yearFilter}
     ORDER BY g.period_start, g.id`
  );

  // 월 목표에 연결된 Task 일괄 로드 (미연결 Task는 자연히 대상 아님 — 오류 아님)
  const links = await query<{
    goal_id: number;
    id: number;
    title: string;
    status: string;
    assignee_name: string | null;
    due_date: string | null;
  }>(
    `SELECT gt.goal_id, t.id, t.title, t.status, a.display_name AS assignee_name, t.due_date::text
     FROM goal_task gt
     JOIN task t ON t.id = gt.task_id AND t.is_active = true
     LEFT JOIN actor a ON a.id = t.assignee_id
     ORDER BY t.due_date ASC NULLS LAST, t.id`
  );
  const tasksByGoal = new Map<number, GoalTaskRef[]>();
  for (const link of links) {
    const list = tasksByGoal.get(link.goal_id) ?? [];
    list.push({
      id: link.id,
      title: link.title,
      status: link.status,
      assigneeName: link.assignee_name,
      dueDate: link.due_date,
    });
    tasksByGoal.set(link.goal_id, list);
  }

  const nodes = new Map<number, GoalNode>();
  for (const row of rows) {
    nodes.set(row.id, {
      id: row.id,
      parentId: row.parent_id,
      periodType: row.period_type,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      title: row.title,
      description: row.description,
      targetMetric: row.target_metric,
      targetValue: row.target_value === null ? null : Number(row.target_value),
      currentValue: row.current_value === null ? null : Number(row.current_value),
      progressMode: row.progress_mode,
      progress: null,
      ownerActorId: row.owner_actor_id,
      ownerName: row.owner_name,
      projectId: row.project_id,
      projectName: row.project_name,
      colorKey: row.color_key,
      tasks: row.period_type === "month" ? (tasksByGoal.get(row.id) ?? []) : [],
      children: [],
    });
  }

  const roots: GoalNode[] = [];
  for (const node of Array.from(nodes.values())) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  // 진척 계산: 월 → 분기 → 연간 (재귀 후위 순회)
  const storedProgress = new Map(rows.map((r) => [r.id, Number(r.progress ?? 0)]));
  function compute(node: GoalNode): number | null {
    if (node.periodType === "month") {
      node.progress = monthProgress(node.progressMode, storedProgress.get(node.id) ?? 0, node.tasks);
      return node.progress;
    }
    const childValues = node.children.map((child) => compute(child));
    // 분기·연간은 항상 하위 평균 — 집계만 한다 (SPEC 2.2)
    node.progress = rollup(childValues);
    return node.progress;
  }
  for (const root of roots) compute(root);
  // 고아 분기/월(상위 없는 경우)도 루트로 취급되어 이미 계산됨

  return roots;
}

/** 현재 월 목표 목록 + 진척 — 홈 대시보드용 (lib/home.ts에서 사용) */
export async function getCurrentMonthGoals(todayStr: string): Promise<
  { id: number; title: string; progress: number | null; colorKey: string | null; projectName: string | null }[]
> {
  const rows = await query<{
    id: number;
    title: string;
    progress_mode: "auto" | "manual";
    progress: string;
    color_key: string | null;
    project_name: string | null;
  }>(
    `SELECT g.id, g.title, g.progress_mode, g.progress::text, p.color_key, p.name AS project_name
     FROM goal g
     LEFT JOIN project p ON p.id = g.project_id
     WHERE g.is_active = true AND g.period_type = 'month'
       AND g.period_start <= $1::date AND g.period_end >= $1::date
     ORDER BY g.id`,
    [todayStr]
  );
  const links = await query<{ goal_id: number; status: string }>(
    `SELECT gt.goal_id, t.status
     FROM goal_task gt JOIN task t ON t.id = gt.task_id AND t.is_active = true
     WHERE gt.goal_id = ANY($1::int[])`,
    [rows.map((r) => r.id)]
  );
  return rows.map((row) => {
    const linked = links.filter((l) => l.goal_id === row.id);
    return {
      id: row.id,
      title: row.title,
      progress:
        row.progress_mode === "manual"
          ? Math.round(Number(row.progress))
          : monthProgress("auto", 0, linked),
      colorKey: row.color_key,
      projectName: row.project_name,
    };
  });
}
