// 이모지 리액션 조회 헬퍼 (서버) — 스레드·피드에서 대상별 요약을 재사용.
import { query } from "@/lib/db";

// 허용 이모지(간단 팔레트) — 임의 문자열 저장 방지.
export const REACTION_EMOJIS = ["👍", "🎉", "👀", "❤️", "🙌", "🤔", "✅", "🔥"];

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

/** 대상들의 리액션 요약을 한 번에 → Map<target_id, summary[]>. */
export async function reactionsFor(
  targetType: string,
  ids: number[],
  viewerId: number
): Promise<Map<number, ReactionSummary[]>> {
  const map = new Map<number, ReactionSummary[]>();
  if (ids.length === 0) return map;
  const rows = await query<{ target_id: number; emoji: string; count: number; mine: boolean }>(
    `SELECT target_id, emoji, COUNT(*)::int AS count,
            bool_or(user_id = $2) AS mine
     FROM reaction
     WHERE target_type = $1 AND target_id = ANY($3::int[])
     GROUP BY target_id, emoji
     ORDER BY MIN(created_at)`,
    [targetType, viewerId, ids]
  );
  for (const r of rows) {
    const arr = map.get(r.target_id) ?? [];
    arr.push({ emoji: r.emoji, count: Number(r.count), mine: r.mine });
    map.set(r.target_id, arr);
  }
  return map;
}
