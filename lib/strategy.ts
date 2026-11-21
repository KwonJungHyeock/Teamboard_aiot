// 운영 전략 (0051, 지시서 v1): 서버 규칙 한 곳.
//
//   권한(역할 4종): 관리자 · 팀장 = 팀장 권한(잠금 · 담당 · 승인)
//                   팀원 = 항목 추가 · 고치기 · 의견. 잠긴 항목은 기준 변경을 「승인 대기」로만 남긴다
//                   뷰어 = 보기만
//   폐기는 status = 'dropped' (지우지 않는다). 되살리기는 상태를 되돌리는 것
//   알림은 기존 알림함(notification 표) 한 줄: 의견 → 담당자, 승인 대기 → 팀장들
import { query, queryOne } from "@/lib/db";
import { createNotification } from "@/lib/activity-inbox";
import { isLeadUser } from "@/lib/task-permission";
import type { SessionUser } from "@/lib/types";
import { isAxis, isPhase, isStatus, STRATEGY_LINK_AXIS, type StrategyApproval } from "@/lib/strategy-words";

type Who = Pick<SessionUser, "id" | "name" | "role" | "adminGrant">;
export class StrategyError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

export const canWrite = (s: Who) => s.role !== "viewer";
const mustWrite = (s: Who) => { if (!canWrite(s)) throw new StrategyError("보기 전용 계정입니다.", 403); };

export interface StrategyItem {
  id: number; axis: string; phase: number; title: string; standard: string; ownerId: number | null; ownerName: string | null;
  status: string; locked: boolean; linkUrl: string | null; changedAt: string; comments: number; pending: number;
}
export interface StrategyChange {
  id: number; before: string; after: string; reason: string | null; meetingId: number | null; meetingTitle: string | null;
  byName: string | null; at: string; approval: StrategyApproval; decidedByName: string | null; decidedAt: string | null;
}
export interface StrategyComment { id: number; authorId: number; authorName: string; body: string; at: string }

const ITEM_SQL = `SELECT i.id, i.axis, i.phase, i.title, i.standard, i.owner_id, o.display_name AS owner_name, i.status, i.locked,
                         i.link_url, i.changed_at::text,
                         (SELECT count(*)::int FROM strategy_comment c WHERE c.item_id = i.id) AS comments,
                         (SELECT count(*)::int FROM strategy_change h WHERE h.item_id = i.id AND h.approval = 'pending') AS pending
                    FROM strategy_item i LEFT JOIN actor o ON o.id = i.owner_id`;
interface ItemRow {
  id: number; axis: string; phase: number; title: string; standard: string; owner_id: number | null; owner_name: string | null;
  status: string; locked: boolean; link_url: string | null; changed_at: string; comments: number; pending: number;
}
const outItem = (r: ItemRow): StrategyItem => ({
  id: r.id, axis: r.axis, phase: r.phase, title: r.title, standard: r.standard, ownerId: r.owner_id, ownerName: r.owner_name,
  status: r.status, locked: r.locked, linkUrl: r.link_url, changedAt: r.changed_at, comments: r.comments, pending: r.pending,
});

/** 모든 항목(폐기 포함: 거르개가 화면에서 고른다). 의견 수 · 승인 대기 수는 서버가 센다 */
export async function listItems(): Promise<StrategyItem[]> {
  return (await query<ItemRow>(`${ITEM_SQL} ORDER BY i.axis, i.phase, i.sort_order, i.id`)).map(outItem);
}
async function itemRow(id: number): Promise<ItemRow | null> {
  return queryOne<ItemRow>(`${ITEM_SQL} WHERE i.id = $1`, [id]);
}

