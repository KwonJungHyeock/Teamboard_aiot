// 목표 집계·롤업 (Phase 4 → 파트 B 확장) — 진척 계산의 유일한 소스 (검수 포인트 1).
// 규칙 (SPEC 2.2 + 파트 B):
//   월    = 연결 Task 완료율 (auto) 또는 수동 값 (manual — Task에 영향받지 않음)
//   분기·연간 = 하위 "가중평균" (연결 업무 수로 가중, 단순평균 아님)
//   진척 산출 불가 시 null (하위 0개·연결 Task 0개 auto) → UI "-"
//   진척은 이벤트 기반으로 goal.progress에 저장(캐시)한다. 조회 시 재계산하지 않고 저장값을 읽는다.
//   재계산 트리거: 업무 done/dropped 전환, 목표-업무 연결 추가·해제 → recomputeGoalChain.
import { query, queryOne } from "./db";
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
  scope: "team" | "personal";
  areaId: number | null;
  areaName: string | null;
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

/** 월 목표 1건의 진척 — auto: 연결 Task 완료율, manual: 저장값. 산출 불가 시 null.
 *  진척률 = done / (연결 Task 수 - dropped 수). 중단은 더 이상 "할 일"이 아니므로 분모 제외.
 *  전부 dropped(분모 0)면 null → "-" (SPEC v1.1 예정) */
export function monthProgress(
  progressMode: "auto" | "manual",
  storedProgress: number,
  linkedTasks: { status: string; progress?: number }[]
): number | null {
  if (progressMode === "manual") return Math.round(storedProgress);
  const counted = linkedTasks.filter((t) => t.status !== "dropped");
  if (counted.length === 0) return null;
  // 진척률 = 연결 Task 진행률의 평균 (수동 progress 반영). 완료는 100으로 간주.
  const sum = counted.reduce(
    (a, t) => a + (typeof t.progress === "number" ? t.progress : t.status === "done" ? 100 : 0),
    0
  );
  return Math.round(sum / counted.length);
}

/** 하위 진척들의 단순 평균 — null(산출 불가) 하위는 제외, 전부 null이면 null (구 산식·호환용) */
export function rollup(childProgress: (number | null)[]): number | null {
  const valid = childProgress.filter((p): p is number => p !== null);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

/** 하위 가중평균 (파트 B) — weight=연결 업무 수. null 하위는 제외, 유효 가중합 0이면 null.
 *  단순평균과 달리, 업무가 많은 하위 목표가 상위 진척에 더 크게 반영된다. */
export function weightedRollup(children: { progress: number | null; weight: number }[]): number | null {
  const valid = children.filter((c) => c.progress !== null && c.weight > 0);
  const totalW = valid.reduce((a, c) => a + c.weight, 0);
  if (totalW === 0) return null;
  const sum = valid.reduce((a, c) => a + (c.progress as number) * c.weight, 0);
  return Math.round(sum / totalW);
}

/** 목표 서브트리에 연결된 업무 수 (가중치). routine·proposed·비활성 제외. */
async function subtreeTaskWeight(goalId: number): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `WITH RECURSIVE sub AS (
       SELECT id FROM goal WHERE id = $1 AND is_active = true
       UNION ALL
       SELECT g.id FROM goal g JOIN sub ON g.parent_id = sub.id WHERE g.is_active = true
     )
     SELECT count(*)::int AS n
     FROM goal_task gt
     JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed' AND t.work_type <> 'routine'
     WHERE gt.goal_id IN (SELECT id FROM sub)`,
    [goalId]
  );
  return row?.n ?? 0;
}

/** 목표 1건의 진척을 재계산해 goal.progress에 저장하고 계산값을 반환.
 *  월=연결 완료율, 분기·연간=하위 가중평균, manual=저장값 유지. */
export async function recomputeGoal(goalId: number): Promise<number | null> {
  const g = await queryOne<{ period_type: GoalPeriodType; progress_mode: "auto" | "manual"; progress: string | null }>(
    `SELECT period_type, progress_mode, progress::text FROM goal WHERE id = $1 AND is_active = true`,
    [goalId]
  );
  if (!g) return null;
  if (g.progress_mode === "manual") {
    return g.progress === null ? null : Math.round(Number(g.progress));
  }

  let value: number | null;
  if (g.period_type === "month") {
    const tasks = await query<{ status: string; progress: number }>(
      `SELECT t.status, t.progress FROM goal_task gt
       JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed' AND t.work_type <> 'routine'
       WHERE gt.goal_id = $1`,
      [goalId]
    );
    value = monthProgress("auto", 0, tasks);
  } else {
    const children = await query<{ id: number; progress: string | null }>(
      `SELECT id, progress::text FROM goal WHERE parent_id = $1 AND is_active = true`,
      [goalId]
    );
    const withWeights = await Promise.all(
      children.map(async (c) => ({
        progress: c.progress === null ? null : Math.round(Number(c.progress)),
        weight: await subtreeTaskWeight(c.id),
      }))
    );
    value = weightedRollup(withWeights);
  }
  await query(`UPDATE goal SET progress = $1, updated_at = now() WHERE id = $2`, [value, goalId]);
  return value;
}

