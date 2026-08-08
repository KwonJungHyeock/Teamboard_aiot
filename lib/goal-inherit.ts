// 업무의 목표 연결 출처 (task.goal_source).
//
// ⚠️ 이 파일의 이름은 낡았다. **목표 상속은 MD-P-2026-030 §A4 에서 없앴다.**
//    파일 이름 정리는 goal_source 값 이름 정리(BACKLOG B-11)와 같이 한다 —
//    지금 옮기면 import 만 흔들리고 얻는 게 없다.
//
// ── 지금의 연결 모델 (MD-P-2026-030 §A) ────────────────────────────
//
//   목표에 붙는 것은 **업무뿐**이고, 붙는 방법은 goal_task 하나뿐이다.
//   프로젝트를 통해 따라 붙는 경로는 사라졌다.
//
// 그래서 goal_source 가 구분하는 것은 이제 두 가지뿐이다:
//
//   none      — 사용자가 "목표 없음"을 **명시적으로** 골랐다.
//               성과 집계 대상이 아니지만 수행한 업무로는 남는다(월간 보고).
//               미연결 배너에 오르지 않는다 — 이미 사람이 정한 상태다.
//   그 외      — 그냥 "붙일 수 있는 업무". 링크가 없으면 미지정이고, 미연결 배너에 오른다.
//
// 그 외에 해당하는 값이 지금 둘이다:
//   manual    — 새로 만들어지는 값. 사용자가 목표를 고를 수 있는 보통 상태다.
//   inherited — **역사적 값이다.** 상속이 있던 시절 "프로젝트를 따라간다"는 뜻이었고,
//               지금은 '미지정'을 뜻한다. 새로 만들어지지 않는다.
//               CHECK 는 좁히지 않았다 — 기존 19건의 값을 그대로 보존하기 위해서다.
//               이름 정리(inherited → unset)는 BACKLOG B-11.
import { query, queryOne } from "./db";

export type GoalSource = "inherited" | "manual" | "none";

/**
 * 새로 만드는 업무의 goal_source.
 *
 * DB 기본값은 아직 'inherited' 다(컬럼은 §A5 에 따라 건드리지 않았다).
 * 그래서 **INSERT 마다 이 값을 명시**해야 새 업무가 역사적 값을 물려받지 않는다.
 * 이 상수를 쓰지 않고 INSERT 하는 경로가 생기면 inherited 가 다시 늘어난다.
 */
export const NEW_TASK_GOAL_SOURCE = "manual" as const;

/** 사용자가 목표를 직접 골랐다. */
export async function markGoalManual(taskId: number): Promise<void> {
  await query(`UPDATE task SET goal_source = 'manual' WHERE id = $1`, [taskId]);
}

/**
 * "목표 없음" — 성과 집계 대상이 아니라고 사용자가 정한 것 (지시 23-1).
 * 미지정(아직 안 정함)과 구분된다. 기존 목표 연결이 있으면 끊는다.
 * 되돌리려면 clearGoalNone() 을 쓴다.
 */
export async function markGoalNone(taskId: number): Promise<number[]> {
  const prior = await query<{ goal_id: number }>(
    `SELECT goal_id FROM goal_task WHERE task_id = $1`, [taskId]
  );
  await query(`DELETE FROM goal_task WHERE task_id = $1`, [taskId]);
  await query(`UPDATE task SET goal_source = 'none' WHERE id = $1`, [taskId]);
  return prior.map((r) => r.goal_id);
}

/**
 * "목표 없음"을 푼다 — 다시 미지정 상태로 돌린다.
 *
 * 예전 이름은 markGoalInherited() 였고 "프로젝트 상속으로 되돌린다"는 뜻이었다.
 * 상속이 사라졌으니 되돌아갈 곳도 없다. 링크는 만들지 않는다 —
 * 이 업무는 이제 미연결 배너에 다시 올라오고, 사람이 목표를 고르면 된다.
 */
export async function clearGoalNone(taskId: number): Promise<void> {
  await query(`UPDATE task SET goal_source = 'manual' WHERE id = $1 AND goal_source = 'none'`, [taskId]);
}

export interface GoalLinkInfo {
  goalSource: GoalSource;
  projectId: number | null;
  projectName: string | null;
}

/** 업무 상세 화면이 목표 항목을 그릴 때 쓰는 재료. */
export async function goalLinkInfo(taskId: number): Promise<GoalLinkInfo> {
  const row = await queryOne<{
    goal_source: string; project_id: number | null; project_name: string | null;
  }>(
    `SELECT t.goal_source, t.project_id, p.name AS project_name
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true
      WHERE t.id = $1`,
    [taskId]
  );
  return {
    // 값이 없을 때의 기본은 '미지정' 쪽이다 — 'none'(사람이 정함)으로 접으면 안 된다.
    goalSource: (row?.goal_source as GoalSource) ?? "manual",
    projectId: row?.project_id ?? null,
    projectName: row?.project_name ?? null,
  };
}