export async function getItem(id: number): Promise<{ item: StrategyItem; changes: StrategyChange[]; comments: StrategyComment[] } | null> {
  const r = await itemRow(id);
  if (!r) return null;
  const changes = await query<{
    id: number; before_text: string; after_text: string; reason: string | null; meeting_id: number | null; meeting_title: string | null;
    by_name: string | null; changed_at: string; approval: StrategyApproval; decided_by_name: string | null; decided_at: string | null;
  }>(
    `SELECT h.id, h.before_text, h.after_text, h.reason, h.meeting_id, m.title AS meeting_title, b.display_name AS by_name,
            h.changed_at::text, h.approval, d.display_name AS decided_by_name, h.decided_at::text
       FROM strategy_change h
       LEFT JOIN meeting m ON m.id = h.meeting_id
       LEFT JOIN actor b ON b.id = h.changed_by
       LEFT JOIN actor d ON d.id = h.decided_by
      WHERE h.item_id = $1 ORDER BY h.changed_at DESC, h.id DESC`, [id]);
  const comments = await query<{ id: number; author_id: number; author_name: string; body: string; created_at: string }>(
    `SELECT c.id, c.author_id, a.display_name AS author_name, c.body, c.created_at::text
       FROM strategy_comment c JOIN actor a ON a.id = c.author_id
      WHERE c.item_id = $1 ORDER BY c.created_at DESC, c.id DESC`, [id]);
  return {
    item: outItem(r),
    changes: changes.map((h) => ({ id: h.id, before: h.before_text, after: h.after_text, reason: h.reason, meetingId: h.meeting_id,
      meetingTitle: h.meeting_title, byName: h.by_name, at: h.changed_at, approval: h.approval, decidedByName: h.decided_by_name, decidedAt: h.decided_at })),
    comments: comments.map((c) => ({ id: c.id, authorId: c.author_id, authorName: c.author_name, body: c.body, at: c.created_at })),
  };
}

/** 고르기용: 최근 회의(직접 고칠 때 「회의 링크」 칸) */
export async function recentMeetings(): Promise<{ id: number; title: string; at: string }[]> {
  return query<{ id: number; title: string; at: string }>(
    `SELECT id, title, started_at::text AS at FROM meeting WHERE started_at > now() - interval '120 days' ORDER BY started_at DESC LIMIT 30`);
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const optId = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const cleanUrl = (v: unknown): string | null => {
  const u = text(v, 500);
  if (!u) return null;
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) throw new StrategyError("링크는 http 로 시작하는 주소나 /v3 같은 화면 주소로 적어 주세요.");
  return u;
};

/** 회의 · 결정 줄이 실제로 있고 서로 맞는지 */
async function meetingRef(meetingIdIn: unknown, meetingItemIdIn: unknown): Promise<{ meetingId: number | null; meetingItemId: number | null }> {
  const meetingId = optId(meetingIdIn), meetingItemId = optId(meetingItemIdIn);
  if (!meetingId) return { meetingId: null, meetingItemId: null };
  const m = await queryOne<{ id: number }>(`SELECT id FROM meeting WHERE id = $1`, [meetingId]);
  if (!m) throw new StrategyError("회의를 찾지 못했습니다.", 404);
  if (meetingItemId) {
    const it = await queryOne<{ id: number }>(`SELECT id FROM meeting_item WHERE id = $1 AND meeting_id = $2 AND kind = 'decision'`, [meetingItemId, meetingId]);
    if (!it) throw new StrategyError("회의 결정을 찾지 못했습니다.", 404);
  }
  return { meetingId, meetingItemId };
}

async function notifyLeads(itemId: number, actorId: number, snippet: string) {
  const leads = await query<{ id: number }>(
    `SELECT a.actor_id AS id FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin', 'lead') OR a.admin_grant = true)`);
  for (const l of leads) {
    await createNotification({ userId: l.id, type: "approval", refType: "strategy", refId: itemId, actorId, snippet });
  }
}

/**
 * 현재 기준 바꾸기: 이력은 늘 남는다.
 *   잠금 + 팀장 아님 → 승인 대기로 이력에만. 현재 기준 · 최근 변경일은 그대로. 팀장들 알림함에 한 줄
 *   그 밖 → 바로 반영
 */
