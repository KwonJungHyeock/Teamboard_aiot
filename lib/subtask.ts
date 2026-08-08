// 하위 업무 규칙 (MD-P-2026-028 §A2 · §A4).
//
// 규칙을 이 파일 하나에 둔다. 생성 경로와 수정 경로가 각자 검사하면 반드시 갈라진다 —
// 030 에서 "연결 경로가 둘이면 같은 질문에 답이 둘 나온다"를 겪었다. 같은 병이다.
//
// ── 규칙 (§A2) ──────────────────────────────────────────────────────
//   ① 하위 업무는 프로젝트·영역·공개 범위를 **상위에서 물려받는다.** 따로 고르지 않는다.
//   ② 하위 업무는 목표에 직접 연결할 수 없다. 상위를 통해서만 집계된다 (§A2 · 28-b).
//   ③ 깊이는 2단 고정. DB 트리거(trg_task_depth_guard)가 최종 방어선이지만,
//      여기서 먼저 잡아 **사유를 사람 말로** 돌려준다 — 500 이 아니라 400 이어야 한다.
//
// 진척 합산은 여기서 하지 않는다 (28-a). lib/progress.ts 의 taskProgress() 가
// 이미 하위 완료율을 셈에 넣고 있다 — 새 계산 경로를 만들면 "계산기는 하나"가 깨진다.
import { query, queryOne } from "./db";

/** 하위 업무가 상위에서 물려받는 값. 사용자가 고르는 값이 아니다. */
export interface InheritedFromParent {
  projectId: number | null;
  areaId: number;
  visibility: string;
}

export interface ParentCheck {
  /** 사람이 읽을 거절 사유. 통과면 null. */
  error: string | null;
  /** 통과일 때 물려받을 값. */
  inherit?: InheritedFromParent;
}

/**
 * 이 업무를 저 상위 밑에 둘 수 있는가.
 *
 * @param childId  수정이면 대상 id, 생성이면 null
 */
export async function checkParent(parentId: number, childId: number | null): Promise<ParentCheck> {
  if (childId !== null && parentId === childId) {
    return { error: "자기 자신을 상위 업무로 지정할 수 없습니다." };
  }
  const p = await queryOne<{
    id: number; title: string; parent_task_id: number | null;
    project_id: number | null; area_id: number; visibility: string;
  }>(
    `SELECT id, title, parent_task_id, project_id, area_id, visibility
       FROM task WHERE id = $1 AND is_active = true`,
    [parentId]
  );
  if (!p) return { error: "상위 업무를 찾을 수 없습니다." };

  // 깊이 2단 — 상위가 이미 누군가의 하위면 3단이 된다.
  if (p.parent_task_id !== null) {
    return { error: `"${p.title}"은(는) 이미 하위 업무입니다. 하위 업무 아래에는 다시 하위를 둘 수 없어요.` };
  }
  // 깊이 2단 — 내려가려는 업무가 이미 하위를 갖고 있으면 그 하위가 3단이 된다.
  if (childId !== null) {
    const kids = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM task WHERE parent_task_id = $1 AND is_active = true`, [childId]
    );
    if (Number(kids?.n ?? 0) > 0) {
      return { error: `이 업무에는 하위 업무 ${kids!.n}건이 있습니다. 하위를 가진 업무는 다른 업무의 하위가 될 수 없어요.` };
    }
  }
  return {
    error: null,
    inherit: { projectId: p.project_id, areaId: p.area_id, visibility: p.visibility },
  };
}

/**
 * §A2 · 28-b — 하위 업무는 목표에 직접 연결할 수 없다.
 *
 * **지금까지 막혀 있지 않았다.** goal_task 에 행은 들어가는데
 * goalSubtreeTaskInput 이 `parent_task_id IS NULL` 로 걸러서 진척에는 안 잡혔다 —
 * 즉 "붙였는데 아무 일도 안 일어나는" 조용한 실패였다. 그것을 막는다.
 *
 * @returns 연결해도 되면 null, 아니면 사람이 읽을 사유
 */
export async function rejectGoalLinkIfChild(taskId: number): Promise<string | null> {
  const t = await queryOne<{ parent_task_id: number | null; parent_title: string | null }>(
    `SELECT t.parent_task_id, p.title AS parent_title
       FROM task t LEFT JOIN task p ON p.id = t.parent_task_id
      WHERE t.id = $1`,
    [taskId]
  );
  if (!t || t.parent_task_id === null) return null;
  return `하위 업무는 목표에 직접 연결할 수 없습니다. 상위 업무 "${t.parent_title ?? `#${t.parent_task_id}`}"을(를) 목표에 연결하면 이 업무도 함께 집계됩니다.`;
}

export interface ChildRow {
  id: number; title: string; status: string; resolution: string | null;
  assigneeId: number | null; assigneeName: string | null;
  dueDate: string | null; progress: number;
}

/**
 * 상위 업무의 하위 목록 (§A1).
 *
 * 하위는 공개 범위를 상위에서 물려받으므로(§A2) 여기서 다시 가시성을 거르지 않는다 —
 * 상위를 볼 수 있으면 하위도 볼 수 있다. 상위 조회 자체가 이미 §A3 규칙으로 막혀 있다.
 */
export async function childrenOf(parentId: number): Promise<ChildRow[]> {
  const rows = await query<{
    id: number; title: string; status: string; resolution: string | null;
    assignee_id: number | null; assignee_name: string | null;
    due_date: string | null; progress: number;
  }>(
    `SELECT t.id, t.title, t.status, t.resolution, t.assignee_id,
            a.display_name AS assignee_name, t.due_date::text, t.progress
       FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
      WHERE t.parent_task_id = $1 AND t.is_active = true
      ORDER BY t.sort_order ASC, t.due_date ASC NULLS LAST, t.id`,
    [parentId]
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, resolution: r.resolution,
    assigneeId: r.assignee_id, assigneeName: r.assignee_name,
    dueDate: r.due_date, progress: r.progress ?? 0,
  }));
}
