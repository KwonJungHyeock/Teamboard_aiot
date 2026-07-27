// 허들룸 리뷰 세션 — 섹션별 이전/이후 비교 → 코멘트 → 확정/수정/보류 → 옵션 선정.
// 확정(done) 시 논의·결정(signal) 레코드를 자동 생성해 연결한다.
import { query, queryOne } from "./db";

export type Decision = "none" | "done" | "rev" | "hold";

// 세션 시작 시 자동 생성되는 플랫폼 화면 프리셋 섹션 (추가·삭제 가능)
export const PRESET_SECTIONS = [
  "홈",
  "내 업무",
  "승인 대기",
  "논의·결정",
  "타임라인",
  "목표",
  "월간 보고",
  "허들룸",
];

export interface ReviewItem {
  id: number;
  ord: number;
  name: string;
  beforeUrl: string | null;
  afterUrl: string | null;
  optionText: string;
  decision: Decision;
  signalId: number | null;
  comments: { id: number; author: string; body: string; createdAt: string }[];
}

export interface ReviewSessionDetail {
  id: number;
  huddleId: number | null;
  title: string;
  status: "open" | "closed";
  createdBy: number;
  createdByName: string;
  items: ReviewItem[];
  progress: { done: number; total: number };
}

/** 세션 생성 — preset=true 면 플랫폼 화면 프리셋 섹션 자동 생성 */
export async function createReviewSession(opts: {
  title: string;
  huddleId?: number | null;
  createdBy: number;
  preset?: boolean;
}): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO review_session (huddle_id, title, created_by) VALUES ($1, $2, $3) RETURNING id`,
    [opts.huddleId ?? null, opts.title.slice(0, 200), opts.createdBy]
  );
  const sessionId = row!.id;
  if (opts.preset !== false) {
    for (let i = 0; i < PRESET_SECTIONS.length; i++) {
      await query(
        `INSERT INTO review_item (session_id, ord, name) VALUES ($1, $2, $3)`,
        [sessionId, i, PRESET_SECTIONS[i]]
      );
    }
  }
  return sessionId;
}

export async function listReviewSessions(huddleId?: number) {
  return query<{ id: number; title: string; status: string; created_at: string; done: string; total: string }>(
    `SELECT s.id, s.title, s.status, s.created_at::text,
            count(i.*) FILTER (WHERE i.decision = 'done') AS done,
            count(i.*) AS total
       FROM review_session s LEFT JOIN review_item i ON i.session_id = s.id
      WHERE s.is_active = true ${huddleId ? "AND s.huddle_id = $1" : ""}
      GROUP BY s.id ORDER BY s.created_at DESC`,
    huddleId ? [huddleId] : []
  );
}

export async function getReviewSession(id: number): Promise<ReviewSessionDetail | null> {
  const s = await queryOne<{ id: number; huddle_id: number | null; title: string; status: "open" | "closed"; created_by: number; created_by_name: string }>(
    `SELECT s.id, s.huddle_id, s.title, s.status, s.created_by, a.display_name AS created_by_name
       FROM review_session s JOIN actor a ON a.id = s.created_by
      WHERE s.id = $1 AND s.is_active = true`,
    [id]
  );
  if (!s) return null;
  const items = await query<{
    id: number; ord: number; name: string; before_url: string | null; after_url: string | null;
    option_text: string; decision: Decision; signal_id: number | null;
  }>(
    `SELECT id, ord, name, before_url, after_url, option_text, decision, signal_id
       FROM review_item WHERE session_id = $1 ORDER BY ord, id`,
    [id]
  );
  const comments = await query<{ id: number; review_item_id: number; author: string; body: string; created_at: string }>(
    `SELECT c.id, c.review_item_id, a.display_name AS author, c.body, c.created_at::text
       FROM comment c JOIN actor a ON a.id = c.author_id
      WHERE c.review_item_id IN (SELECT id FROM review_item WHERE session_id = $1)
      ORDER BY c.created_at`,
    [id]
  );
  const byItem = new Map<number, ReviewItem["comments"]>();
  for (const c of comments) {
    if (!byItem.has(c.review_item_id)) byItem.set(c.review_item_id, []);
    byItem.get(c.review_item_id)!.push({ id: c.id, author: c.author, body: c.body, createdAt: c.created_at });
  }
  const mapped: ReviewItem[] = items.map((i) => ({
    id: i.id, ord: i.ord, name: i.name, beforeUrl: i.before_url, afterUrl: i.after_url,
    optionText: i.option_text, decision: i.decision, signalId: i.signal_id,
    comments: byItem.get(i.id) ?? [],
  }));
  return {
    id: s.id, huddleId: s.huddle_id, title: s.title, status: s.status, createdBy: s.created_by, createdByName: s.created_by_name,
    items: mapped,
    progress: { done: mapped.filter((i) => i.decision === "done").length, total: mapped.length },
  };
}

export async function addReviewItem(sessionId: number, name: string): Promise<number> {
  const ord = await queryOne<{ n: number }>(
    `SELECT coalesce(max(ord) + 1, 0) AS n FROM review_item WHERE session_id = $1`,
    [sessionId]
  );
  const row = await queryOne<{ id: number }>(
    `INSERT INTO review_item (session_id, ord, name) VALUES ($1, $2, $3) RETURNING id`,
    [sessionId, ord!.n, name.slice(0, 200)]
  );
  return row!.id;
}

export async function deleteReviewItem(itemId: number) {
  await query(`DELETE FROM comment WHERE review_item_id = $1`, [itemId]);
  await query(`DELETE FROM review_item WHERE id = $1`, [itemId]);
}

/** 항목 필드 부분 수정 — 옵션·이미지는 전원, decision(확정 포함)은 라우트에서 lead 검증 */
export async function updateReviewItem(itemId: number, fields: { beforeUrl?: string | null; afterUrl?: string | null; optionText?: string; decision?: Decision }) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 1;
  if (fields.beforeUrl !== undefined) { sets.push(`before_url = $${n++}`); vals.push(fields.beforeUrl); }
  if (fields.afterUrl !== undefined) { sets.push(`after_url = $${n++}`); vals.push(fields.afterUrl); }
  if (fields.optionText !== undefined) { sets.push(`option_text = $${n++}`); vals.push(fields.optionText.slice(0, 500)); }
  if (fields.decision !== undefined) { sets.push(`decision = $${n++}`); vals.push(fields.decision); }
  if (!sets.length) return;
  vals.push(itemId);
  await query(`UPDATE review_item SET ${sets.join(", ")} WHERE id = $${n}`, vals);
}

export async function addItemComment(itemId: number, authorId: number, body: string): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO comment (review_item_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
    [itemId, authorId, body.slice(0, 4000)]
  );
  return row!.id;
}

/** 확정 항목 → 논의·결정(signal) 레코드 자동 생성. 제목=항목명, 근거=코멘트 요약, 링크=세션. */
export async function promoteItemToSignal(itemId: number, authorId: number): Promise<number> {
  const item = await queryOne<{ id: number; session_id: number; name: string; option_text: string; signal_id: number | null }>(
    `SELECT id, session_id, name, option_text, signal_id FROM review_item WHERE id = $1`,
    [itemId]
  );
  if (!item) throw new Error("항목을 찾을 수 없습니다.");
  if (item.signal_id) return item.signal_id; // 이미 생성됨 (중복 방지)

  const comments = await query<{ author: string; body: string }>(
    `SELECT a.display_name AS author, c.body FROM comment c JOIN actor a ON a.id = c.author_id
      WHERE c.review_item_id = $1 ORDER BY c.created_at`,
    [itemId]
  );
  const summary = comments.map((c) => `· ${c.author}: ${c.body}`).join("\n").slice(0, 3000);
  const body =
    `[리뷰 세션 확정] ${item.name}\n` +
    (item.option_text ? `선정 옵션: ${item.option_text}\n` : "") +
    (summary ? `\n코멘트 요약:\n${summary}\n` : "") +
    `\n출처: 리뷰 세션 #${item.session_id}`;

  const signal = await queryOne<{ id: number }>(
    `INSERT INTO signal (type, scope, title, body, author_id, status, decided_at)
     VALUES ('decision', 'team', $1, $2, $3, 'decided', now()) RETURNING id`,
    [`결정: ${item.name}`.slice(0, 200), body, authorId]
  );
  await query(`UPDATE review_item SET signal_id = $1, decision = 'done' WHERE id = $2`, [signal!.id, itemId]);
  return signal!.id;
}
