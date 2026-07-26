// 목표 수정 (Phase 4) — 수동 진척/속성/Task 연결(월 목표). lead 또는 목표 소유자.
// 삭제는 소프트: isActive=false (lead만). 하드 삭제 없음.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { recomputeGoalChain } from "@/lib/goals";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 목표 상세 (파트 C 슬라이드 패널) — 속성 + 연결 업무 + 기여 현황.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const goalId = Number(params.id);
    const g = await queryOne<{
      id: number; title: string; description: string; period_type: string;
      period_start: string; period_end: string; progress_mode: "auto" | "manual";
      progress: string | null; scope: string; owner_actor_id: number | null; owner_name: string | null;
      area_id: number | null; area_name: string | null; project_id: number | null; project_name: string | null;
    }>(
      `SELECT g.id, g.title, g.description, g.period_type, g.period_start::text, g.period_end::text,
              g.progress_mode, g.progress::text, g.scope, g.owner_actor_id, o.display_name AS owner_name,
              g.area_id, ar.name AS area_name, g.project_id, p.name AS project_name
       FROM goal g
       LEFT JOIN actor o ON o.id = g.owner_actor_id
       LEFT JOIN area ar ON ar.id = g.area_id
       LEFT JOIN project p ON p.id = g.project_id
       WHERE g.id = $1 AND g.is_active = true`,
      [goalId]
    );
    if (!g) return NextResponse.json({ error: "목표를 찾을 수 없습니다." }, { status: 404 });
    // 개인 목표는 본인만 열람 (lead도 불가)
    if (g.scope === "personal" && g.owner_actor_id !== session.id) {
      return NextResponse.json({ error: "열람 권한이 없습니다." }, { status: 403 });
    }
    const canEdit = g.scope === "personal" ? g.owner_actor_id === session.id : session.role === "lead";

    const tasks = await query<{ id: number; title: string; status: string; assignee_name: string | null; due_date: string | null }>(
      `SELECT t.id, t.title, t.status, a.display_name AS assignee_name, t.due_date::text
       FROM goal_task gt JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed'
       LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE gt.goal_id = $1 ORDER BY t.due_date ASC NULLS LAST, t.id`,
      [goalId]
    );
    const { getGoalContribution } = await import("@/lib/goals");
    const contribution = g.scope === "team" ? await getGoalContribution(goalId) : [];

    return NextResponse.json({
      goal: {
        id: g.id, title: g.title, description: g.description, periodType: g.period_type,
        periodStart: g.period_start, periodEnd: g.period_end, progressMode: g.progress_mode,
        progress: g.progress === null ? null : Math.round(Number(g.progress)),
        scope: g.scope, ownerActorId: g.owner_actor_id, ownerName: g.owner_name,
        areaId: g.area_id, areaName: g.area_name, projectId: g.project_id, projectName: g.project_name,
      },
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assigneeName: t.assignee_name, dueDate: t.due_date })),
      contribution,
      canEdit,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const goalId = Number(params.id);
    const payload = await request.json();

    // 보관·복구 대상 조회를 위해 is_active 무관하게 탐색
    const goal = await queryOne<{
      id: number;
      title: string;
      period_type: string;
      owner_actor_id: number | null;
      is_active: boolean;
      scope: string;
    }>("SELECT id, title, period_type, owner_actor_id, is_active, scope FROM goal WHERE id = $1", [goalId]);
    if (!goal) return NextResponse.json({ error: "목표를 찾을 수 없습니다." }, { status: 404 });

    const isLead = session.role === "lead";
    const isOwner = goal.owner_actor_id === session.id;
    // 팀 목표는 lead만, 개인 목표는 본인만 (개인 목표는 lead도 접근 불가) — 파트 A
    if (goal.scope === "personal") {
      if (!isOwner) return NextResponse.json({ error: "본인 개인 목표만 수정할 수 있습니다." }, { status: 403 });
    } else if (!isLead) {
      return NextResponse.json({ error: "팀 목표는 팀장만 수정할 수 있습니다." }, { status: 403 });
    }

    // 보관 (소프트 삭제) — lead만. 하위 목표가 있으면 불가. goal_task 링크는 유지.
    if (payload.isActive === false) {
      if (goal.scope === "team" && !isLead) return NextResponse.json({ error: "팀장만 보관할 수 있습니다." }, { status: 403 });
      const children = await queryOne<{ n: string }>(
        "SELECT count(*) AS n FROM goal WHERE parent_id = $1 AND is_active = true",
        [goalId]
      );
      const childCount = Number(children?.n ?? 0);
      if (childCount > 0) {
        return NextResponse.json(
          { error: `하위 목표 ${childCount}개를 먼저 보관하세요.` },
          { status: 409 }
        );
      }
      await query("UPDATE goal SET is_active = false, updated_at = now() WHERE id = $1", [goalId]);
      await logActivity({ userId: session.id, message: `${session.name}이(가) 목표 보관 — "${goal.title}"`, level: "warn" });
      return NextResponse.json({ ok: true });
    }

    // 복구 — lead만. 상위가 보관 상태면 복구 불가(트리 정합).
    if (payload.isActive === true && !goal.is_active) {
      if (goal.scope === "team" && !isLead) return NextResponse.json({ error: "팀장만 복구할 수 있습니다." }, { status: 403 });
      const parentInactive = await queryOne<{ n: string }>(
        `SELECT count(*) AS n FROM goal parent
         JOIN goal child ON child.parent_id = parent.id
         WHERE child.id = $1 AND parent.is_active = false`,
        [goalId]
      );
      if (Number(parentInactive?.n ?? 0) > 0) {
        return NextResponse.json({ error: "상위 목표를 먼저 복구하세요." }, { status: 409 });
      }
      await query("UPDATE goal SET is_active = true, updated_at = now() WHERE id = $1", [goalId]);
      await logActivity({ userId: session.id, message: `${session.name}이(가) 목표 복구 — "${goal.title}"` });
      return NextResponse.json({ ok: true });
    }

    if (!goal.is_active) {
      return NextResponse.json({ error: "보관된 목표입니다. 먼저 복구하세요." }, { status: 409 });
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (typeof payload.title === "string" && payload.title.trim()) set("title", payload.title.trim().slice(0, 200));
    if (typeof payload.description === "string") set("description", payload.description.slice(0, 2000));
    if (payload.progressMode === "auto" || payload.progressMode === "manual") set("progress_mode", payload.progressMode);
    if (payload.progress != null && Number.isFinite(Number(payload.progress))) {
      set("progress", Math.max(0, Math.min(100, Number(payload.progress))));
    }
    if (payload.targetMetric !== undefined) set("target_metric", payload.targetMetric ? String(payload.targetMetric).slice(0, 100) : null);
    if (payload.targetValue !== undefined) set("target_value", payload.targetValue === null || payload.targetValue === "" ? null : Number(payload.targetValue));
    if (payload.currentValue !== undefined) set("current_value", payload.currentValue === null || payload.currentValue === "" ? null : Number(payload.currentValue));
    if (payload.projectId !== undefined) set("project_id", payload.projectId ? Number(payload.projectId) : null);
    // 팀 목표만 area 연결 가능
    if (payload.areaId !== undefined && goal.scope === "team") set("area_id", payload.areaId ? Number(payload.areaId) : null);
    if (payload.ownerActorId !== undefined && goal.scope === "team") set("owner_actor_id", payload.ownerActorId ? Number(payload.ownerActorId) : null);

    if (sets.length > 0) {
      values.push(goalId);
      await query(`UPDATE goal SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    }

    // Task 연결 교체 (월 목표만, N:M — 다중 선택, 선택 사항)
    let linksChanged = false;
    if (Array.isArray(payload.taskIds)) {
      if (goal.period_type !== "month") {
        return NextResponse.json({ error: "Task 연결은 월 목표에만 가능합니다." }, { status: 400 });
      }
      const taskIds = payload.taskIds.map(Number).filter((n: number) => Number.isInteger(n));
      await query("DELETE FROM goal_task WHERE goal_id = $1", [goalId]);
      for (const taskId of taskIds) {
        await query(
          `INSERT INTO goal_task (goal_id, task_id)
           SELECT $1, $2 WHERE EXISTS (SELECT 1 FROM task WHERE id = $2 AND is_active = true)
           ON CONFLICT DO NOTHING`,
          [goalId, taskId]
        );
      }
      linksChanged = true;
    }

    // 진척에 영향 주는 변경(연결·수동 진척·모드) → 체인 재계산 (파트 B)
    const progressAffecting = linksChanged || "progress" in payload || "progressMode" in payload;
    if (progressAffecting) await recomputeGoalChain(goalId);

    await logActivity({ userId: session.id, message: `${session.name}이(가) 목표 수정 — "${goal.title}"` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
