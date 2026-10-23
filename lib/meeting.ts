// 회의실 — 서버 쪽 (0038_meeting.sql).
//
// ── 실시간은 「짧게 자주 묻기」다 ──────────────────────────────────
//
// 앱에는 웹소켓이 없다(Vercel 함수). 영상 · 화면 공유는 Jitsi 가 실시간으로 하고,
// 우리 쪽(안건 · 링크 · 결정 · 참석)은 화면이 2.5초마다 묻고 그때 「여기 있다」를 남긴다.
// 사람 넷이 회의하는 데 이 정도면 충분하다 — 끝나면 묻는 것도 끝난다.
//
// ── 누가 무엇을 하나 ─────────────────────────────────────────────
//   · 팀원 누구나 회의를 열고, 들어오고, 안건 · 링크 · 결정 · 할 일을 올리고, 찬성한다
//   · 결정 확정 · 회의 끝내기는 **연 사람이나 팀장**만 — 끝내면 회의록이 굳는다
//   · 끝난 회의는 읽기만 된다(고치는 길이 없다)
import { randomBytes } from "node:crypto";
import { query, queryOne } from "./db";
import { ensureCategory } from "./worklog";

export type ItemKind = "agenda" | "link" | "decision" | "action" | "note";
export const ITEM_KINDS: ItemKind[] = ["agenda", "link", "decision", "action", "note"];

/** 이 시간 안에 「여기 있다」를 보낸 사람만 「지금 들어와 있음」 */
export const PRESENT_SECONDS = 20;

export class MeetingError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface MeetingSummary {
  id: number; title: string; status: "live" | "ended"; startedAt: string; endedAt: string | null;
  startedBy: string; present: number; attendees: number; decisions: number; actions: number;
}
export interface MeetingItem {
  id: number; kind: ItemKind; body: string; url: string | null; meta: Record<string, unknown>;
  createdBy: string; createdById: number; createdAt: string;
}
export interface Attendee { id: number; name: string; present: boolean; joinedAt: string }
export interface MeetingDetail {
  id: number; title: string; status: "live" | "ended"; room: string; startedAt: string; endedAt: string | null;
  startedById: number; startedBy: string; items: MeetingItem[]; attendees: Attendee[]; minutes: unknown;
}

/** Jitsi 방 이름 — 추측 못 하게. 공개 Jitsi 서버에서 방 이름이 곧 열쇠다 */
function roomName(): string {
  return `aiot-robot-${randomBytes(10).toString("hex")}`;
}

export function jitsiDomain(): string {
  const d = (process.env.JITSI_DOMAIN ?? "meet.jit.si").trim();
  return /^[a-z0-9.-]+$/i.test(d) ? d : "meet.jit.si";
}

export async function listMeetings(): Promise<MeetingSummary[]> {
  const rows = await query<{
    id: number; title: string; status: "live" | "ended"; started_at: string; ended_at: string | null;
    started_by: string; present: string; attendees: string; decisions: string; actions: string;
  }>(
    `SELECT m.id, m.title, m.status, m.started_at::text, m.ended_at::text, a.display_name AS started_by,
            (SELECT count(*) FROM meeting_attendee x WHERE x.meeting_id = m.id
               AND x.last_seen_at > now() - interval '${PRESENT_SECONDS} seconds') AS present,
            (SELECT count(*) FROM meeting_attendee x WHERE x.meeting_id = m.id) AS attendees,
            (SELECT count(*) FROM meeting_item i WHERE i.meeting_id = m.id AND i.is_active
               AND i.kind = 'decision' AND i.meta ? 'decidedAt') AS decisions,
            (SELECT count(*) FROM meeting_item i WHERE i.meeting_id = m.id AND i.is_active AND i.kind = 'action') AS actions
       FROM meeting m JOIN actor a ON a.id = m.started_by
      WHERE m.status = 'live' OR m.started_at > now() - interval '60 days'
      ORDER BY (m.status = 'live') DESC, m.started_at DESC
      LIMIT 40`
  );
  return rows.map((r) => ({
    id: r.id, title: r.title, status: r.status, startedAt: r.started_at, endedAt: r.ended_at, startedBy: r.started_by,
    present: Number(r.present), attendees: Number(r.attendees), decisions: Number(r.decisions), actions: Number(r.actions),
  }));
}

