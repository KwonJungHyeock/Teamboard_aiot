// 목표 집계·롤업 (Phase 4 → 파트 B 확장) — 진척 계산의 유일한 소스 (검수 포인트 1).
// 규칙 (SPEC 2.2 + 파트 B):
//   월    = 연결 Task 완료율 (auto) 또는 수동 값 (manual — Task에 영향받지 않음)
//   분기·연간 = 하위 "가중평균" (연결 업무 수로 가중, 단순평균 아님)
//   진척 산출 불가 시 null (하위 0개·연결 Task 0개 auto) → UI "-"
//   진척은 이벤트 기반으로 goal.progress에 저장(캐시)한다. 조회 시 재계산하지 않고 저장값을 읽는다.
//   재계산 트리거: 업무 done/dropped 전환, 목표-업무 연결 추가·해제 → recomputeGoalChain.
import { query, queryOne } from "./db";
import type { GoalPeriodType } from "./types";
import { projectProgressForGoal } from "./projects";

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
  // 진척률 = 연결 Task 진행률의 평균 (수동 progress 반영). 완료는 저장값과 무관하게 100으로 간주.
  const sum = counted.reduce(
    (a, t) => a + (t.status === "done" ? 100 : typeof t.progress === "number" ? t.progress : 0),
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

// ─────────────────────────────────────────────────────────────
// 진척 집계 (MD-P-2026-009 §C) — 규칙을 코드 한 곳에 명문화한다.
//   1. 업무 진척 = 사용자 입력값(0~100). 완료는 100으로 간주.
//   2. 프로젝트 진척 = 소속 업무의 기간 길이 가중 평균. 업무 0건이면 null(0%가 아니다).
//   3. 목표 진척 = progress_manual이 있으면 그 값(수동 배지),
//                  없으면 연결 프로젝트 진척의 평균(null 프로젝트는 분모에서 제외).
//                  집계할 대상이 없으면 null → 화면은 "-" + [프로젝트 연결] CTA.
//   4. 상위 롤업 = 하위 목표가 있으면 하위 평균, 없으면 자기 프로젝트 집계.
//   5. parent 체인 깊이 3 제한(월→분기→연간) — 순환·과도한 재귀 차단.
// ─────────────────────────────────────────────────────────────

/** 상위 체인 최대 깊이 (월 → 분기 → 연간). */
export const MAX_GOAL_DEPTH = 3;

/** 목표 자체의 집계값 — 하위 목표 우선, 없으면 연결 프로젝트, 그것도 없으면 연결 업무. */
async function computeAuto(goalId: number): Promise<number | null> {
  // 4) 하위 목표가 있으면 하위 평균 (실효 진척 = 수동 우선)
  const children = await query<{ progress: string | null }>(
    `SELECT COALESCE(progress_manual, progress_auto)::text AS progress
       FROM goal WHERE parent_id = $1 AND is_active = true`,
    [goalId]
  );
  if (children.length > 0) {
    return rollup(children.map((c) => (c.progress === null ? null : Math.round(Number(c.progress)))));
  }

  // 3) 연결 프로젝트 진척의 평균 (null 프로젝트는 분모에서 제외)
  const fromProjects = await projectProgressForGoal(goalId);
  if (fromProjects !== null) return fromProjects;

  // 프로젝트가 하나도 없을 때에 한해, 목표에 직접 연결된 업무로 집계한다.
  // (프로젝트 연결 이전에 만들어진 월 목표가 갑자기 "-"로 떨어지지 않게 하는 하위호환 경로)
  const tasks = await query<{ status: string; progress: number }>(
    `SELECT t.status, t.progress FROM goal_task gt
       JOIN task t ON t.id = gt.task_id AND t.is_active = true
        AND t.status <> 'proposed' AND t.work_type <> 'routine'
      WHERE gt.goal_id = $1`,
    [goalId]
  );
  return monthProgress("auto", 0, tasks);
}

// ─────────────────────────────────────────────────────────────
// 상태 자동 판정 (MD-P-2026-009 §D)
// 수동 지정(status_manual)이 있으면 그 값이 우선. 없으면 아래 규칙으로 매번 판정한다.
// 진척이 null(집계 대상 없음)이면 "판정 불가"로 두고 null을 돌려준다 —
// 0%로 가정해 리스크로 몰면 정직 원칙에 어긋난다.
// ─────────────────────────────────────────────────────────────
export type GoalStatus = "ontrack" | "risk" | "wait" | "done";
export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  ontrack: "온트랙", risk: "리스크", wait: "대기", done: "완료",
};

/** 기간 경과율 0~1. 시작 전이면 0, 종료 후면 1. */
export function elapsedRatio(periodStart: string, periodEnd: string, today: string): number {
  const s = Date.parse(`${periodStart}T00:00:00Z`);
  const e = Date.parse(`${periodEnd}T00:00:00Z`) + 86400000; // 종료일 포함
  const t = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return 0;
  return Math.max(0, Math.min(1, (t - s) / (e - s)));
}

/** 자동 판정. 판정할 수 없으면 null. */
export function judgeGoalStatus(
  progress: number | null,
  periodStart: string,
  periodEnd: string,
  today: string
): GoalStatus | null {
  if (progress !== null && progress >= 100) return "done";
  if (today < periodStart) return "wait";           // 아직 시작 전
  if (progress === null) return null;               // 집계 대상 없음 → 판정 불가
  if (progress === 0) return "risk";                // 시작일이 지났는데 0%
  const elapsed = elapsedRatio(periodStart, periodEnd, today) * 100;
  return progress - elapsed <= -15 ? "risk" : "ontrack";
}

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
  const params: unknown[] = [];
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
      progressAuto: row.progress_auto === null ? null : Math.round(Number(row.progress_auto)),
      progressManual: row.progress_manual === null ? null : Math.round(Number(row.progress_manual)),
      status: row.status_manual
        ?? judgeGoalStatus(
          row.progress === null ? null : Math.round(Number(row.progress)),
          row.period_start, row.period_end, today
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