export async function changeStandard(s: Who, id: number, p: Record<string, unknown>): Promise<{ approval: StrategyApproval }> {
  mustWrite(s);
  const r = await itemRow(id);
  if (!r) throw new StrategyError("항목을 찾지 못했습니다.", 404);
  if (r.status === "dropped") throw new StrategyError("폐기한 항목입니다. 되살린 뒤 고쳐 주세요.");
  const after = text(p.standard, 4000);
  if (!after) throw new StrategyError("바뀐 기준을 적어 주세요.");
  if (after === r.standard) throw new StrategyError("지금 기준과 같습니다.");
  const reason = text(p.reason, 1000) || null;
  const { meetingId, meetingItemId } = await meetingRef(p.meetingId, p.meetingItemId);
  const pending = r.locked && !isLeadUser(s);
  const approval: StrategyApproval = pending ? "pending" : "direct";
  await query(
    `INSERT INTO strategy_change (item_id, before_text, after_text, reason, meeting_id, meeting_item_id, changed_by, approval, team_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT team_id FROM strategy_item WHERE id = $1))`,
    [id, r.standard, after, reason, meetingId, meetingItemId, s.id, approval]);
  if (pending) await notifyLeads(id, s.id, `전략 승인 대기 · ${r.title}`);
  else await query(`UPDATE strategy_item SET standard = $2, changed_at = now() WHERE id = $1`, [id, after]);
  return { approval };
}

/** 승인 · 반려: 팀장만. 승인하면 현재 기준이 바뀐 기준으로 */
export async function decideChange(s: Who, changeId: number, action: unknown): Promise<void> {
  if (!isLeadUser(s)) throw new StrategyError("승인 · 반려는 팀장만 합니다.", 403);
  if (action !== "approve" && action !== "reject") throw new StrategyError("알 수 없는 처리입니다.");
  const h = await queryOne<{ id: number; item_id: number; after_text: string }>(
    `UPDATE strategy_change SET approval = $2, decided_by = $3, decided_at = now()
      WHERE id = $1 AND approval = 'pending' RETURNING id, item_id, after_text`,
    [changeId, action === "approve" ? "approved" : "rejected", s.id]);
  if (!h) throw new StrategyError("이미 처리했거나 없는 요청입니다.", 409);
  if (action === "approve") await query(`UPDATE strategy_item SET standard = $2, changed_at = now() WHERE id = $1`, [h.item_id, h.after_text]);
}

/** 항목 추가: 담당은 비운다(팀장이 지정). 회의에서 만들면 첫 이력에 회의 링크가 붙는다 */
export async function createItem(s: Who, p: Record<string, unknown>): Promise<number> {
  mustWrite(s);
  if (!isAxis(p.axis)) throw new StrategyError("축을 골라 주세요.");
  const phase = Number(p.phase);
  if (!isPhase(phase)) throw new StrategyError("단계를 골라 주세요.");
  const title = text(p.title, 200);
  if (!title) throw new StrategyError("항목명을 적어 주세요.");
  const standard = text(p.standard, 4000);
  const linkUrl = p.axis === STRATEGY_LINK_AXIS ? cleanUrl(p.linkUrl) : null;
  const { meetingId, meetingItemId } = await meetingRef(p.meetingId, p.meetingItemId);
  const row = await queryOne<{ id: number }>(
    `INSERT INTO strategy_item (axis, phase, title, standard, status, link_url, created_by, sort_order)
     VALUES ($1,$2,$3,$4,'review',$5,$6, COALESCE((SELECT max(sort_order) + 1 FROM strategy_item WHERE axis = $1 AND phase = $2), 1))
     RETURNING id`, [p.axis, phase, title, standard, linkUrl, s.id]);
  if (standard) {
    await query(
      `INSERT INTO strategy_change (item_id, before_text, after_text, reason, meeting_id, meeting_item_id, changed_by, approval, team_id)
       VALUES ($1,'',$2,$3,$4,$5,$6,'direct',(SELECT team_id FROM strategy_item WHERE id = $1))`,
      [row!.id, standard, text(p.reason, 1000) || null, meetingId, meetingItemId, s.id]);
  }
  return row!.id;
}

