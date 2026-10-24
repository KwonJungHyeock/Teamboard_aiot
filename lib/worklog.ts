// 업무기록 — 서버 쪽 (0037_work_log.sql).
//
// ── 모든 쿼리에 `owner_actor_id = $viewer` 가 붙는다 ──────────────
//
// 개인 메모(`app/api/notes`)와 같은 규칙이다. 팀장도 예외가 아니다. 이 파일에는
// 소유자 없는 조회를 두지 않는다 — 빠뜨릴 자리를 안 만든다.
//
// ── 「#카테고리」는 서버가 읽는다 ────────────────────────────────
//
// 화면에서 `#학생페이지 예제 3/5` 라고 치면 카테고리가 고른 것처럼 붙는다. 이걸
// 화면에서만 하면 API 를 직접 부르는 길(다음 화면 · 회의록이 남기는 한 줄)에서는
// `#` 이 본문에 그대로 남는다. 그래서 **여기 한 곳**에서 한다.
import { query, queryOne } from "./db";

export interface WorklogFile {
  pathname: string;
  name: string;
  size: number;
  contentType: string;
}

export interface WorklogEntry {
  id: number;
  loggedOn: string;          // YYYY-MM-DD
  body: string;
  categoryId: number | null;
  taskId: number | null;
  attachments: WorklogFile[];
  createdAt: string;
}

export interface WorklogCategory {
  id: number;
  name: string;
  color: string;
  /** 고른 달의 기록 수 */
  count: number;
}

/** 새 카테고리에 차례로 돌려 주는 색 — 공간 모드(예시안 D)의 영역 색과 같은 결 */
export const CATEGORY_COLORS = ["#2348B8", "#0E6E63", "#A22767", "#C77B0A", "#5B3FC0", "#9A4A12", "#1F8A55", "#3E4A60"];

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** 줄 처음이나 띄어쓰기 뒤의 `#이름` — 이름은 띄어쓰기·# 없이 30자까지 */
const TAG_RE = /(^|\s)#([^\s#]{1,30})/;

export class WorklogInputError extends Error {}

