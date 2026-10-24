// 등록창 · 드로어가 고르는 목록 — 사람 · 카테고리(area) · 목표(활성). 화면마다 따로 묻지 않는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = requireSession();
    const [people, areas, goals] = await Promise.all([
      query<{ id: number; name: string }>(`SELECT id, display_name AS name FROM actor WHERE type = 'human' AND is_active ORDER BY id`),
      query<{ id: number; name: string }>(`SELECT id, name FROM area WHERE is_active ORDER BY sort_order, id`),
      query<{ id: number; title: string; period_type: string; parent_id: number | null; period_end: string }>(
        `SELECT id, title, period_type, parent_id, period_end::text FROM goal
          WHERE is_active AND (scope = 'team' OR owner_actor_id = $1) AND period_end >= (now() AT TIME ZONE 'Asia/Seoul')::date - 31
          ORDER BY CASE period_type WHEN 'year' THEN 0 WHEN 'quarter' THEN 1 ELSE 2 END, period_start, id`, [s.id]),
    ]);
    return NextResponse.json({
      me: { id: s.id, name: s.name },
      people, areas,
      goals: goals.map((g) => ({ id: g.id, title: g.title, periodType: g.period_type, parentId: g.parent_id })),
    });
  } catch (error) { return jsonError(error); }
}