/** 업무/연결 변경 시 호출 — 해당 목표부터 상위(월→분기→연간)까지 연쇄 재계산. */
export async function recomputeGoalChain(goalId: number): Promise<void> {
  let cur: number | null = goalId;
  const seen = new Set<number>();
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    await recomputeGoal(cur);
    const parent: { parent_id: number | null } | null = await queryOne(
      `SELECT parent_id FROM goal WHERE id = $1`,
      [cur]
    );
    cur = parent && parent.parent_id !== null ? parent.parent_id : null;
  }
}

/** 특정 업무에 연결된 모든 목표 체인을 재계산 (업무 상태 변경 훅에서 사용). */
export async function recomputeGoalsForTask(taskId: number): Promise<void> {
  const links = await query<{ goal_id: number }>(`SELECT goal_id FROM goal_task WHERE task_id = $1`, [taskId]);
  for (const l of links) await recomputeGoalChain(l.goal_id);
}

/** 전체 목표 진척 백필 — 최초 1회. 월→분기→연간 순으로 저장값을 채운다. */
export async function recomputeAllGoals(): Promise<void> {
  for (const type of ["month", "quarter", "year"] as GoalPeriodType[]) {
    const rows = await query<{ id: number }>(
      `SELECT id FROM goal WHERE is_active = true AND period_type = $1`,
      [type]
    );
    for (const r of rows) await recomputeGoal(r.id);
  }
}

// 최초 1회 백필 (조회마다 재계산 금지 규칙 준수 — 플래그로 1회만).
let backfillDone = false;
export async function ensureGoalsBackfilled(): Promise<void> {
  if (backfillDone) return;
  const flag = await queryOne<{ value: unknown }>(`SELECT value FROM config WHERE key = 'goals_progress_backfilled_v1'`);
  if (flag) { backfillDone = true; return; }
  await recomputeAllGoals();
  await query(
    `INSERT INTO config (key, value) VALUES ('goals_progress_backfilled_v1', 'true'::jsonb)
     ON CONFLICT (key) DO NOTHING`
  );
  backfillDone = true;
}

/** 팀 목표 기여 현황 — 담당자별 연결 업무 수 / 완료 수 / 기여도(%). 서브트리 전체 기준. */
export async function getGoalContribution(goalId: number): Promise<
  { actorId: number | null; name: string; total: number; done: number; sharePct: number }[]
> {
  const rows = await query<{ actor_id: number | null; name: string | null; total: number; done: number }>(
    `WITH RECURSIVE sub AS (
       SELECT id FROM goal WHERE id = $1 AND is_active = true
       UNION ALL SELECT g.id FROM goal g JOIN sub ON g.parent_id = sub.id WHERE g.is_active = true
     )
     SELECT t.assignee_id AS actor_id, a.display_name AS name,
            count(*)::int AS total,
            count(*) FILTER (WHERE t.status = 'done')::int AS done
     FROM goal_task gt
     JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed' AND t.work_type <> 'routine'
     LEFT JOIN actor a ON a.id = t.assignee_id
     WHERE gt.goal_id IN (SELECT id FROM sub)
     GROUP BY t.assignee_id, a.display_name
     ORDER BY total DESC`,
    [goalId]
  );
  const grandTotal = rows.reduce((a, r) => a + r.total, 0);
  return rows.map((r) => ({
    actorId: r.actor_id,
    name: r.name ?? "미지정",
    total: r.total,
    done: r.done,
    sharePct: grandTotal > 0 ? Math.round((r.total / grandTotal) * 100) : 0,
  }));
}

