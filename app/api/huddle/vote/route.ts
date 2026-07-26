// 허들룸 투표 (파트 D) — 허들(signal) 또는 코멘트에 👍/👎. 1인 1표 토글.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const { targetType, targetId, vote } = await request.json();
    if (!["huddle", "comment"].includes(targetType) || !["up", "down"].includes(vote)) {
      return NextResponse.json({ error: "잘못된 투표 요청" }, { status: 400 });
    }
    const id = Number(targetId);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "대상이 올바르지 않습니다." }, { status: 400 });

    const existing = await queryOne<{ vote: string }>(
      `SELECT vote FROM huddle_vote WHERE target_type = $1 AND target_id = $2 AND actor_id = $3`,
      [targetType, id, session.id]
    );
    if (!existing) {
      await query(
        `INSERT INTO huddle_vote (target_type, target_id, actor_id, vote) VALUES ($1,$2,$3,$4)`,
        [targetType, id, session.id, vote]
      );
    } else if (existing.vote === vote) {
      // 같은 표 재클릭 → 취소
      await query(
        `DELETE FROM huddle_vote WHERE target_type = $1 AND target_id = $2 AND actor_id = $3`,
        [targetType, id, session.id]
      );
    } else {
      await query(
        `UPDATE huddle_vote SET vote = $4, created_at = now() WHERE target_type = $1 AND target_id = $2 AND actor_id = $3`,
        [targetType, id, session.id, vote]
      );
    }

    const counts = await queryOne<{ up: number; down: number; mine: string | null }>(
      `SELECT count(*) FILTER (WHERE vote = 'up')::int AS up,
              count(*) FILTER (WHERE vote = 'down')::int AS down,
              max(vote) FILTER (WHERE actor_id = $3) AS mine
       FROM huddle_vote WHERE target_type = $1 AND target_id = $2`,
      [targetType, id, session.id]
    );
    return NextResponse.json({ up: counts?.up ?? 0, down: counts?.down ?? 0, mine: counts?.mine ?? null });
  } catch (error) {
    return jsonError(error);
  }
}
