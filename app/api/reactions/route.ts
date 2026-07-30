// 이모지 리액션 토글 (협업) — 답글/시그널/업무/활동에 붙는다.
// (사용자·대상·이모지) 유일 → 있으면 제거, 없으면 추가. 응답은 그 대상의 최신 요약.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { reactionsFor, REACTION_EMOJIS } from "@/lib/reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TARGETS = ["reply", "signal", "task", "activity"] as const;
const EMOJIS = REACTION_EMOJIS;

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();
    const targetType = String(payload.targetType ?? "");
    const targetId = Number(payload.targetId);
    const emoji = String(payload.emoji ?? "");
    if (!(TARGETS as readonly string[]).includes(targetType) || !Number.isInteger(targetId)) {
      return NextResponse.json({ error: "잘못된 대상입니다." }, { status: 400 });
    }
    if (!EMOJIS.includes(emoji)) {
      return NextResponse.json({ error: "지원하지 않는 이모지입니다." }, { status: 400 });
    }
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM reaction WHERE user_id = $1 AND target_type = $2 AND target_id = $3 AND emoji = $4`,
      [session.id, targetType, targetId, emoji]
    );
    if (existing) {
      await query(`DELETE FROM reaction WHERE id = $1`, [existing.id]);
    } else {
      await query(
        `INSERT INTO reaction (target_type, target_id, emoji, user_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT DO NOTHING`,
        [targetType, targetId, emoji, session.id]
      );
    }
    const summary = (await reactionsFor(targetType, [targetId], session.id)).get(targetId) ?? [];
    return NextResponse.json({ reactions: summary });
  } catch (error) {
    return jsonError(error);
  }
}