/** 오늘(서울) — `YYYY-MM` */
export function thisMonth(now = new Date()): string {
  const k = new Date(now.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function parseMonth(v: string | null | undefined): string {
  if (v && MONTH_RE.test(v)) return v;
  return thisMonth();
}

/**
 * 본문에서 첫 `#이름` 을 떼어 낸다. 본문이 태그 하나뿐이면 태그를 남긴다 —
 * 떼고 나면 빈 기록이 되기 때문이다.
 */
export function splitTag(body: string): { body: string; tag: string | null } {
  const m = TAG_RE.exec(body);
  if (!m) return { body: body.trim(), tag: null };
  const rest = (body.slice(0, m.index) + m[1] + body.slice(m.index + m[0].length)).replace(/\s{2,}/g, " ").trim();
  if (!rest) return { body: body.trim(), tag: null };
  return { body: rest, tag: m[2] };
}

/** 첨부는 **제 폴더의 것만** 받는다. 남의 pathname 을 붙여 읽는 길을 막는다. */
export function normalizeFiles(raw: unknown, ownerId: number): WorklogFile[] {
  if (!Array.isArray(raw)) return [];
  const prefix = `worklog/${ownerId}/`;
  const out: WorklogFile[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const pathname = String(o.pathname ?? "");
    if (!pathname.startsWith(prefix) || pathname.includes("..")) continue;
    out.push({
      pathname,
      name: String(o.name ?? "file").slice(0, 120),
      size: Math.max(0, Number(o.size) || 0),
      contentType: String(o.contentType ?? "application/octet-stream").slice(0, 120),
    });
    if (out.length >= 10) break;
  }
  return out;
}

type Row = {
  id: number; logged_on: string; body: string; category_id: number | null;
  task_id: number | null; attachments: WorklogFile[]; created_at: string;
};
const toEntry = (r: Row): WorklogEntry => ({
  id: r.id, loggedOn: r.logged_on, body: r.body, categoryId: r.category_id,
  taskId: r.task_id, attachments: r.attachments ?? [], createdAt: r.created_at,
});
const COLS = `id, logged_on::text, body, category_id, task_id, attachments, created_at::text`;

export async function listMonth(ownerId: number, month: string): Promise<{
  entries: WorklogEntry[]; categories: WorklogCategory[];
}> {
  const from = `${month}-01`;
  const rows = await query<Row>(
    `SELECT ${COLS} FROM work_log
      WHERE owner_actor_id = $1 AND is_active
        AND logged_on >= $2::date AND logged_on < ($2::date + interval '1 month')
      ORDER BY logged_on DESC, id DESC
      LIMIT 1000`,
    [ownerId, from]
  );
  const cats = await query<{ id: number; name: string; color: string; count: string }>(
    `SELECT c.id, c.name, c.color,
            (SELECT count(*) FROM work_log w
              WHERE w.category_id = c.id AND w.owner_actor_id = $1 AND w.is_active
                AND w.logged_on >= $2::date AND w.logged_on < ($2::date + interval '1 month')) AS count
       FROM work_log_category c
      WHERE c.owner_actor_id = $1 AND c.is_active
      ORDER BY c.sort, c.id`,
    [ownerId, from]
  );
  return {
    entries: rows.map(toEntry),
    categories: cats.map((c) => ({ id: c.id, name: c.name, color: c.color, count: Number(c.count) })),
  };
}

/** 이름으로 찾고, 없으면 만든다. 같은 이름(대소문자·앞뒤 공백 무시)은 하나다. */
export async function ensureCategory(ownerId: number, rawName: string): Promise<{ id: number; name: string; color: string }> {
  const name = rawName.trim().slice(0, 30);
  if (!name) throw new WorklogInputError("카테고리 이름이 비었습니다.");
  const found = await queryOne<{ id: number; name: string; color: string }>(
    `SELECT id, name, color FROM work_log_category
      WHERE owner_actor_id = $1 AND is_active AND lower(btrim(name)) = lower(btrim($2))`,
    [ownerId, name]
  );
  if (found) return found;
  const n = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM work_log_category WHERE owner_actor_id = $1`, [ownerId]
  );
  const color = CATEGORY_COLORS[Number(n?.n ?? 0) % CATEGORY_COLORS.length];
  // 둘이 동시에 같은 이름을 만들면 유일 색인이 하나를 막는다 — 그때는 이긴 쪽을 다시 읽는다.
  const made = await queryOne<{ id: number; name: string; color: string }>(
    `INSERT INTO work_log_category (owner_actor_id, name, color, sort)
     VALUES ($1, $2, $3, (SELECT coalesce(max(sort), 0) + 1 FROM work_log_category WHERE owner_actor_id = $1))
     ON CONFLICT DO NOTHING
     RETURNING id, name, color`,
    [ownerId, name, color]
  );
  if (made) return made;
  const again = await queryOne<{ id: number; name: string; color: string }>(
    `SELECT id, name, color FROM work_log_category
      WHERE owner_actor_id = $1 AND is_active AND lower(btrim(name)) = lower(btrim($2))`,
    [ownerId, name]
  );
  if (!again) throw new WorklogInputError("카테고리를 만들지 못했습니다.");
  return again;
}

async function ownCategory(ownerId: number, id: unknown): Promise<number | null> {
  if (id === null || id === undefined || id === "") return null;
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) throw new WorklogInputError("카테고리가 올바르지 않습니다.");
  const row = await queryOne<{ id: number }>(
    `SELECT id FROM work_log_category WHERE id = $1 AND owner_actor_id = $2 AND is_active`, [n, ownerId]
  );
  if (!row) throw new WorklogInputError("내 카테고리가 아닙니다.");
  return row.id;
}

function day(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v);
  if (!DAY_RE.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new WorklogInputError("날짜가 올바르지 않습니다.");
  return s;
}

export interface WorklogInput {
  body?: unknown;
  categoryId?: unknown;
  loggedOn?: unknown;
  attachments?: unknown;
}

export async function createEntry(ownerId: number, input: WorklogInput): Promise<WorklogEntry> {
  const raw = String(input.body ?? "").slice(0, 2000);
  const files = normalizeFiles(input.attachments, ownerId);
  let { body, tag } = splitTag(raw);
  // 파일만 올리고 글을 안 쓴 경우 — 파일 이름을 한 줄로 쓴다. 비워서 막으면 다시 적어야 한다.
  if (!body && files.length) body = files.map((f) => f.name).join(", ").slice(0, 2000);
  if (!body) throw new WorklogInputError("기록할 내용이 비었습니다.");
  let categoryId = await ownCategory(ownerId, input.categoryId);
  if (tag) categoryId = (await ensureCategory(ownerId, tag)).id;
  const loggedOn = day(input.loggedOn);
  const row = await queryOne<Row>(
    `INSERT INTO work_log (owner_actor_id, body, category_id, attachments, logged_on)
     VALUES ($1, $2, $3, $4::jsonb, coalesce($5::date, (now() AT TIME ZONE 'Asia/Seoul')::date))
     RETURNING ${COLS}`,
    [ownerId, body, categoryId, JSON.stringify(files), loggedOn]
  );
  return toEntry(row!);
}

export async function updateEntry(ownerId: number, id: number, input: WorklogInput): Promise<WorklogEntry | null> {
  const sets: string[] = [];
  const vals: unknown[] = [id, ownerId];
  const put = (sql: string, v: unknown) => { vals.push(v); sets.push(sql.replace("?", `$${vals.length}`)); };
  if (input.body !== undefined) {
    const { body, tag } = splitTag(String(input.body ?? "").slice(0, 2000));
    if (!body) throw new WorklogInputError("기록할 내용이 비었습니다.");
    put("body = ?", body);
    if (tag) put("category_id = ?", (await ensureCategory(ownerId, tag)).id);
  }
  if (input.categoryId !== undefined && !sets.some((s) => s.startsWith("category_id"))) {
    put("category_id = ?", await ownCategory(ownerId, input.categoryId));
  }
  if (input.loggedOn !== undefined) {
    const d = day(input.loggedOn);
    if (!d) throw new WorklogInputError("날짜가 비었습니다.");
    put("logged_on = ?::date", d);
  }
  if (input.attachments !== undefined) put("attachments = ?::jsonb", JSON.stringify(normalizeFiles(input.attachments, ownerId)));
  if (sets.length === 0) throw new WorklogInputError("바꿀 것이 없습니다.");
  const row = await queryOne<Row>(
    `UPDATE work_log SET ${sets.join(", ")}, updated_at = now()
      WHERE id = $1 AND owner_actor_id = $2 AND is_active
      RETURNING ${COLS}`,
    vals
  );
  return row ? toEntry(row) : null;
}

/** 지우면 숨긴다 — 첨부 파일은 남는다(되살릴 수 있게). */
export async function deleteEntry(ownerId: number, id: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE work_log SET is_active = false, updated_at = now()
      WHERE id = $1 AND owner_actor_id = $2 AND is_active RETURNING id`,
    [id, ownerId]
  );
  return !!row;
}

export async function renameCategory(ownerId: number, id: number, input: { name?: unknown; color?: unknown }): Promise<boolean> {
  const sets: string[] = [];
  const vals: unknown[] = [id, ownerId];
  if (input.name !== undefined) {
    const name = String(input.name ?? "").trim().slice(0, 30);
    if (!name) throw new WorklogInputError("카테고리 이름이 비었습니다.");
    vals.push(name); sets.push(`name = $${vals.length}`);
  }
  if (input.color !== undefined) {
    const color = String(input.color ?? "");
    if (!CATEGORY_COLORS.includes(color)) throw new WorklogInputError("고를 수 있는 색이 아닙니다.");
    vals.push(color); sets.push(`color = $${vals.length}`);
  }
  if (sets.length === 0) throw new WorklogInputError("바꿀 것이 없습니다.");
  try {
    const row = await queryOne<{ id: number }>(
      `UPDATE work_log_category SET ${sets.join(", ")}
        WHERE id = $1 AND owner_actor_id = $2 AND is_active RETURNING id`,
      vals
    );
    return !!row;
  } catch (e) {
    if ((e as { code?: string }).code === "23505") throw new WorklogInputError("같은 이름의 카테고리가 이미 있습니다.");
    throw e;
  }
}

/**
 * 카테고리를 지우면 **숨긴다.** 그 카테고리로 적은 기록은 「분류 없음」이 된다 —
 * 기록이 같이 사라지면 한 달 치가 날아간다.
 */
export async function hideCategory(ownerId: number, id: number): Promise<boolean> {
  const row = await queryOne<{ id: number }>(
    `UPDATE work_log_category SET is_active = false
      WHERE id = $1 AND owner_actor_id = $2 AND is_active RETURNING id`,
    [id, ownerId]
  );
  if (!row) return false;
  await query(
    `UPDATE work_log SET category_id = NULL, updated_at = now()
      WHERE category_id = $1 AND owner_actor_id = $2`,
    [id, ownerId]
  );
  return true;
}

/**
 * 그 달에 **내가 끝낸 업무** — 업무일지 스트림 · 월간 보고 재료에 「완료」 줄로 함께 보인다(2026-10 리디자인).
 * work_log 에 따로 적지 않는다(읽을 때 합친다). 카테고리는 업무의 영역(area) 이름.
 */
export interface DoneTask { id: number; title: string; areaName: string; completedAt: string; loggedOn: string }
export async function doneTasksOfMonth(ownerId: number, month: string): Promise<DoneTask[]> {
  const rows = await query<{ id: number; title: string; area_name: string; completed_at: string; day: string }>(
    `SELECT t.id, t.title, ar.name AS area_name, t.completed_at::text,
            (t.completed_at AT TIME ZONE 'Asia/Seoul')::date::text AS day
       FROM task t JOIN area ar ON ar.id = t.area_id
      WHERE t.is_active AND t.assignee_id = $1 AND t.status = 'done' AND t.completed_at IS NOT NULL
        AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date
        AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date < ($2::date + interval '1 month')
      ORDER BY t.completed_at DESC LIMIT 300`,
    [ownerId, `${month}-01`]
  );
  return rows.map((r) => ({ id: r.id, title: r.title, areaName: r.area_name, completedAt: r.completed_at, loggedOn: r.day }));
}
