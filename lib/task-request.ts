// 업무 요청 (2026-11-18, 0050) — 팀원끼리 업무를 부탁한다.
//
//   요청(대기) ─ 받은 사람이 수락 → 업무가 생긴다(담당 = 받은 사람, 만든 사람 = 요청한 사람)
//              └ 거절(사유) · 요청한 사람이 취소 → 상태만 바뀌고 남는다(지우지 않는다)
//   수락 전에는 task 가 없다 — 업무 목록 · 통계 · 보고에 안 섞인다.
//   알림: 요청 → 받은 사람 / 수락 · 거절 → 요청한 사람 / 그 업무 완료 → 요청한 사람.
import { query, queryOne } from "@/lib/db";
import { createNotification } from "@/lib/activity-inbox";
import { notify as pushNotify } from "@/lib/push";
import { logActivity } from "@/lib/activity";
import { NEW_TASK_GOAL_SOURCE } from "@/lib/goal-inherit";

export const PRIORITIES = ["urgent", "high", "mid", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const isPriority = (v: unknown): v is Priority => typeof v === "string" && (PRIORITIES as readonly string[]).includes(v);
const PRI_WORD: Record<string, string> = { urgent: "[긴급] ", high: "[높음] ", mid: "", low: "" };

export interface TaskRequest {
  id: number; fromId: number; fromName: string; toId: number; toName: string;
  title: string; body: string; dueDate: string | null; priority: string;
  status: "pending" | "accepted" | "declined" | "canceled"; reply: string | null;
  taskId: number | null; taskStatus: string | null; createdAt: string; decidedAt: string | null;
}

interface Row {
  id: number; from_id: number; from_name: string; to_id: number; to_name: string; title: string; body: string;
  due_date: string | null; priority: string; status: TaskRequest["status"]; reply: string | null;
  task_id: number | null; task_status: string | null; created_at: string; decided_at: string | null;
}
const SELECT = `SELECT r.id, r.from_id, fa.display_name AS from_name, r.to_id, ta.display_name AS to_name, r.title, r.body,
                       r.due_date::text, r.priority, r.status, r.reply, r.task_id,
                       CASE WHEN t.is_active THEN t.status END AS task_status, r.created_at::text, r.decided_at::text
                  FROM task_request r
                  JOIN actor fa ON fa.id = r.from_id
                  JOIN actor ta ON ta.id = r.to_id
                  LEFT JOIN task t ON t.id = r.task_id`;
const out = (r: Row): TaskRequest => ({
  id: r.id, fromId: r.from_id, fromName: r.from_name, toId: r.to_id, toName: r.to_name, title: r.title, body: r.body,
  dueDate: r.due_date, priority: r.priority, status: r.status, reply: r.reply, taskId: r.task_id, taskStatus: r.task_status,
  createdAt: r.created_at, decidedAt: r.decided_at,
});

/** 내가 받은 · 보낸 요청. 대기 중이 먼저, 끝난 것은 최근 60일만 */
export async function listRequests(viewerId: number): Promise<{ received: TaskRequest[]; sent: TaskRequest[] }> {
  const rows = await query<Row>(
    `${SELECT}
      WHERE (r.to_id = $1 OR r.from_id = $1)
        AND (r.status = 'pending' OR r.created_at > now() - interval '60 days')
      ORDER BY (r.status = 'pending') DESC,
               CASE r.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'mid' THEN 2 ELSE 3 END,
               r.created_at DESC
      LIMIT 200`, [viewerId]);
  const all = rows.map(out);
  return { received: all.filter((r) => r.toId === viewerId), sent: all.filter((r) => r.fromId === viewerId) };
}

/** 받은 요청 중 대기 — 탭 숫자 */
export async function pendingCount(viewerId: number): Promise<number> {
  const r = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM task_request WHERE to_id = $1 AND status = 'pending'`, [viewerId]);
  return r?.n ?? 0;
}

export class RequestError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const clean = (n: string) => n.replace(/ \(Claude\)$/, "");

export async function createRequest(me: { id: number; name: string }, p: Record<string, unknown>): Promise<TaskRequest> {
  const toId = Number(p.toId);
  const title = String(p.title ?? "").trim().slice(0, 200);
  if (!title) throw new RequestError("무엇을 부탁할지 적어 주세요.");
  if (!Number.isInteger(toId) || toId <= 0) throw new RequestError("누구에게 부탁할지 골라 주세요.");
  if (toId === me.id) throw new RequestError("나에게는 요청할 수 없습니다. 내 업무로 등록해 주세요.");
  const to = await queryOne<{ id: number }>(`SELECT id FROM actor WHERE id = $1 AND type = 'human' AND is_active`, [toId]);
  if (!to) throw new RequestError("받을 사람을 찾지 못했습니다.", 404);
  const priority = isPriority(p.priority) ? p.priority : "mid";
  const due = isDate(p.dueDate) ? p.dueDate : null;
  const body = String(p.body ?? "").trim().slice(0, 4000);
  const r = await queryOne<{ id: number }>(
    `INSERT INTO task_request (from_id, to_id, title, body, due_date, priority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [me.id, toId, title, body, due, priority]);
  await createNotification({ userId: toId, type: "assign", refType: "request", refId: r!.id, actorId: me.id,
    snippet: `${PRI_WORD[priority]}업무 요청 · ${title}` });
  await pushNotify([toId], "assign", { title: `${clean(me.name)} 님이 업무를 요청했습니다`, body: `${PRI_WORD[priority]}${title}`,
    url: "/v3/requests", tag: `request-${r!.id}` });
  return (await getRequest(r!.id))!;
}

export async function getRequest(id: number): Promise<TaskRequest | null> {
  const r = await queryOne<Row>(`${SELECT} WHERE r.id = $1`, [id]);
  return r ? out(r) : null;
}

/** 받은 사람이 수락 — 업무를 만들고 잇는다. 카테고리는 고르면 그것, 아니면 받은 사람 소속 영역 */
/** `done` — 「바로 완료」: 받자마자 끝낸 일(짧은 부탁). 업무는 완료로 만들고, 요청한 사람에게는 완료 알림 하나만 간다 */
export async function acceptRequest(me: { id: number; name: string }, id: number, areaIdIn?: unknown, done = false): Promise<TaskRequest> {
  const req = await getRequest(id);
  if (!req) throw new RequestError("요청을 찾지 못했습니다.", 404);
  if (req.toId !== me.id) throw new RequestError("받은 사람만 수락할 수 있습니다.", 403);
  if (req.status !== "pending") throw new RequestError("이미 처리된 요청입니다.", 409);
  let areaId = Number(areaIdIn) || null;
  if (areaId) {
    const ok = await queryOne<{ id: number }>(`SELECT id FROM area WHERE id = $1 AND is_active`, [areaId]);
    if (!ok) areaId = null;
  }
  if (!areaId) {
    const fb = await queryOne<{ id: number }>(
      `SELECT a.id FROM area a
         LEFT JOIN actor_area aa ON aa.area_id = a.id AND aa.actor_id = $1
        WHERE a.is_active = true
        ORDER BY (aa.actor_id IS NULL), a.sort_order, a.id LIMIT 1`, [me.id]);
    areaId = fb?.id ?? null;
  }
  if (!areaId) throw new RequestError("업무 카테고리가 없습니다. 설정에서 카테고리를 먼저 만들어 주세요.");

  // 같은 요청을 두 번 눌러도 업무는 하나 — 대기 중일 때만 잡는다
  const lock = await queryOne<{ id: number }>(
    `UPDATE task_request SET status = 'accepted', decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [id]);
  if (!lock) throw new RequestError("이미 처리된 요청입니다.", 409);
  const desc = [req.body, `요청: ${clean(req.fromName)}`].filter(Boolean).join("\n\n");
  const task = await queryOne<{ id: number }>(
    `INSERT INTO task (area_id, work_type, title, description, status, assignee_id, due_date, priority, origin, created_by, visibility, goal_source, sort_order)
     VALUES ($1,'team',$2,$3,$9,$4,$5,$6,'human',$7,'team',$8,
             COALESCE((SELECT max(s.sort_order) + 1 FROM task s WHERE s.is_active = true AND s.parent_task_id IS NULL), 1))
     RETURNING id`,
    [areaId, req.title, desc.slice(0, 4000), me.id, req.dueDate, req.priority, req.fromId, NEW_TASK_GOAL_SOURCE, done ? "done" : "todo"]);
  if (done) await query(`UPDATE task SET completed_at = now(), progress = 100 WHERE id = $1`, [task!.id]);
  await query(`UPDATE task_request SET task_id = $2 WHERE id = $1`, [id, task!.id]);
  await logActivity({ userId: me.id, taskId: task!.id, message: `${me.name}이(가) ${clean(req.fromName)} 님의 요청을 ${done ? "수락하고 완료" : "수락"} — "${req.title}"` });
  if (done) await notifyRequestDone(task!.id, me.id);
  else await createNotification({ userId: req.fromId, type: "system", refType: "request", refId: id, actorId: me.id,
    snippet: `요청 수락 · ${req.title}` });
  return (await getRequest(id))!;
}

export async function declineRequest(me: { id: number; name: string }, id: number, replyIn: unknown): Promise<TaskRequest> {
  const req = await getRequest(id);
  if (!req) throw new RequestError("요청을 찾지 못했습니다.", 404);
  if (req.toId !== me.id) throw new RequestError("받은 사람만 거절할 수 있습니다.", 403);
  const reply = String(replyIn ?? "").trim().slice(0, 500) || null;
  const r = await queryOne<{ id: number }>(
    `UPDATE task_request SET status = 'declined', reply = $2, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [id, reply]);
  if (!r) throw new RequestError("이미 처리된 요청입니다.", 409);
  await createNotification({ userId: req.fromId, type: "system", refType: "request", refId: id, actorId: me.id,
    snippet: `요청 거절 · ${req.title}${reply ? ` — ${reply}` : ""}` });
  return (await getRequest(id))!;
}

export async function cancelRequest(me: { id: number }, id: number): Promise<TaskRequest> {
  const req = await getRequest(id);
  if (!req) throw new RequestError("요청을 찾지 못했습니다.", 404);
  if (req.fromId !== me.id) throw new RequestError("요청한 사람만 취소할 수 있습니다.", 403);
  const r = await queryOne<{ id: number }>(
    `UPDATE task_request SET status = 'canceled', decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [id]);
  if (!r) throw new RequestError("이미 처리된 요청입니다.", 409);
  // 받은 사람 알림함에 남은 요청 알림은 걷는다 — 눌러도 할 일이 없다
  await query(`UPDATE notification SET archived = true WHERE user_id = $1 AND ref_type = 'request' AND ref_id = $2`, [req.toId, id]);
  return (await getRequest(id))!;
}

/** 다시 알림 — 요청한 사람이 대기 중인 요청을 한 번 더 알린다. 하루 한 번 */
export async function remindRequest(me: { id: number; name: string }, id: number, today: string): Promise<boolean> {
  const req = await getRequest(id);
  if (!req) throw new RequestError("요청을 찾지 못했습니다.", 404);
  if (req.fromId !== me.id) throw new RequestError("요청한 사람만 다시 알릴 수 있습니다.", 403);
  if (req.status !== "pending") throw new RequestError("이미 처리된 요청입니다.", 409);
  const r = await createNotification({ userId: req.toId, type: "assign", refType: "request", refId: id, actorId: me.id,
    snippet: `다시 알림 · ${PRI_WORD[req.priority] ?? ""}${req.title}`, dedupeKey: `request-remind:${id}:${today}` });
  if (r !== "created") return false;
  await pushNotify([req.toId], "assign", { title: `${clean(me.name)} 님이 요청을 다시 알렸습니다`, body: req.title, url: "/v3/requests", tag: `request-${id}` });
  return true;
}

/** 요청으로 생긴 업무가 완료되면 — 요청한 사람에게 알린다(본인이 완료했으면 안 보낸다) */
export async function notifyRequestDone(taskId: number, actorId: number): Promise<void> {
  const r = await queryOne<{ id: number; from_id: number; title: string }>(
    `SELECT id, from_id, title FROM task_request WHERE task_id = $1 AND status = 'accepted'`, [taskId]);
  if (!r) return;
  await createNotification({ userId: r.from_id, type: "system", refType: "task", refId: taskId, actorId,
    snippet: `요청한 업무 완료 · ${r.title}`, dedupeKey: `request-done:${r.id}` });
}