export async function startMeeting(actorId: number, rawTitle: unknown): Promise<number> {
  const title = String(rawTitle ?? "").trim().slice(0, 120);
  if (!title) throw new MeetingError("회의 이름을 적어 주세요.");
  const row = await queryOne<{ id: number }>(
    `INSERT INTO meeting (title, room, started_by) VALUES ($1, $2, $3) RETURNING id`,
    [title, roomName(), actorId]
  );
  await heartbeat(row!.id, actorId);
  return row!.id;
}

export async function getMeeting(id: number): Promise<MeetingDetail | null> {
  const m = await queryOne<{
    id: number; title: string; status: "live" | "ended"; room: string; started_at: string; ended_at: string | null;
    started_by: number; starter: string; minutes: unknown;
  }>(
    `SELECT m.id, m.title, m.status, m.room, m.started_at::text, m.ended_at::text, m.started_by,
            a.display_name AS starter, m.minutes
       FROM meeting m JOIN actor a ON a.id = m.started_by WHERE m.id = $1`,
    [id]
  );
  if (!m) return null;
  const items = await query<{
    id: number; kind: ItemKind; body: string; url: string | null; meta: Record<string, unknown>;
    created_by: number; who: string; created_at: string;
  }>(
    `SELECT i.id, i.kind, i.body, i.url, i.meta, i.created_by, a.display_name AS who, i.created_at::text
       FROM meeting_item i JOIN actor a ON a.id = i.created_by
      WHERE i.meeting_id = $1 AND i.is_active
      ORDER BY i.kind, i.position, i.id`,
    [id]
  );
  const att = await query<{ id: number; name: string; present: boolean; joined_at: string }>(
    `SELECT x.actor_id AS id, a.display_name AS name, x.joined_at::text,
            (x.last_seen_at > now() - interval '${PRESENT_SECONDS} seconds') AS present
       FROM meeting_attendee x JOIN actor a ON a.id = x.actor_id
      WHERE x.meeting_id = $1 ORDER BY x.joined_at`,
    [id]
  );
  return {
    id: m.id, title: m.title, status: m.status, room: m.room, startedAt: m.started_at, endedAt: m.ended_at,
    startedById: m.started_by, startedBy: m.starter, minutes: m.minutes,
    items: items.map((i) => ({ id: i.id, kind: i.kind, body: i.body, url: i.url, meta: i.meta ?? {},
      createdBy: i.who, createdById: i.created_by, createdAt: i.created_at })),
    attendees: att.map((a) => ({ id: a.id, name: a.name, present: m.status === "live" && !!a.present, joinedAt: a.joined_at })),
  };
}

async function liveOrThrow(id: number): Promise<{ started_by: number }> {
  const m = await queryOne<{ status: string; started_by: number }>(`SELECT status, started_by FROM meeting WHERE id = $1`, [id]);
  if (!m) throw new MeetingError("회의를 찾을 수 없습니다.", 404);
  if (m.status !== "live") throw new MeetingError("끝난 회의입니다. 회의록만 볼 수 있어요.", 409);
  return m;
}

/** 「여기 있다」 — 끝난 회의에는 남기지 않는다 */
export async function heartbeat(id: number, actorId: number): Promise<void> {
  await query(
    `INSERT INTO meeting_attendee (meeting_id, actor_id)
     SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM meeting WHERE id = $1 AND status = 'live')
     ON CONFLICT (meeting_id, actor_id) DO UPDATE SET last_seen_at = now()`,
    [id, actorId]
  );
}

function cleanUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString().slice(0, 1000);
  } catch { return null; }
}

export async function addItem(id: number, actorId: number, input: { kind?: unknown; body?: unknown; url?: unknown; meta?: unknown }): Promise<number> {
  await liveOrThrow(id);
  const kind = String(input.kind ?? "") as ItemKind;
  if (!ITEM_KINDS.includes(kind)) throw new MeetingError("항목 종류가 올바르지 않습니다.");
  let url: string | null = null;
  let body = String(input.body ?? "").trim().slice(0, 1000);
  if (kind === "link") {
    url = cleanUrl(input.url ?? input.body);
    if (!url) throw new MeetingError("http 나 https 로 시작하는 링크를 붙여 주세요.");
    if (!body || body === url) body = url.replace(/^https?:\/\//, "").slice(0, 200);
  }
  if (!body) throw new MeetingError("내용이 비었습니다.");
  const meta: Record<string, unknown> = {};
  if (kind === "decision") meta.votes = [actorId];   // 올린 사람은 찬성으로 시작
  if (kind === "action" && input.meta && typeof input.meta === "object") {
    const m = input.meta as Record<string, unknown>;
    if (Number.isInteger(Number(m.assigneeId)) && Number(m.assigneeId) > 0) meta.assigneeId = Number(m.assigneeId);
    if (typeof m.due === "string" && /^\d{4}-\d{2}-\d{2}$/.test(m.due)) meta.due = m.due;
  }
  const row = await queryOne<{ id: number }>(
    `INSERT INTO meeting_item (meeting_id, kind, body, url, meta, created_by, position)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6,
             (SELECT coalesce(max(position), 0) + 1 FROM meeting_item WHERE meeting_id = $1 AND kind = $2))
     RETURNING id`,
    [id, kind, body, url, JSON.stringify(meta), actorId]
  );
  await heartbeat(id, actorId);
  return row!.id;
}

/**
 * 항목 바꾸기 — 하는 일이 정해져 있다(아무 칸이나 고치는 길을 열지 않는다).
 *   toggle  안건 끝냄/되돌림
 *   vote    결정에 찬성 / 찬성 거두기
 *   decide  결정 확정 — 연 사람 · 팀장만, 확정되면 찬성도 굳는다
 *   task    할 일에 만든 업무 번호를 단다(업무는 화면이 /api/tasks 로 만든다)
 *   remove  내리기 — 올린 사람 · 연 사람 · 팀장
 */
export async function updateItem(id: number, itemId: number, actorId: number, isLead: boolean,
  input: { op?: unknown; taskId?: unknown }): Promise<void> {
  const m = await liveOrThrow(id);
  const it = await queryOne<{ kind: ItemKind; meta: Record<string, unknown>; created_by: number }>(
    `SELECT kind, meta, created_by FROM meeting_item WHERE id = $1 AND meeting_id = $2 AND is_active`, [itemId, id]
  );
  if (!it) throw new MeetingError("항목을 찾을 수 없습니다.", 404);
  const meta = { ...(it.meta ?? {}) };
  const op = String(input.op ?? "");
  const host = m.started_by === actorId || isLead;
  if (op === "toggle" && it.kind === "agenda") {
    meta.done = !meta.done;
  } else if (op === "vote" && it.kind === "decision") {
    if (meta.decidedAt) throw new MeetingError("이미 확정된 결정입니다.", 409);
    const votes = new Set(Array.isArray(meta.votes) ? (meta.votes as number[]) : []);
    if (votes.has(actorId)) votes.delete(actorId); else votes.add(actorId);
    meta.votes = Array.from(votes);
  } else if (op === "decide" && it.kind === "decision") {
    if (!host) throw new MeetingError("결정 확정은 회의를 연 사람이나 팀장이 합니다.", 403);
    meta.decidedAt = new Date().toISOString();
  } else if (op === "task" && it.kind === "action") {
    const t = Number(input.taskId);
    if (!Number.isInteger(t) || t <= 0) throw new MeetingError("업무 번호가 올바르지 않습니다.");
    meta.taskId = t;
  } else if (op === "remove") {
    if (!(host || it.created_by === actorId)) throw new MeetingError("올린 사람이나 회의를 연 사람이 내릴 수 있습니다.", 403);
    await query(`UPDATE meeting_item SET is_active = false, updated_at = now() WHERE id = $1`, [itemId]);
    return;
  } else {
    throw new MeetingError("할 수 없는 일입니다.");
  }
  await query(`UPDATE meeting_item SET meta = $2::jsonb, updated_at = now() WHERE id = $1`, [itemId, JSON.stringify(meta)]);
  await heartbeat(id, actorId);
}

/**
 * 회의 끝내기 — 회의록을 굳히고, 참석자 각자의 업무기록에 한 줄씩 남긴다(카테고리 「회의」).
 * 끝낸 뒤에는 아무것도 안 바뀐다.
 */
export async function endMeeting(id: number, actorId: number, isLead: boolean): Promise<void> {
  const m = await liveOrThrow(id);
  if (!(m.started_by === actorId || isLead)) throw new MeetingError("회의 끝내기는 연 사람이나 팀장이 합니다.", 403);
  const d = await getMeeting(id);
  if (!d) throw new MeetingError("회의를 찾을 수 없습니다.", 404);
  const of = (k: ItemKind) => d.items.filter((i) => i.kind === k);
  const decided = of("decision").filter((i) => i.meta.decidedAt);
  const minutes = {
    title: d.title, startedAt: d.startedAt, endedAt: new Date().toISOString(),
    attendees: d.attendees.map((a) => a.name),
    agenda: of("agenda").map((i) => ({ body: i.body, done: !!i.meta.done })),
    decisions: decided.map((i) => ({ body: i.body, votes: Array.isArray(i.meta.votes) ? (i.meta.votes as number[]).length : 0 })),
    openProposals: of("decision").filter((i) => !i.meta.decidedAt).map((i) => i.body),
    actions: of("action").map((i) => ({ body: i.body, taskId: (i.meta.taskId as number | undefined) ?? null })),
    links: of("link").map((i) => ({ body: i.body, url: i.url })),
    notes: of("note").map((i) => i.body),
  };
  const ended = await queryOne<{ id: number }>(
    `UPDATE meeting SET status = 'ended', ended_at = now(), minutes = $2::jsonb
      WHERE id = $1 AND status = 'live' RETURNING id`,
    [id, JSON.stringify(minutes)]
  );
  if (!ended) return;   // 둘이 동시에 끝내면 한 번만
  // 참석자 각자의 업무기록에 한 줄 — 회의는 했는데 기록이 비면 월간 정리에서 빠진다
  const line = `회의 「${d.title}」 · 결정 ${minutes.decisions.length} · 할 일 ${minutes.actions.length}`.slice(0, 2000);
  for (const a of d.attendees) {
    const cat = await ensureCategory(a.id, "회의");
    await query(
      `INSERT INTO work_log (owner_actor_id, body, category_id) VALUES ($1, $2, $3)`,
      [a.id, line, cat.id]
    );
  }
}

/** 관제가 묻는다 — 지금 열린 회의에 들어와 있는 사람과 그 회의 이름 */
export async function inMeetingNow(): Promise<Map<number, { meetingId: number; title: string }>> {
  const rows = await query<{ actor_id: number; id: number; title: string }>(
    `SELECT DISTINCT ON (x.actor_id) x.actor_id, m.id, m.title
       FROM meeting_attendee x JOIN meeting m ON m.id = x.meeting_id AND m.status = 'live'
      WHERE x.last_seen_at > now() - interval '60 seconds'
      ORDER BY x.actor_id, x.last_seen_at DESC`
  );
  return new Map(rows.map((r) => [r.actor_id, { meetingId: r.id, title: r.title }]));
}