/**
 * 기준 밖의 칸 고치기: 항목명 · 축 · 단계 · 상태(폐기 · 되살리기) · 집계 링크 · 담당 · 잠금.
 *   담당 · 잠금은 팀장만. 잠긴 항목은 팀장만 고친다(팀원은 기준 변경을 승인 요청으로)
 */
export async function updateItem(s: Who, id: number, p: Record<string, unknown>): Promise<void> {
  mustWrite(s);
  const r = await itemRow(id);
  if (!r) throw new StrategyError("항목을 찾지 못했습니다.", 404);
  const lead = isLeadUser(s);
  const sets: string[] = [], vals: unknown[] = [id];
  const set = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if ("ownerId" in p || "locked" in p) {
    if (!lead) throw new StrategyError("담당 지정과 잠금은 팀장만 합니다.", 403);
    if ("ownerId" in p) {
      const o = p.ownerId === null || p.ownerId === "" ? null : optId(p.ownerId);
      if (o !== null && !(await queryOne(`SELECT id FROM actor WHERE id = $1 AND type = 'human' AND is_active`, [o]))) throw new StrategyError("담당자를 찾지 못했습니다.", 404);
      set("owner_id", o);
    }
    if ("locked" in p) set("locked", p.locked === true);
  }
  const plain = ["title", "axis", "phase", "status", "linkUrl"].filter((k) => k in p);
  if (plain.length) {
    if (r.locked && !lead) throw new StrategyError("잠긴 항목은 팀장만 고칩니다. 기준 변경은 승인 요청으로 남겨 주세요.", 403);
    if ("title" in p) { const t = text(p.title, 200); if (!t) throw new StrategyError("항목명을 적어 주세요."); set("title", t); }
    const axis = "axis" in p ? p.axis : r.axis;
    if ("axis" in p) { if (!isAxis(p.axis)) throw new StrategyError("축을 골라 주세요."); set("axis", p.axis); }
    if ("phase" in p) { const ph = Number(p.phase); if (!isPhase(ph)) throw new StrategyError("단계를 골라 주세요."); set("phase", ph); }
    if ("status" in p) { if (!isStatus(p.status)) throw new StrategyError("상태를 골라 주세요."); set("status", p.status); }
    if ("linkUrl" in p) set("link_url", axis === STRATEGY_LINK_AXIS ? cleanUrl(p.linkUrl) : null);
    else if ("axis" in p && axis !== STRATEGY_LINK_AXIS) set("link_url", null);
  }
  if (!sets.length) return;
  await query(`UPDATE strategy_item SET ${sets.join(", ")}, changed_at = now() WHERE id = $1`, vals);
}

/** 의견: 담당자 알림함에 한 줄(본인이 담당이면 안 보낸다) */
export async function addComment(s: Who, id: number, bodyIn: unknown): Promise<void> {
  mustWrite(s);
  const r = await itemRow(id);
  if (!r) throw new StrategyError("항목을 찾지 못했습니다.", 404);
  const body = text(bodyIn, 2000);
  if (!body) throw new StrategyError("의견을 적어 주세요.");
  await query(`INSERT INTO strategy_comment (item_id, author_id, body, team_id) VALUES ($1,$2,$3,(SELECT team_id FROM strategy_item WHERE id = $1))`, [id, s.id, body]);
  if (r.owner_id && r.owner_id !== s.id) {
    await createNotification({ userId: r.owner_id, type: "reply", refType: "strategy", refId: id, actorId: s.id, snippet: `전략 의견 · ${r.title}`, bundle: true });
  }
}
