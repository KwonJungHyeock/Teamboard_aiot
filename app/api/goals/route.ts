// 목표 API (Phase 4 → 파트 A/B) — GET: 트리+진척(lib/goals.ts 단일 소스),
// POST: 팀 목표(lead) / 개인 목표(본인) 생성.
import { NextResponse } from "next/server";
import { countableSql } from "@/lib/progress";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getGoalTree, recomputeGoalChain, kstTodayForGoals, validateGoalParent } from "@/lib/goals";
import type { GoalPeriodType } from "@/lib/types";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { visibleTaskSql } from "@/lib/visibility";

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

    // 폴백 유지 — 프로젝트→목표 연결은 기본 경로가 아니다 (회신 6 [확정] 연결 모델)
    const unlinked = await query<{ id: number; name: string; color_key: string | null; status: string }>(
      `SELECT id, name, color_key, status FROM project
        WHERE is_active = true AND status <> 'archived' AND goal_id IS NULL
        ORDER BY name`
    );

    // 지시 21 — 목표에 안 붙은 업무. 이게 이 팀의 실제 문제다(프로젝트가 아니라).
    // 집계 대상 기준은 진척 정의와 같다. 여기 있는 업무는 어떤 목표에도 집계되지 않는다.
    const unlinkedTasks = await query<{
      id: number; title: string; status: string; progress: number;
      project_id: number | null; project_name: string | null;
      assignee_name: string | null; due_date: string | null; area_id: number;
    }>(
      `SELECT t.id, t.title, t.status, t.progress,
              t.project_id, p.name AS project_name,
              a.display_name AS assignee_name, t.due_date::text, t.area_id
         FROM task t
         LEFT JOIN project p ON p.id = t.project_id AND p.is_active = true
         LEFT JOIN actor   a ON a.id = t.assignee_id
        WHERE t.parent_task_id IS NULL AND ${countableSql("t")}
          AND t.goal_source <> 'none'   -- "목표 없음"은 미연결이 아니다 (지시 23-2)
          AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id)
          -- ⑧ 일괄 연결 화면 — 남의 개인 업무는 여기에도 오르지 않는다 (§A3).
          --    이 화면은 팀 월 목표에 붙이는 곳이라 **내 개인 업무도 뺀다**:
          --    개인 업무는 팀 목표에 붙일 수 없다(§B1). 붙일 수 없는 것을 목록에 두면
          --    누르는 순간 거부당한다.
          AND t.visibility = 'team'
        ORDER BY (t.project_id IS NULL), t.project_id, t.due_date NULLS LAST, t.id`
    );

    // 이번 달 월 목표 — 업무를 붙일 기본 후보 (지시 20-1)
    const monthGoals = await query<{ id: number; title: string; period_start: string }>(
      `SELECT id, title, period_start::text FROM goal
        WHERE is_active = true AND period_type = 'month' AND scope = 'team'
          AND period_start <= $1::date AND period_end >= $1::date
        ORDER BY id`,
      [kstTodayForGoals()]
    );

    // 월 목표의 Task 연결 편집용 — 활성 업무 목록 (Phase 5의 /api/tasks 전까지 최소 제공)
    const linkableTasks = await query<{
      id: number;
      title: string;
      status: string;
      assignee_name: string | null;
    }>(
      // 목표 편집 패널의 "연결 업무" 후보 — 남의 개인 업무는 후보에 없다 (§A3 ⑦).
      `SELECT t.id, t.title, t.status, a.display_name AS assignee_name
       FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.is_active = true AND t.status NOT IN ('dropped', 'proposed')
         AND ${visibleTaskSql("$1")}
       ORDER BY t.created_at DESC LIMIT 200`,
      [session.id]
    );
    return NextResponse.json({
      tree, linkableTasks, unlinkedProjects: unlinked,
      unlinkedTasks: unlinkedTasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, progress: t.progress ?? 0,
        projectId: t.project_id, projectName: t.project_name,
        assigneeName: t.assignee_name, dueDate: t.due_date, areaId: t.area_id,
      })),
      monthGoals,
    });
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
    // 상위 목표 검증은 수정 경로와 **같은 함수**를 쓴다 (지시 27-2).
    // 규칙이 두 벌이면 한쪽만 낡는다.
    const parentId = payload.parentId ? Number(payload.parentId) : null;
    const parentErr = await validateGoalParent({
      goalId: null, parentId, periodType: periodType as GoalPeriodType, scope, viewerId: session.id,
    });
    if (parentErr) return NextResponse.json({ error: parentErr }, { status: 400 });

    // 27-4 — 같은 주기·같은 기간에 같은 제목이 이미 있으면 **알려만 준다.**
    // 저장은 막지 않는다 (B-2 와 같은 원칙: 판단은 사람이 한다).
    const twin = await queryOne<{ id: number }>(
      `SELECT id FROM goal
        WHERE is_active = true AND period_type = $1 AND period_start = $2::date
          AND scope = $3 AND btrim(lower(title)) = btrim(lower($4))
        LIMIT 1`,
      [periodType, periodStart, scope, title]
    );

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
    // 27-4 — 막지 않고 알려만 준다. 저장을 먼저 끝낸 뒤 사실을 얹는다.
    return NextResponse.json({ goal, ...(twin ? { duplicateTitleOf: twin.id } : {}) });
  } catch (error) {
    return jsonError(error);
  }
}
