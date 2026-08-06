// 목표 트리 조회·저장. **진척 계산 자체는 lib/progress.ts 하나뿐이다** (MD-P-2026-024 §3).
//
// 진척 정의(회신 ④ 확정):
//   "목표 진척은 그 목표에 속한 업무 전체의 평균이다.
//    프로젝트는 그룹핑 단위이며 계산 단위가 아니다.
//    프로젝트를 통해 이미 세어진 업무는 직접 연결에서 제외한다."
//   월·분기·연간을 나누지 않는다 — 어느 층이든 자기 서브트리의 업무를 모아 평균한다.
//   집계 대상 0건이면 null (0% 아님) → 화면은 "집계 없음".
//
// 진척은 이벤트 기반으로 goal.progress 에 저장(캐시)한다. 조회 시 재계산하지 않고 저장값을 읽는다.
// 재계산 트리거: 업무 상태·진척 변경, 삭제·복구, 목표-업무/목표-프로젝트 연결 변경 → recomputeGoalChain.
import { query, queryOne } from "./db";
import type { GoalPeriodType } from "./types";
import { goalSubtreeTaskInput } from "./projects";
import {
  aggregateTasks, rollupGoals, judgeGoalStatus, isCountable, goalCountedSql, goalClosingSql,
  type GoalStatus, type GoalClosing,
} from "./progress";

/** KST 기준 오늘(YYYY-MM-DD). lib/home.ts와 같은 규칙이지만
 *  home.ts가 이 파일을 import하므로 순환을 피해 여기에 둔다. */
export function kstTodayForGoals(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
const kstToday = kstTodayForGoals;

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
  /** 실효 진척 (0~100). 산출 불가 시 null → "-" (0%가 아니다) */
  progress: number | null;
  /** 집계 결과 — 수동값과 구분해 보여줄 때 쓴다 */
  progressAuto: number | null;
  /** 수동 입력값. null이 아니면 UI에 "수동" 배지 */
  progressManual: number | null;
  /** 자동 판정 상태(수동 지정 우선). 판정 불가 시 null */
  status: GoalStatus | null;
  /** 상태가 수동 지정인지 */
  statusManual: boolean;
  /** 연결된 프로젝트 수 — 0이면 "프로젝트를 연결하세요" CTA */
  projectCount: number;
  /** 이 목표에 속한 집계 대상 업무 수 — 화면의 "업무 N건 기준" 분모 (MD-P-2026-024 지시 1) */
  countedTasks: number;
  /** 기간이 끝난 목표의 마감 기록 (회신 3 지시 7). 진행 중이면 ended=false */
  closing: GoalClosing;
  /** 집계 대상이 0건인 하위 목표 수 — "미집계 하위 3개" 표기용 (지시 16) */
  uncountedChildren: number;
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
  /** 집계 제외 판정용 — lib/progress.ts isCountable() 이 읽는다 */
  resolution: string | null;
  assigneeName: string | null;
  dueDate: string | null;
}

/** @deprecated 진척 계산은 lib/progress.ts 하나로 모았다 (MD-P-2026-024 §3).
 *  호환용 얇은 어댑터 — 새 코드에서는 aggregateTasks() 를 직접 쓴다. */
export function monthProgress(
  progressMode: "auto" | "manual",
  storedProgress: number,
  linkedTasks: { status: string; progress?: number; resolution?: string | null; workType?: string | null }[]
): number | null {
  if (progressMode === "manual") return Math.round(storedProgress);
  return aggregateTasks(linkedTasks.map((t) => ({ ...t, progress: t.progress ?? 0 })));
}

/** @deprecated lib/progress.ts 의 rollupGoals() 를 쓴다. */
export const rollup = rollupGoals;

/** 상위 체인 최대 깊이 (월 → 분기 → 연간). */
export const MAX_GOAL_DEPTH = 3;

