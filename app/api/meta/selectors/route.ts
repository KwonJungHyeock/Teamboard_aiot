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
    const session = requireSession();
    const [actors, projects, monthGoals, areas, myAreas] = await Promise.all([
      query<{ id: number; display_name: string }>(
        `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
      ),
      // 프로젝트에 area_id 포함 — 폼에서 "선택한 영역의 하위" 프로젝트만 노출하기 위함
      query<{ id: number; name: string; color_key: string | null; area_id: number }>(
        `SELECT id, name, color_key, area_id FROM project WHERE is_active = true ORDER BY id`
      ),
      query<{ id: number; title: string; period_start: string }>(
        `SELECT id, title, period_start::text FROM goal
         WHERE is_active = true AND period_type = 'month'
         ORDER BY period_start DESC, id LIMIT 100`
      ),
      // 업무·목표 선택지 — workspace 만 (link_only·비활성 제외, 파트 0)
      query<{ id: number; name: string; color_key: string | null }>(
        `SELECT id, name, color_key FROM area WHERE is_active = true AND kind = 'workspace' ORDER BY sort_order, id`
      ),
      // 내 기본 영역 (폼 기본값·"내 업무" 영역 필터) — sort_order 순
      query<{ area_id: number }>(
        `SELECT area_id FROM actor_area WHERE actor_id = $1 ORDER BY sort_order, area_id`,
        [session.id]
      ),
    ]);
    return NextResponse.json({
      actors: actors.map((a) => ({ id: a.id, name: a.display_name })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, colorKey: p.color_key, areaId: p.area_id })),
      monthGoals: monthGoals.map((g) => ({ id: g.id, title: g.title, month: g.period_start.slice(0, 7) })),
      areas: areas.map((a) => ({ id: a.id, name: a.name, colorKey: a.color_key })),
      myAreaIds: myAreas.map((r) => r.area_id),
    });
  } catch (error) {
    return jsonError(error);
  }
}
