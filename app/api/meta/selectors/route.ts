// 셀렉트 룩업 (Phase 6 도입, Phase 8 D-3에서 /api/tasks 룩업 흡수) —
// 화면 드롭다운용 담당·프로젝트·월 목표 목록. 목록 데이터와 분리해 페이로드 오염 방지.
import { NextResponse } from "next/server";
import { kstTodayForGoals } from "@/lib/goals";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const [actors, projects, monthGoals, linkGoals, areas, myAreas] = await Promise.all([
      query<{ id: number; display_name: string }>(
        `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
      ),
      // 프로젝트에 area_id 포함 — 폼에서 "선택한 영역의 하위" 프로젝트만 노출하기 위함
      query<{ id: number; name: string; color_key: string | null; area_id: number }>(
        `SELECT id, name, color_key, area_id FROM project WHERE is_active = true ORDER BY id`
      ),
      /**
       * 업무의 목표 후보 (MD-P-2026-024 회신 6 지시 20-1 · **§C3 회신 §1 에서 층 확대**).
       *
       * ── 왜 넓혔는가 ────────────────────────────────────────────
       * 월 목표만 후보였다. 그래서 Q3 목표 셋(`관리자 페이지` · `2차 PoC` · `Beta Open`)이
       * 전부 「집계 없음」이었고, 새 업무에서 `+ 목표 연결` 을 누르면
       * 「연결 가능한 월 목표가 없습니다」가 떴다. **스키마 문제가 아니라 이 한 줄이었다.**
       *
       * ── 연간을 빼는 이유 ───────────────────────────────────────
       * 연간에 업무를 직접 붙이면 그 아래 분기 목표들이 **영원히 비고 계층이 죽는다.**
       * 그래서 후보는 **분기 · 월** 둘뿐이다.
       *
       * ── 기간 필터를 안 거는 이유 ──────────────────────────────
       * 지난 분기·지난 달 목표도 후보에 남긴다. **완료한 업무를 소급 연결하면
       * 실적으로 집계되어야 한다.** 지금 기간으로 자르면 그 길이 아예 없다.
       * 대신 화면이 `지난 기간` 이라고 적고 회색으로 내린다 — 거르는 대신 **말한다.**
       *
       * ── 지난 것과 아직 안 온 것은 다르다 ──────────────────────
       * 처음엔 `현재 기간이 아니다` 를 그대로 `past` 로 썼다. 그러면 **다음 분기
       * 계획 목표에 「지난 기간」이라고 적힌다.** 검사기 §1E 가 `Q4 현장 적용 확대(계획)`
       * 에 붙은 `지난 기간 · 2026-10` 을 그대로 옮겨 와서 드러났다.
       * 「현재가 아님」은 두 가지다. 서버가 셋으로 갈라서 준다.
       *
       * 정렬은 ①진행 중인 기간 먼저 ②최근에 실제로 쓴 목표 순.
       */
      query<{ id: number; title: string; period_start: string; period_when: "past" | "current" | "future"; period_type: string; period: string | null; current: boolean }>(
        `SELECT g.id, g.title, g.period_start::text, g.period_type, g.period,
                (g.period_start <= $1::date AND g.period_end >= $1::date) AS current,
                CASE WHEN g.period_end   < $1::date THEN 'past'
                     WHEN g.period_start > $1::date THEN 'future'
                     ELSE 'current' END AS period_when
           FROM goal g
          WHERE g.is_active = true AND g.period_type IN ('quarter', 'month')
          ORDER BY current DESC,
                   (SELECT max(t.updated_at) FROM goal_task gt
                      JOIN task t ON t.id = gt.task_id
                     WHERE gt.goal_id = g.id) DESC NULLS LAST,
                   g.period_start DESC, g.id
          LIMIT 100`,
        [kstTodayForGoals()]
      ),
      // 프로젝트 헤더 [목표 연결] 후보 (MD-P-2026-009 §B2) —
      // 연간·분기·월 전부. 개인 목표는 본인 것만 노출한다(남의 개인 목표에 팀 프로젝트를 붙일 수 없다).
      query<{ id: number; title: string; period_type: string; period: string | null; period_start: string; scope: string }>(
        `SELECT id, title, period_type, period, period_start::text, scope FROM goal
          WHERE is_active = true AND (scope = 'team' OR owner_actor_id = $1)
          ORDER BY period_type, period_start DESC, id LIMIT 120`,
        [session.id]
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
      /**
       * 이름을 `monthGoals` 에서 바꿨다 — **분기 목표가 들어오므로 옛 이름은 거짓말이 된다.**
       * `level` 은 화면이 「분기」/「월」 배지를 그리는 데 쓰고,
       * `when` 은 `지난 기간`·`다음 기간` 회색 표시에 쓴다.
       * **판정은 서버가 하고 화면은 그린다.**
       */
      linkableGoals: monthGoals.map((g) => ({
        id: g.id, title: g.title,
        level: g.period_type === "quarter" ? "분기" : "월",
        period: g.period ?? g.period_start.slice(0, 7),
        when: g.period_when,
      })),
      linkGoals: linkGoals.map((g) => ({
        id: g.id, title: g.title, scope: g.scope,
        level: g.period_type === "year" ? "연간" : g.period_type === "quarter" ? "분기" : "월",
        period: g.period ?? g.period_start.slice(0, 7),
      })),
      areas: areas.map((a) => ({ id: a.id, name: a.name, colorKey: a.color_key })),
      myAreaIds: myAreas.map((r) => r.area_id),
    });
  } catch (error) {
    return jsonError(error);
  }
}