/**
 * 목표 자체의 집계값 — 확정 정의 한 줄이 전부다 (MD-P-2026-024 회신 ④).
 *
 *   "목표 진척은 그 목표에 속한 업무 전체의 평균이다.
 *    프로젝트는 그룹핑 단위이며 계산 단위가 아니다.
 *    프로젝트를 통해 이미 세어진 업무는 직접 연결에서 제외한다."
 *
 * 월·분기·연간을 나누지 않는다. 어느 층이든 자기 서브트리의 업무를 모아 평균한다.
 * 하위 목표도 프로젝트와 마찬가지로 그룹핑 단위이지 계산 단위가 아니다 —
 * 하위 목표 %의 평균을 쓰면 업무 12건짜리와 1건짜리가 같은 무게가 되고,
 * 화면에 띄우는 "업무 N건 기준" 분모와도 어긋난다.
 */
async function computeAuto(goalId: number): Promise<number | null> {
  return aggregateTasks(await goalSubtreeTaskInput(goalId));
}

// 상태 판정은 lib/progress.ts 로 옮겼다 (MD-P-2026-024 §3 — 계산기는 하나).
// 기존 import 경로를 깨지 않도록 여기서 그대로 다시 내보낸다.
export {
  judgeGoalStatus, elapsedRatio, effectiveGoalStatus, GOAL_STATUS_LABEL,
} from "./progress";
export type { GoalStatus } from "./progress";

/**
 * 목표 1건의 진척을 재계산해 저장한다.
 * progress_auto = 집계 결과 / progress = 실효값(수동 우선). 반환값은 실효값.
 */
export async function recomputeGoal(goalId: number): Promise<number | null> {
  const g = await queryOne<{ progress_manual: string | null }>(
    `SELECT progress_manual::text FROM goal WHERE id = $1 AND is_active = true`,
    [goalId]
  );
  if (!g) return null;

  const auto = await computeAuto(goalId);
  const manual = g.progress_manual === null ? null : Math.round(Number(g.progress_manual));
  const effective = manual !== null ? manual : auto;

  await query(
    `UPDATE goal SET progress_auto = $1, progress = $2, updated_at = now() WHERE id = $3`,
    [auto, effective, goalId]
  );
  return effective;
}

/** 업무/연결 변경 시 호출 — 해당 목표부터 상위(월→분기→연간)까지 연쇄 재계산.
 *  깊이 3 제한 + 방문 집합으로 순환 참조를 차단한다 (§C5). */
export async function recomputeGoalChain(goalId: number): Promise<void> {
  let cur: number | null = goalId;
  const seen = new Set<number>();
  let depth = 0;
  while (cur !== null && !seen.has(cur) && depth < MAX_GOAL_DEPTH) {
    seen.add(cur);
    depth += 1;
    await recomputeGoal(cur);
    const parent: { parent_id: number | null } | null = await queryOne(
      `SELECT parent_id FROM goal WHERE id = $1`,
      [cur]
    );
    cur = parent && parent.parent_id !== null ? parent.parent_id : null;
  }
}

/** 프로젝트-목표 연결이 바뀌었을 때 — 새 목표와 이전 목표를 모두 재계산한다. */
export async function recomputeGoalsForProject(projectId: number, alsoGoalIds: (number | null)[] = []): Promise<void> {
  const linked = await query<{ goal_id: number | null }>(
    `SELECT goal_id FROM project WHERE id = $1`, [projectId]
  );
  const ids = new Set<number>();
  for (const r of linked) if (r.goal_id) ids.add(r.goal_id);
  for (const g of alsoGoalIds) if (g) ids.add(g);
  for (const id of Array.from(ids)) await recomputeGoalChain(id);
}

