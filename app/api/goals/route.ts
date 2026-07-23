// 목표 API (Phase 4) — GET: 트리+진척(lib/goals.ts 단일 소스), POST: 생성(lead)
import { NextResponse } from "next/server";
import { requireLead, requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getGoalTree } from "@/lib/goals";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const yearParam = url.searchParams.get("year");
    const year = yearParam ? Number(yearParam) : undefined;
    const tree = await getGoalTree(Number.isFinite(year) ? year : undefined);

    // 월 목표의 Task 연결 편집용 — 활성 업무 목록 (Phase 5의 /api/tasks 전까지 최소 제공)
    const linkableTasks = await query<{
      id: number;
      title: string;
      status: string;
      assignee_name: string | null;
    }>(
      `SELECT t.id, t.title, t.status, a.display_name AS assignee_name
       FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active = true AND t.status <> 'dropped'
       ORDER BY t.created_at DESC LIMIT 200`
    );
    return NextResponse.json({ tree, linkableTasks });
  } catch (error) {
    return jsonError(error);
  }
}

const PERIOD_TYPES = ["year", "quarter", "month"] as const;

export async function POST(request: Request) {
  try {
    const session = requireLead(); // 목표 생성은 lead (SPEC 6장)
    const payload = await request.json();

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
      const parent = await queryOne<{ period_type: string }>(
        "SELECT period_type FROM goal WHERE id = $1 AND is_active = true",
        [parentId]
      );
      const expected = periodType === "quarter" ? "year" : periodType === "month" ? "quarter" : null;
      if (!parent || parent.period_type !== expected) {
        return NextResponse.json({ error: "상위 목표가 올바르지 않습니다." }, { status: 400 });
      }
    }

    const goal = await queryOne(
      `INSERT INTO goal (parent_id, period_type, period_start, period_end, title, description,
                         target_metric, target_value, progress_mode, owner_actor_id, project_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
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
        payload.ownerActorId ? Number(payload.ownerActorId) : session.id,
        payload.projectId ? Number(payload.projectId) : null,
      ]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) ${periodType === "year" ? "연간" : periodType === "quarter" ? "분기" : "월"} 목표 생성 — "${title}"`,
    });
    return NextResponse.json({ goal });
  } catch (error) {
    return jsonError(error);
  }
}
