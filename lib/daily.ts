// 하루 한 줄 · 상태 — 서버 쪽 (0039_daily_note.sql).
//
// 팀 공개다(관제 「지금 팀」). 고치는 것은 본인 행뿐 — 함수가 받는 `actorId` 가 곧 주인이다.
import { query } from "./db";
import { kstToday } from "./home";

export type DailyState = "focus" | "out" | "off";
export const DAILY_STATES: { key: DailyState; label: string }[] = [
  { key: "focus", label: "집중" },
  { key: "out", label: "외근" },
  { key: "off", label: "휴가" },
];
export interface DailyNote { line: string | null; state: DailyState | null }

export class DailyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** 오늘(서울) 모두의 한 줄 · 상태 — 사람 id → 값 */
export async function todayNotes(): Promise<Map<number, DailyNote>> {
  const rows = await query<{ actor_id: number; line: string | null; state: DailyState | null }>(
    `SELECT actor_id, line, state FROM daily_note WHERE day = $1::date`, [kstToday()]
  );
  return new Map(rows.map((r) => [r.actor_id, { line: r.line, state: r.state }]));
}

/**
 * 내 오늘 줄을 고친다. 보낸 칸만 바꾼다 — 한 줄만 보내면 상태는 그대로.
 * 빈 글자 · `null` 은 그 칸을 비운다.
 */
export async function setMyDay(actorId: number, input: { line?: unknown; state?: unknown }): Promise<DailyNote> {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);
  if (!has("line") && !has("state")) throw new DailyError("바꿀 것이 없습니다.");
  let line: string | null | undefined;
  if (has("line")) {
    const s = input.line == null ? "" : String(input.line).replace(/\s+/g, " ").trim();
    if (s.length > 200) throw new DailyError("한 줄은 200자까지입니다.");
    line = s || null;
  }
  let state: DailyState | null | undefined;
  if (has("state")) {
    if (input.state == null || input.state === "") state = null;
    else if (DAILY_STATES.some((d) => d.key === input.state)) state = input.state as DailyState;
    else throw new DailyError("상태가 올바르지 않습니다.");
  }
  const rows = await query<{ line: string | null; state: DailyState | null }>(
    `INSERT INTO daily_note (actor_id, day, line, state)
     VALUES ($1, $2::date, $3, $4)
     ON CONFLICT (actor_id, day) DO UPDATE SET
       line  = CASE WHEN $5 THEN EXCLUDED.line  ELSE daily_note.line  END,
       state = CASE WHEN $6 THEN EXCLUDED.state ELSE daily_note.state END,
       updated_at = now()
     RETURNING line, state`,
    [actorId, kstToday(), line ?? null, state ?? null, line !== undefined, state !== undefined]
  );
  return rows[0];
}