/** 특정 업무에 연결된 모든 목표 체인을 재계산 (업무 상태 변경 훅에서 사용). */
export async function recomputeGoalsForTask(taskId: number): Promise<void> {
  const links = await query<{ goal_id: number }>(`SELECT goal_id FROM goal_task WHERE task_id = $1`, [taskId]);
  const goalIds = new Set<number>(links.map((l) => l.goal_id));
  // MD-P-2026-005 §E — 업무는 소속 프로젝트를 통해서도 목표에 기여한다.
  // (업무 진척 → 프로젝트 롤업 → 연결 목표) 경로도 함께 재계산.
  const viaProject = await query<{ goal_id: number }>(
    `SELECT p.goal_id FROM task t JOIN project p ON p.id = t.project_id
     WHERE t.id = $1 AND p.goal_id IS NOT NULL`,
    [taskId]
  );
  for (const r of viaProject) goalIds.add(r.goal_id);
  for (const gid of Array.from(goalIds)) await recomputeGoalChain(gid);
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
  /** 팀장은 개인 목표도 조회할 수 있다 (§E) */
  isLead?: boolean;
} = {}): Promise<GoalNode[]> {
  await ensureGoalsBackfilled();
  const today = kstToday();
  const { year, scope, viewerId } = opts;
  const filters: string[] = ["g.is_active = true"];
  // today 를 첫 파라미터로 고정한다 — 기간 종료 판정($1)이 뒤의 동적 필터에 밀리지 않게.
  const params: unknown[] = [today];
  const pToday = params.length; // = 1
  if (year) { params.push(year); filters.push(`EXTRACT(YEAR FROM g.period_start) = $${params.length}`); }
  if (scope === "team") {
    filters.push(`g.scope = 'team'`);
  } else if (scope === "personal") {
    // 개인 목표는 본인과 팀장만 조회 (§E)
    if (opts.isLead) {
      filters.push(`g.scope = 'personal'`);
    } else {
      params.push(viewerId ?? -1);
      filters.push(`g.scope = 'personal' AND g.owner_actor_id = $${params.length}`);
    }
  } else if (!opts.isLead) {
    // 팀 목표 전체 + 본인 개인 목표
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
    progress_auto: string | null;
    progress_manual: string | null;
    status_manual: GoalStatus | null;
    project_count: number;
    counted_tasks: number;
    uncounted_children: number;
    period_ended: boolean;
    closing: { progress: string | number | null; date: string | null } | null;
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
            g.progress_mode, g.progress::text, g.progress_auto::text, g.progress_manual::text,
            g.status_manual,
            (SELECT count(*)::int FROM project pj
              WHERE pj.goal_id = g.id AND pj.is_active = true AND pj.status <> 'archived') AS project_count,
            ${goalCountedSql("g.id")}::int AS counted_tasks,
            (SELECT count(*) FROM goal c
              WHERE c.parent_id = g.id AND c.is_active = true
                AND ${goalCountedSql("c.id")} = 0)::int AS uncounted_children,
            (g.period_end < $${pToday}::date) AS period_ended,
            ${goalClosingSql("g.id", "g.period_end")} AS closing,
            g.owner_actor_id,
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
    resolution: string | null;
  }>(
    `SELECT gt.goal_id, t.id, t.title, t.status, t.resolution, a.display_name AS assignee_name, t.due_date::text
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
      resolution: link.resolution,
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
      progressAuto: row.progress_auto === null ? null : Math.round(Number(row.progress_auto)),
      progressManual: row.progress_manual === null ? null : Math.round(Number(row.progress_manual)),
      status: row.status_manual
        // 표본 부족(1~2건)이면 판정하지 않는다 — "온트랙"이라 말할 근거가 없다 (지시 16)
        ?? judgeGoalStatus(
          row.progress === null ? null : Math.round(Number(row.progress)),
          row.period_start, row.period_end, today, Number(row.counted_tasks ?? 0)
        ),
      statusManual: row.status_manual !== null,
      projectCount: row.project_count,
      ownerActorId: row.owner_actor_id,
      ownerName: row.owner_name,
      projectId: row.project_id,
      projectName: row.project_name,
      colorKey: row.color_key,
      scope: row.scope,
      areaId: row.area_id,
      areaName: row.area_name,
      countedTasks: Number(row.counted_tasks ?? 0),
      uncountedChildren: Number(row.uncounted_children ?? 0),
      closing: {
        ended: !!row.period_ended,
        progress: row.closing?.progress == null ? null : Math.round(Number(row.closing.progress)),
        date: row.closing?.date ?? null,
      },
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
      droppedCount: linked.filter((l) => !isCountable(l)).length,
      progressMode: row.progress_mode,
    };
  });
}
