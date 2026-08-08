// 목표 수정 (Phase 4) — 수동 진척/속성/Task 연결(월 목표). lead 또는 목표 소유자.
// 삭제는 소프트: isActive=false (lead만). 하드 삭제 없음.
import { NextResponse } from "next/server";
import { goalCountedSql, countedLabel } from "@/lib/progress";
import { requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { validateGoalParent } from "@/lib/goals";
import type { GoalPeriodType } from "@/lib/types";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { recomputeGoalChain, judgeGoalStatus, kstTodayForGoals as kstToday, type GoalStatus } from "@/lib/goals";
import { projectsForGoal } from "@/lib/projects";
import { goalTrend } from "@/lib/goal-snapshot";
import { jsonError } from "@/lib/api";
import { periodEndOf, reparentByPeriod, type GoalPeriod } from "@/lib/goal-hierarchy";

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
      progress: string | null; progress_auto: string | null; progress_manual: string | null;
      counted_tasks: number;
      status_manual: GoalStatus | null;
      scope: string; owner_actor_id: number | null; owner_name: string | null;
      area_id: number | null; area_name: string | null; project_id: number | null; project_name: string | null;
      parent_id: number | null; parent_title: string | null;
    }>(
      `SELECT g.id, g.title, g.description, g.period_type, g.period_start::text, g.period_end::text,
              g.progress_mode, g.progress::text, g.progress_auto::text, g.progress_manual::text,
              ${goalCountedSql("g.id")}::int AS counted_tasks,
              g.status_manual,
              g.scope, g.owner_actor_id, o.display_name AS owner_name,
              g.area_id, ar.name AS area_name, g.project_id, p.name AS project_name,
              g.parent_id, pg.title AS parent_title
       FROM goal g
       LEFT JOIN goal pg ON pg.id = g.parent_id
       LEFT JOIN actor o ON o.id = g.owner_actor_id
       LEFT JOIN area ar ON ar.id = g.area_id
       LEFT JOIN project p ON p.id = g.project_id
       WHERE g.id = $1 AND g.is_active = true`,
      [goalId]
    );
    if (!g) return NextResponse.json({ error: "목표를 찾을 수 없습니다." }, { status: 404 });
    // 개인 목표는 본인과 팀장만 열람 (§E)
    if (g.scope === "personal" && g.owner_actor_id !== session.id && session.role !== "lead") {
      return NextResponse.json({ error: "열람 권한이 없습니다." }, { status: 403 });
    }
    const canEdit = g.scope === "personal" ? g.owner_actor_id === session.id : session.role === "lead";

    // ── §A4 팀장 열람 경계 ──────────────────────────────────────────
    //
    //   "팀장은 개인 목표의 진척은 보되 그 아래 업무의 제목·내용은 볼 수 없다.
    //    숫자는 보이고 내용은 안 보인다 — 이 경계를 코드로 강제할 것."
    //
    // countedTasks(분모)는 위에서 그대로 세므로 "업무 7건 기준"은 유지된다.
    // 목록만 주지 않는다. 빈 배열을 주는 것이지 오류가 아니다.
    const tasksHidden = g.scope === "personal" && g.owner_actor_id !== session.id;
    const tasks = tasksHidden
      ? []
      : await query<{ id: number; title: string; status: string; assignee_name: string | null; due_date: string | null }>(
          `SELECT t.id, t.title, t.status, a.display_name AS assignee_name, t.due_date::text
           FROM goal_task gt JOIN task t ON t.id = gt.task_id AND t.is_active = true AND t.status <> 'proposed'
           LEFT JOIN actor a ON a.id = t.assignee_id
           -- 개인 업무는 주인만 (§A3). 자기 개인 목표를 볼 때도 규칙은 같다.
           WHERE gt.goal_id = $1 AND ${visibleTaskSql("$2")}
           ORDER BY t.due_date ASC NULLS LAST, t.id`,
          [goalId, session.id]
        );
    const { getGoalContribution } = await import("@/lib/goals");
    const contribution = g.scope === "team" ? await getGoalContribution(goalId) : [];
    // 연결된 프로젝트 + 각 진척 (§B1)
    const linkedProjects = await projectsForGoal(goalId);
    // 하위 목표가 있으면 집계는 하위 평균이 우선한다(§C4) — 화면에서 그 사실을 알려야
    // "프로젝트를 붙였는데 왜 반영이 안 되지?"가 생기지 않는다.
    const childRow = await queryOne<{ n: string }>(
      `SELECT count(*) AS n FROM goal WHERE parent_id = $1 AND is_active = true`, [goalId]
    );
    const childCount = Number(childRow?.n ?? 0);
    // 최근 6개월 추이 (§E) — 스냅샷이 있는 달만 점으로. 없는 달은 배열에 없다.
    const trend = await goalTrend(goalId, 6);

    // 상위 목표 후보 (지시 27-2) — 주기 규칙·스코프에 맞고, 자기 자손이 아닌 것.
    // 후보를 서버에서 좁혀 준다. 화면에서 거르면 규칙이 두 벌이 된다.
    const expectedParent =
      g.period_type === "month" ? "quarter" : g.period_type === "quarter" ? "year" : null;
    const parentCandidates = expectedParent
      ? await query<{ id: number; title: string; period_start: string }>(
          `WITH RECURSIVE sub AS (
             SELECT id FROM goal WHERE id = $1
             UNION ALL SELECT c.id FROM goal c JOIN sub ON c.parent_id = sub.id
           )
           SELECT g2.id, g2.title, g2.period_start::text
             FROM goal g2
            WHERE g2.is_active = true AND g2.period_type = $2 AND g2.scope = $3
              AND ($3 <> 'personal' OR g2.owner_actor_id = $4)
              AND g2.id NOT IN (SELECT id FROM sub)
            ORDER BY g2.period_start DESC, g2.id`,
          [goalId, expectedParent, g.scope, session.id]
        )
      : [];

    const manual = g.progress_manual === null ? null : Math.round(Number(g.progress_manual));
    const effective = manual !== null ? manual : (g.progress === null ? null : Math.round(Number(g.progress)));

    return NextResponse.json({
      goal: {
        id: g.id, title: g.title, description: g.description, periodType: g.period_type,
        periodStart: g.period_start, periodEnd: g.period_end, progressMode: g.progress_mode,
        progress: effective,
        countedTasks: Number(g.counted_tasks ?? 0),
        progressAuto: g.progress_auto === null ? null : Math.round(Number(g.progress_auto)),
        progressManual: manual,
        status: g.status_manual ?? judgeGoalStatus(effective, g.period_start, g.period_end, kstToday()),
        statusManual: g.status_manual !== null,
        scope: g.scope, ownerActorId: g.owner_actor_id, ownerName: g.owner_name,
        areaId: g.area_id, areaName: g.area_name, projectId: g.project_id, projectName: g.project_name,
        // 화면이 "왜 비어 있지?"를 설명할 수 있게 사실을 함께 준다 (§A4)
        tasksHidden,
        parentId: g.parent_id,
        parentTitle: g.parent_title,
      },
      parentCandidates: parentCandidates.map((c) => ({
        id: c.id, title: c.title, periodStart: c.period_start,
      })),
      linkedProjects,
      childCount,
      trend,
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
      parent_id: number | null;
      period_start: string;
      goal_parent_source: string;
    }>(`SELECT id, title, period_type, owner_actor_id, is_active, scope, parent_id,
               period_start::text, goal_parent_source
          FROM goal WHERE id = $1`, [goalId]);
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
    if (payload.progressMode === "auto" || payload.progressMode === "manual") {
      set("progress_mode", payload.progressMode);
      // 자동으로 되돌리면 수동값을 비워 집계가 다시 실효값이 되게 한다 (§C3)
      if (payload.progressMode === "auto") set("progress_manual", null);
    }
    // 상태 수동 지정 — null이면 자동 판정으로 되돌린다 (§D)
    if ("statusManual" in payload) {
      const v = payload.statusManual;
      set("status_manual", ["ontrack", "risk", "wait", "done"].includes(v) ? v : null);
    }
    if (payload.progress != null && Number.isFinite(Number(payload.progress))) {
      // 수동 입력은 progress_manual에 남긴다. progress(실효값)는 재계산이 채운다.
      set("progress_manual", Math.max(0, Math.min(100, Number(payload.progress))));
    }
    if (payload.targetMetric !== undefined) set("target_metric", payload.targetMetric ? String(payload.targetMetric).slice(0, 100) : null);
    if (payload.targetValue !== undefined) set("target_value", payload.targetValue === null || payload.targetValue === "" ? null : Number(payload.targetValue));
    if (payload.currentValue !== undefined) set("current_value", payload.currentValue === null || payload.currentValue === "" ? null : Number(payload.currentValue));
    if (payload.projectId !== undefined) set("project_id", payload.projectId ? Number(payload.projectId) : null);
    // 팀 목표만 area 연결 가능
    if (payload.areaId !== undefined && goal.scope === "team") set("area_id", payload.areaId ? Number(payload.areaId) : null);
    if (payload.ownerActorId !== undefined && goal.scope === "team") set("owner_actor_id", payload.ownerActorId ? Number(payload.ownerActorId) : null);

    // ── §A4 기간 변경 ────────────────────────────────────────────
    // 기간을 바꾸면 상위가 따라간다. 8월 → 10월이면 Q3 → Q4.
    // 끝날짜는 받지 않는다 — 주기와 시작일이 정한다.
    let periodChanged = false;
    if (typeof payload.periodStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.periodStart)
        && payload.periodStart !== goal.period_start) {
      set("period_start", payload.periodStart);
      set("period_end", periodEndOf(goal.period_type as GoalPeriod, payload.periodStart));
      periodChanged = true;
    }

    // ── 상위 목표 변경 (지시 27-2 · §A5) ───────────────────────────
    // 이 경로가 없어서 상위가 틀린 목표를 고치지 못하고 새로 만들어 중복이 남았다(판정 A).
    // 029 §A5 에서 이 자리는 「고급」 접힘 영역으로 내려갔다 — 없애지 않고 숨겼다.
    // 여기로 들어온 지정은 **사람이 한 것**이므로 goal_parent_source = manual 로 남긴다.
    let parentChanged = false;
    const oldParentId = goal.parent_id;
    if (payload.parentId !== undefined) {
      const nextParent = payload.parentId === null || payload.parentId === 0
        ? null
        : Number(payload.parentId);
      const err = await validateGoalParent({
        goalId,
        parentId: nextParent,
        periodType: goal.period_type as GoalPeriodType,
        scope: goal.scope,
        viewerId: session.id,
      });
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      if (nextParent !== oldParentId) {
        set("parent_id", nextParent);
        parentChanged = true;
      }
      // 값이 그대로여도 "손으로 정했다"는 사실은 남긴다 — 그래야 기간을 바꿔도 안 따라간다.
      set("goal_parent_source", "manual");
    }
    // 「고급」에서 자동으로 되돌리기 — 다시 기간을 따라가게 한다.
    if (payload.parentSource === "derived") set("goal_parent_source", "derived");

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
    if (progressAffecting || parentChanged) await recomputeGoalChain(goalId);
    // 상위가 바뀌면 **떠난 쪽**도 다시 계산해야 한다. 안 하면 옛 상위에 이 목표의 몫이 남는다.
    if (parentChanged && oldParentId !== null) await recomputeGoalChain(oldParentId);

    // §A4 — 기간이 바뀌었거나 자동으로 되돌렸으면 상위를 다시 맞춘다.
    // manual 이면 reparentByPeriod 가 그냥 지나간다 (§A5).
    let moved: Awaited<ReturnType<typeof reparentByPeriod>> | null = null;
    if (periodChanged || payload.parentSource === "derived") {
      moved = await reparentByPeriod(goalId);
    }

    await logActivity({ userId: session.id, message: `${session.name}이(가) 목표 수정 — "${goal.title}"` });
    // 옮겨졌으면 화면이 "Q3 → Q4 로 옮겨졌습니다" 한 줄을 띄울 수 있게 사실을 돌려준다.
    return NextResponse.json({ ok: true, ...(moved?.moved ? { moved } : {}) });
  } catch (error) {
    return jsonError(error);
  }
}
