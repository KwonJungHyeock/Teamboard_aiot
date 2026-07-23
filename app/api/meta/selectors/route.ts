// 셀렉트 룩업 (Phase 6 도입, Phase 8 D-3에서 /api/tasks 룩업 흡수) —
// 화면 드롭다운용 담당·프로젝트·월 목표 목록. 목록 데이터와 분리해 페이로드 오염 방지.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireSession();
    const [actors, projects, monthGoals] = await Promise.all([
      query<{ id: number; display_name: string }>(
        `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
      ),
      query<{ id: number; name: string; color_key: string | null }>(
        `SELECT id, name, color_key FROM project WHERE is_active = true ORDER BY id`
      ),
      query<{ id: number; title: string; period_start: string }>(
        `SELECT id, title, period_start::text FROM goal
         WHERE is_active = true AND period_type = 'month'
         ORDER BY period_start DESC, id LIMIT 100`
      ),
    ]);
    return NextResponse.json({
      actors: actors.map((a) => ({ id: a.id, name: a.display_name })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, colorKey: p.color_key })),
      monthGoals: monthGoals.map((g) => ({ id: g.id, title: g.title, month: g.period_start.slice(0, 7) })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
