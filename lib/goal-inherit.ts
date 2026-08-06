// 목표 상속 (MD-P-2026-024 §4) — 손으로 세 번 잇지 않게 한다.
//
// 업무의 목표 연결은 두 가지 중 하나다:
//   inherited — 소속 프로젝트의 연결 목표를 그대로 따라간다. 프로젝트가 목표를 바꾸면 같이 움직인다.
//   manual    — 사용자가 직접 고른 값. 프로젝트가 바뀌어도 건드리지 않는다.
//
// 연결 자체는 기존 goal_task(M:N) 를 그대로 쓴다. task.goal_source 는
// "이 업무의 목표 연결이 프로젝트를 따라가는가"를 나타내는 플래그다.
import { query, queryOne } from "./db";

export type GoalSource = "inherited" | "manual";

/** 월 목표만 업무에 연결할 수 있다 (SPEC 2.2). 프로젝트 목표가 월이 아니면 상속하지 않는다. */
const MONTH_GOAL = `is_active = true AND period_type = 'month'`;

/** 이 업무가 상속해야 할 목표 — 소속 프로젝트의 연결 목표. 없으면 null. */
export async function inheritedGoalFor(taskId: number): Promise<number | null> {
  const row = await queryOne<{ goal_id: number | null }>(
    `SELECT p.goal_id
       FROM task t JOIN project p ON p.id = t.project_id
      WHERE t.id = $1 AND p.is_active = true
        AND EXISTS (SELECT 1 FROM goal g WHERE g.id = p.goal_id AND ${MONTH_GOAL})`,
    [taskId]
  );
  return row?.goal_id ?? null;
}

/**
 * 업무 1건의 상속 연결을 다시 맞춘다. goal_source='manual' 이면 아무것도 하지 않는다.
 * 돌려주는 값은 재계산이 필요한 목표 id 들(이전 연결 + 새 연결).
 */
export async function applyInheritance(taskId: number): Promise<number[]> {
  const t = await queryOne<{ goal_source: string }>(
    `SELECT goal_source FROM task WHERE id = $1`, [taskId]
  );
  if (!t || t.goal_source !== "inherited") return [];

  const prior = await query<{ goal_id: number }>(
    `SELECT goal_id FROM goal_task WHERE task_id = $1`, [taskId]
  );
  const target = await inheritedGoalFor(taskId);
  const priorIds = prior.map((r) => r.goal_id);

  // 이미 맞으면 건드리지 않는다 (불필요한 재계산·활동로그 방지)
  if (priorIds.length === (target === null ? 0 : 1) && (target === null || priorIds[0] === target)) {
    return [];
  }

  await query(`DELETE FROM goal_task WHERE task_id = $1`, [taskId]);
  if (target !== null) {
    await query(
      `INSERT INTO goal_task (goal_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [target, taskId]
    );
  }
  const affected = new Set<number>(priorIds);
  if (target !== null) affected.add(target);
  return Array.from(affected);
}

/**
 * 프로젝트의 연결 목표가 바뀌었을 때 — inherited 업무만 따라 움직인다.
 * manual 업무는 손대지 않는다. 재계산이 필요한 목표 id 들을 돌려준다.
 */
export async function applyInheritanceForProject(projectId: number): Promise<number[]> {
  const tasks = await query<{ id: number }>(
    `SELECT id FROM task
      WHERE project_id = $1 AND is_active = true AND goal_source = 'inherited'`,
    [projectId]
  );
  const affected = new Set<number>();
  for (const t of tasks) {
    for (const g of await applyInheritance(t.id)) affected.add(g);
  }
  return Array.from(affected);
}

/** 사용자가 목표를 직접 골랐다 → 이후로는 프로젝트를 따라가지 않는다. */
export async function markGoalManual(taskId: number): Promise<void> {
  await query(`UPDATE task SET goal_source = 'manual' WHERE id = $1`, [taskId]);
}

/** 상속으로 되돌린다 — 프로젝트 목표를 다시 따라가게 한다. */
export async function markGoalInherited(taskId: number): Promise<number[]> {
  await query(`UPDATE task SET goal_source = 'inherited' WHERE id = $1`, [taskId]);
  return applyInheritance(taskId);
}

export interface GoalLinkInfo {
  goalSource: GoalSource;
  /** 소속 프로젝트가 목표에 연결돼 있지 않다 → 상세 화면에 안내 + 연결 링크 */
  projectHasNoGoal: boolean;
  projectId: number | null;
  projectName: string | null;
}

/** 업무 상세 화면이 "이 프로젝트는 목표에 연결되어 있지 않습니다"를 띄울지 판단할 재료. */
export async function goalLinkInfo(taskId: number): Promise<GoalLinkInfo> {
  const row = await queryOne<{
    goal_source: string; project_id: number | null; project_name: string | null; project_goal: number | null;
  }>(
    `SELECT t.goal_source, t.project_id, p.name AS project_name, p.goal_id AS project_goal
       FROM task t LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true
      WHERE t.id = $1`,
    [taskId]
  );
  return {
    goalSource: (row?.goal_source as GoalSource) ?? "inherited",
    // 프로젝트가 아예 없으면(개인 업무) 안내하지 않는다 — 프로젝트를 강요하지 않기 위해서다.
    projectHasNoGoal: !!row?.project_id && row.project_goal === null,
    projectId: row?.project_id ?? null,
    projectName: row?.project_name ?? null,
  };
}
