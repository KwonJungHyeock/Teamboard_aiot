// 목표 API (Phase 4 → 파트 A/B) — GET: 트리+진척(lib/goals.ts 단일 소스),
// POST: 팀 목표(lead) / 개인 목표(본인) 생성.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getGoalTree, recomputeGoalChain } from "@/lib/goals";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : undefined;
    const scopeParam = url.searchParams.get("scope");
    const scope = scopeParam === "team" || scopeParam === "personal" ? scopeParam : undefined;

    // 보관함 조회 (평면 목록)
    if (url.searchParams.get("archived") === "1") {
      const archived = await query<{
        id: number;
        title: string;
        period_type: string;
        period_start: string;
      }>(
        `SELECT id, title, period_type, period_start::text FROM goal
         WHERE is_active = false ${year ? `AND EXTRACT(YEAR FROM period_start) = ${Number(year)}` : ""}
         ORDER BY period_start, id`
      );
      return NextResponse.json({ archived });
    }

    const tree = await getGoalTree({
      year: Number.isFinite(year) ? year : undefined,
      scope, viewerId: session.id, isLead: session.role === "lead",
    });

    // §B3 일괄 연결 배너 — 아직 어떤 목표에도 붙지 않은 프로젝트
    const unlinked = await query<{ id: number; name: string; color_key: string | null; status: string }>(
      `SELECT id, name, color_key, status FROM project
        WHERE is_active = true AND status <> 'archived' AND goal_id IS NULL
        ORDER BY name`
    );

    // 월 목표의 Task 연결 편집용 — 활성 업무 목록 (Phase 5의 /api/tasks 전까지 최소 제공)
    const linkableTasks = await query<{
      id: number;
      title: string;
      status: string;
      assignee_name: string | null;
    }>(
      `SELECT t.id, t.title, t.status, a.display_name AS assignee_name
       FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active = true AND t.status NOT IN ('dropped', 'proposed')
       ORDER BY t.created_at DESC LIMIT 200`
    );
    return NextResponse.json({ tree, linkableTasks, unlinkedProjects: unlinked });
  } catch (error) {
    return jsonError(error);
  }
}

const PERIOD_TYPES = ["year", "quarter", "month"] as const;

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();
    // 스코프: team=팀 목표(lead만 생성) / personal=개인 목표(본인만, owner=자기 강제)
    const scope = payload.scope === "personal" ? "personal" : "team";
    if (scope === "team" && session.role !== "lead") {
      return NextResponse.json({ error: "팀 목표는 팀장만 생성할 수 있습니다." }, { status: 403 });
    }

    const periodType = payload.periodType as string;
    if (!PERIOD_TYPES.includes(periodType as any)) {
      return NextResponse.json({ error: "period_type이 올바르지 않습니다." }, { status: 400 });
    }
    const title = String(payload.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    const periodStart = String(payload.periodStart ?? "");
    const periodEnd = String(payload.periodEnd ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd)) {
      return NextResponse.json({ error: "기간(YYYY-MM-DD)이 필요합니다." }, { status: 400 });
    }
    const parentId = payload.parentId ? Number(payload.parentId) : null;
    if (parentId) {
      const parent = await queryOne<{ period_type: string; scope: string; owner_actor_id: number | null }>(
        "SELECT period_type, scope, owner_actor_id FROM goal WHERE id = $1 AND is_active = true",
        [parentId]
      );
      const expected = periodType === "quarter" ? "year" : periodType === "month" ? "quarter" : null;
      if (!parent || parent.period_type !== expected) {
        return NextResponse.json({ error: "상위 목표가 올바르지 않습니다." }, { status: 400 });
      }
      // 상위와 스코프 일치 (개인 목표는 본인 소유 상위에만)
      if (parent.scope !== scope || (scope === "personal" && parent.owner_actor_id !== session.id)) {
        return NextResponse.json({ error: "상위 목표의 스코프가 일치하지 않습니다." }, { status: 400 });
      }
    }

    // 개인 목표는 owner=자기 강제. 팀 목표는 owner=null(전원 공유), area_id 연결 가능.
    const ownerActorId = scope === "personal" ? session.id : null;
    const areaId = scope === "team" && payload.areaId ? Number(payload.areaId) : null;

    const goal = await queryOne<{ id: number }>(
      `INSERT INTO goal (parent_id, period_type, period_start, period_end, title, description,
                         target_metric, target_value, progress_mode, owner_actor_id, project_id, scope, area_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [
        parentId,
        periodType,
        periodStart,
        periodEnd,
        title,
        String(payload.description ?? "").slice(0, 2000),
        payload.targetMetric ? String(payload.targetMetric).slice(0, 100) : null,
        payload.targetValue != null && payload.targetValue !== "" ? Number(payload.targetValue) : null,
        payload.progressMode === "manual" ? "manual" : "auto",
        ownerActorId,
        payload.projectId ? Number(payload.projectId) : null,
        scope,
        areaId,
      ]
    );
    // 진척 초기화(연결 없으면 null) + 상위 체인 재계산 (파트 B)
    if (goal) await recomputeGoalChain(goal.id);
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) ${scope === "personal" ? "개인 " : "팀 "}${periodType === "year" ? "연간" : periodType === "quarter" ? "분기" : "월"} 목표 생성 — "${title}"`,
    });
    return NextResponse.json({ goal });
  } catch (error) {
    return jsonError(error);
  }
}
