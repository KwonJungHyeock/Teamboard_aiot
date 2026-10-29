// 업무를 고칠 수 있는 사람 (2026-10 QA 1) — 담당 · 만든 사람 · 팀장(관리자 권한 포함).
//
// 예전에는 「팀 공개 업무는 팀원 누구나 고친다」(SPEC 6장)였다. 운영해 보니 남의 업무가 내 이름으로
// 바뀌고 LIVE 에 남았다. 이제 그 밖의 사람은 **읽기만** 하고, 고칠 것은 「수정 요청」으로 알린다.
// 하위 업무(체크리스트 항목)는 상위의 담당 · 만든 사람도 고친다 — 상위 주인이 항목을 체크하고 정리한다.
//
// 진척 편집자(설정 › 진척 편집자)는 따로다 — 진행률 한 칸만, lib/progress-permission.ts 가 판단한다.
import { queryOne } from "./db";
import { hasLead } from "./types";
import type { SessionUser } from "./types";

export const EDIT_DENIED = "담당자 · 만든 사람 · 팀장만 고칠 수 있습니다. 「수정 요청」으로 담당자에게 알려 주세요.";

export interface TaskOwners { assignee_id: number | null; created_by: number | null; parent_task_id: number | null }

export const isLeadUser = (s: Pick<SessionUser, "role" | "adminGrant">) => hasLead(s.role) || s.adminGrant === true;

export async function canEditTask(s: SessionUser, t: TaskOwners): Promise<boolean> {
  if (isLeadUser(s)) return true;
  if (t.assignee_id === s.id || t.created_by === s.id) return true;
  if (!t.parent_task_id) return false;
  const p = await queryOne<{ assignee_id: number | null; created_by: number | null }>(
    `SELECT assignee_id, created_by FROM task WHERE id = $1`, [t.parent_task_id]);
  return !!p && (p.assignee_id === s.id || p.created_by === s.id);
}
