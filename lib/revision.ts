// 수정 요청 (0043). 업무 하나에 열린 요청은 하나 — 새로 달면 이전 것을 닫는다.
//   · 다는 사람: 업무를 만든 사람(맡긴 사람) 또는 팀장 · 관리자. 담당 본인은 달 수 없다
//   · 닫는 사람: 담당(「수정 완료」) 또는 단 사람
import { query, queryOne } from "./db";
import { visibleTaskSql } from "./visibility";
import { createNotification } from "./activity-inbox";
import { logActivity } from "./activity";

export class RevisionError extends Error { constructor(message: string, public status = 400) { super(message); } }
export interface Revision { id: number; taskId: number; requesterId: number; requesterName: string; memo: string; createdAt: string }

/** 내가 볼 수 있는 업무에 열린 수정 요청 전부 */
export async function openRevisions(viewerId: number): Promise<Revision[]> {
  const rows = await query<{ id: number; task_id: number; requester_id: number; name: string; memo: string; created_at: string }>(
    `SELECT r.id, r.task_id, r.requester_id, a.display_name AS name, r.memo, r.created_at::text
       FROM task_revision r JOIN task t ON t.id = r.task_id AND t.is_active JOIN actor a ON a.id = r.requester_id
      WHERE r.resolved_at IS NULL AND ${visibleTaskSql("$1")} ORDER BY r.created_at`, [viewerId]);
  return rows.map((r) => ({ id: r.id, taskId: r.task_id, requesterId: r.requester_id, requesterName: r.name, memo: r.memo, createdAt: r.created_at }));
}

async function taskOf(taskId: number, viewerId: number) {
  const t = await queryOne<{ id: number; title: string; assignee_id: number | null; created_by: number | null }>(
    `SELECT t.id, t.title, t.assignee_id, t.created_by FROM task t WHERE t.id = $1 AND t.is_active AND ${visibleTaskSql("$2")}`, [taskId, viewerId]);
  if (!t) throw new RevisionError("업무를 찾을 수 없습니다.", 404);
  return t;
}

export async function requestRevision(taskId: number, by: { id: number; name: string; lead: boolean }, rawMemo: unknown): Promise<void> {
  const t = await taskOf(taskId, by.id);
  if (t.assignee_id === by.id) throw new RevisionError("내 업무에는 수정 요청을 달 수 없습니다.");
  if (t.created_by !== by.id && !by.lead) throw new RevisionError("맡긴 사람이나 팀장만 수정 요청을 달 수 있습니다.", 403);
  const memo = String(rawMemo ?? "").trim().slice(0, 500);
  await query(`UPDATE task_revision SET resolved_at = now(), resolved_by = $2 WHERE task_id = $1 AND resolved_at IS NULL`, [taskId, by.id]);
  await query(`INSERT INTO task_revision (task_id, requester_id, memo) VALUES ($1, $2, $3)`, [taskId, by.id, memo]);
  await logActivity({ userId: by.id, message: `${by.name}이(가) 수정 요청 — "${t.title}"`, taskId }).catch(() => {});
  if (t.assignee_id) await createNotification({ userId: t.assignee_id, type: "mention", refType: "task", refId: taskId,
    snippet: `${by.name} · 수정 요청 — ${memo || t.title}`, actorId: by.id }).catch(() => {});
}

export async function resolveRevision(taskId: number, by: { id: number; name: string }): Promise<void> {
  const t = await taskOf(taskId, by.id);
  const open = await queryOne<{ id: number; requester_id: number }>(
    `SELECT id, requester_id FROM task_revision WHERE task_id = $1 AND resolved_at IS NULL`, [taskId]);
  if (!open) return;
  if (t.assignee_id !== by.id && open.requester_id !== by.id) throw new RevisionError("담당이나 요청한 사람만 닫을 수 있습니다.", 403);
  await query(`UPDATE task_revision SET resolved_at = now(), resolved_by = $2 WHERE id = $1`, [open.id, by.id]);
  await logActivity({ userId: by.id, message: `${by.name}이(가) 수정 완료 — "${t.title}"`, taskId }).catch(() => {});
  if (open.requester_id !== by.id) await createNotification({ userId: open.requester_id, type: "reply", refType: "task", refId: taskId,
    snippet: `${by.name} · 수정 완료 — ${t.title}`, actorId: by.id }).catch(() => {});
}

/** 「확인 요청」 — 맡긴 사람이 담당에게 진행 상황을 묻는 알림 한 번(같은 날 같은 업무는 묶인다) */
export async function nudge(taskId: number, by: { id: number; name: string }): Promise<void> {
  const t = await taskOf(taskId, by.id);
  if (!t.assignee_id || t.assignee_id === by.id) throw new RevisionError("담당이 없거나 내 업무입니다.");
  await createNotification({ userId: t.assignee_id, type: "mention", refType: "task", refId: taskId,
    snippet: `${by.name} · 확인 요청 — ${t.title}`, actorId: by.id, bundle: true });
}