/** 전체 목표 트리 (연간 > 분기 > 월) — 진척 계산 포함. year 지정 시 해당 연도만 */
export async function getGoalTree(opts: {
  year?: number;
  scope?: "team" | "personal";
  viewerId?: number;
} = {}): Promise<GoalNode[]> {
  await ensureGoalsBackfilled();
  const { year, scope, viewerId } = opts;
  const filters: string[] = ["g.is_active = true"];
  const params: unknown[] = [];
  if (year) { params.push(year); filters.push(`EXTRACT(YEAR FROM g.period_start) = $${params.length}`); }
  if (scope === "team") {
    filters.push(`g.scope = 'team'`);
  } else if (scope === "personal") {
    params.push(viewerId ?? -1);
    filters.push(`g.scope = 'personal' AND g.owner_actor_id = $${params.length}`);
  } else {
    // 미지정 — 팀 목표 전체 + 본인 개인 목표만 (개인 목표는 lead도 못 봄)
    params.push(viewerId ?? -1);
    filters.push(`(g.scope = 'team' OR g.owner_actor_id = $${params.length})`);
  }
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
    progress: string | null;
    owner_actor_id: number | null;
    owner_name: string | null;
    project_id: number | null;
    project_name: string | null;
    color_key: string | null;
    scope: "team" | "personal";
    area_id: number | null;
    area_name: string | null;
  }>(
    `SELECT g.id, g.parent_id, g.period_type, g.period_start::text, g.period_end::text,
            g.title, g.description, g.target_metric, g.target_value::text, g.current_value::text,
            g.progress_mode, g.progress::text, g.owner_actor_id,
            o.display_name AS owner_name, g.project_id, p.name AS project_name,
            COALESCE(p.color_key, ar.color_key) AS color_key,
            g.scope, g.area_id, ar.name AS area_name
     FROM goal g
     LEFT JOIN actor o ON o.id = g.owner_actor_id
     LEFT JOIN project p ON p.id = g.project_id
     LEFT JOIN area ar ON ar.id = g.area_id
     WHERE ${filters.join(" AND ")}
     ORDER BY g.period_start, g.id`,
    params
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
     JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed' AND t.work_type <> 'routine'
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
      // 저장값(이벤트 기반 캐시)을 그대로 읽는다 — 조회 시 재계산하지 않음 (파트 B)
      progress: row.progress === null ? null : Math.round(Number(row.progress)),
      ownerActorId: row.owner_actor_id,
      ownerName: row.owner_name,
      projectId: row.project_id,
      projectName: row.project_name,
      colorKey: row.color_key,
      scope: row.scope,
      areaId: row.area_id,
      areaName: row.area_name,
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

  // 진척은 저장값(recomputeGoalChain이 이벤트 시 갱신)을 그대로 사용 — 여기서 재계산하지 않는다.
  return roots;
}

/** 현재 월 목표 목록 + 진척 — 홈 대시보드용 (lib/home.ts에서 사용) */
export async function getCurrentMonthGoals(todayStr: string): Promise<
  {
    id: number;
    title: string;
    progress: number | null;
    colorKey: string | null;
    projectName: string | null;
    /** 연결 Task 중 중단 건수 — N>0일 때 "중단 N건" 라벨 */
    droppedCount: number;
    /** 진척 산정 방식 — 월간 보고에서 수동 목표 구분용 */
    progressMode: "auto" | "manual";
  }[]
> {
  await ensureGoalsBackfilled();
  // 홈은 팀 월 목표만 표시 (개인 목표 제외, 파트 C). 진척은 저장값을 읽는다(파트 B).
  const rows = await query<{
    id: number;
    title: string;
    progress_mode: "auto" | "manual";
    progress: string | null;
    color_key: string | null;
    project_name: string | null;
  }>(
    `SELECT g.id, g.title, g.progress_mode, g.progress::text,
            COALESCE(p.color_key, ar.color_key) AS color_key, p.name AS project_name
     FROM goal g
     LEFT JOIN project p ON p.id = g.project_id
     LEFT JOIN area ar ON ar.id = g.area_id
     WHERE g.is_active = true AND g.period_type = 'month' AND g.scope = 'team'
       AND g.period_start <= $1::date AND g.period_end >= $1::date
     ORDER BY g.id`,
    [todayStr]
  );
  const links = rows.length
    ? await query<{ goal_id: number; status: string }>(
        `SELECT gt.goal_id, t.status
         FROM goal_task gt JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed' AND t.work_type <> 'routine'
         WHERE gt.goal_id = ANY($1::int[])`,
        [rows.map((r) => r.id)]
      )
    : [];
  return rows.map((row) => {
    const linked = links.filter((l) => l.goal_id === row.id);
    return {
      id: row.id,
      title: row.title,
      progress: row.progress === null ? null : Math.round(Number(row.progress)),
      colorKey: row.color_key,
      projectName: row.project_name,
      droppedCount: linked.filter((l) => l.status === "dropped").length,
      progressMode: row.progress_mode,
    };
  });
}
