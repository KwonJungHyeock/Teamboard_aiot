// 업무 수정 (Phase 5) — 속성 수정 · 상태 전이 · 인박스 승인/기각 · 목표 연결(다중, 선택).
// 삭제는 소프트만: isActive=false. 하드 삭제 핸들러는 의도적으로 없다 (검수 포인트 4).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { recomputeGoalChain } from "@/lib/goals";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["proposed", "todo", "doing", "review", "done", "dropped"] as const;
const PRIORITIES = ["high", "mid", "low"] as const;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession(); // Task는 member 전권 (SPEC 6장)
    const taskId = Number(params.id);
    const payload = await request.json();

    const task = await queryOne<{
      id: number; title: string; status: string; assignee_id: number | null;
      start_date: string | null; due_date: string | null;
    }>(
      "SELECT id, title, status, assignee_id, start_date::text, due_date::text FROM task WHERE id = $1 AND is_active = true",
      [taskId]
    );
    if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

    // 소프트 삭제
    if (payload.isActive === false) {
      await query("UPDATE task SET is_active = false, updated_at = now() WHERE id = $1", [taskId]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 업무 삭제 — "${task.title}"`,
        level: "warn",
        taskId,
      });
      return NextResponse.json({ ok: true });
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (typeof payload.title === "string" && payload.title.trim()) {
      set("title", payload.title.trim().slice(0, 200));
    }
    if (typeof payload.description === "string") set("description", payload.description.slice(0, 4000));
    if ((PRIORITIES as readonly string[]).includes(payload.priority)) set("priority", payload.priority);
    if (payload.projectId !== undefined) set("project_id", payload.projectId ? Number(payload.projectId) : null);
    if (payload.assigneeId !== undefined) set("assignee_id", payload.assigneeId ? Number(payload.assigneeId) : null);
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    // 병합값 기준으로 시작일<=마감일 검증 (한쪽만 수정해도 정합성 유지)
    const nextStart =
      payload.startDate !== undefined ? (isDate(payload.startDate) ? payload.startDate : null) : task.start_date;
    const nextDue =
      payload.dueDate !== undefined ? (isDate(payload.dueDate) ? payload.dueDate : null) : task.due_date;
    if (nextStart && nextDue && nextStart > nextDue) {
      return NextResponse.json({ error: "시작일이 마감일보다 늦을 수 없습니다." }, { status: 400 });
    }
    if (payload.startDate !== undefined) set("start_date", isDate(payload.startDate) ? payload.startDate : null);
    if (payload.dueDate !== undefined) set("due_date", isDate(payload.dueDate) ? payload.dueDate : null);
    if (payload.areaId !== undefined && payload.areaId) set("area_id", Number(payload.areaId));
    if (["team", "personal", "routine"].includes(payload.workType)) set("work_type", payload.workType);

    let statusLog = "";
    if (payload.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(payload.status)) {
        return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
      }
      // 인박스 승인·기각(proposed의 상태 전이)은 담당자 본인 또는 lead만 — drafts 승인 규칙과 동일
      if (task.status === "proposed" && payload.status !== "proposed") {
        const canJudge = session.role === "lead" || task.assignee_id === session.id;
        if (!canJudge) {
          return NextResponse.json(
            { error: "제안 업무의 승인·기각은 담당자 본인 또는 팀장만 할 수 있습니다." },
            { status: 403 }
          );
        }
      }
      // 중단 전환은 사유 필수 — 진척률 분모에서 빠지므로 우회 방지 (SPEC v1.1 예정)
      let dropReason = "";
      if (payload.status === "dropped" && task.status !== "proposed") {
        dropReason = String(payload.dropReason ?? "").trim().slice(0, 500);
        if (!dropReason) {
          return NextResponse.json({ error: "중단 사유를 입력하세요." }, { status: 400 });
        }
        set("drop_reason", dropReason);
        set("dropped_at", new Date().toISOString());
      } else if (payload.status !== "dropped") {
        set("drop_reason", null);
        set("dropped_at", null);
      }
      set("status", payload.status);
      // 완료 시각은 상태 전이에서만 기록/해제
      if (payload.status === "done") set("completed_at", new Date().toISOString());
      else set("completed_at", null);
      if (task.status === "proposed" && payload.status === "todo") {
        statusLog = `${session.name}이(가) 에이전트 제안 업무 승인 — "${task.title}"`;
      } else if (task.status === "proposed" && payload.status === "dropped") {
        statusLog = `${session.name}이(가) 에이전트 제안 업무 기각 — "${task.title}"`;
      } else if (payload.status === "dropped") {
        statusLog = `${session.name}이(가) 업무 중단 — "${task.title}" (사유: ${dropReason})`;
      } else {
        statusLog = `${session.name}이(가) 업무 상태 변경 (${task.status} → ${payload.status}) — "${task.title}"`;
      }
    }

    if (sets.length > 0) {
      values.push(taskId);
      await query(`UPDATE task SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    }

    // 진척 재계산 대상 목표 수집 (파트 B) — 변경 전 연결 목표부터.
    const affectedGoals = new Set<number>();
    const statusChanged = typeof payload.status === "string" && payload.status !== task.status;

    // 목표 연결 교체 — 다중 선택, 선택 사항. 월 목표만 허용 (SPEC 2.2)
    if (Array.isArray(payload.goalIds)) {
      const priorLinks = await query<{ goal_id: number }>(
        "SELECT goal_id FROM goal_task WHERE task_id = $1",
        [taskId]
      );
      priorLinks.forEach((l) => affectedGoals.add(l.goal_id));
      const goalIds = payload.goalIds.map(Number).filter((n: number) => Number.isInteger(n));
      await query("DELETE FROM goal_task WHERE task_id = $1", [taskId]);
      for (const goalId of goalIds) {
        await query(
          `INSERT INTO goal_task (goal_id, task_id)
           SELECT $1, $2 WHERE EXISTS (
             SELECT 1 FROM goal WHERE id = $1 AND is_active = true AND period_type = 'month'
           )
           ON CONFLICT DO NOTHING`,
          [goalId, taskId]
        );
      }
    }

    // 현재(변경 후) 연결 목표 — 상태 변경 시에도 재계산 대상
    if (statusChanged || Array.isArray(payload.goalIds)) {
      const nowLinks = await query<{ goal_id: number }>(
        "SELECT goal_id FROM goal_task WHERE task_id = $1",
        [taskId]
      );
      nowLinks.forEach((l) => affectedGoals.add(l.goal_id));
    }
    // 연결 체인(월→분기→연간) 즉시 재계산 — 홈·목표 화면에 바로 반영 (파트 B)
    for (const gid of Array.from(affectedGoals)) await recomputeGoalChain(gid);

    // 활동 타임라인은 "상태 변경"만 기록한다 (인라인 자동저장이 매 필드마다 로그를
    // 남기면 타임라인이 잡음으로 가득 참 — 코멘트는 task_comment가 담당).
    if (statusLog) {
      await logActivity({ userId: session.id, message: statusLog, taskId });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

// PATCH — PUT과 동일(부분 수정). 상세 패널 인라인 자동저장이 사용.
export async function PATCH(request: Request, ctx: { params: { id: string } }) {
  return PUT(request, ctx);
}

// GET — 상세 패널용 단일 업무 전체 정보 (+ 영역·프로젝트·담당 이름, 연결 목표, 활동 로그)
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const id = Number(params.id);
    const t = await queryOne<{
      id: number; title: string; description: string; status: string; priority: string;
      origin: string; work_type: string; area_id: number; area_name: string; area_color: string | null;
      project_id: number | null; project_name: string | null; color_key: string | null;
      assignee_id: number | null; assignee_name: string | null; created_by_name: string | null;
      start_date: string | null; due_date: string | null; drop_reason: string | null;
      goal_ids: number[] | null;
    }>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.origin, t.work_type,
              t.area_id, ar.name AS area_name, ar.color_key AS area_color,
              t.project_id, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name, c.display_name AS created_by_name,
              t.start_date::text, t.due_date::text, t.drop_reason,
              array_agg(gt.goal_id) FILTER (WHERE gt.goal_id IS NOT NULL) AS goal_ids
       FROM task t
       JOIN area ar ON ar.id = t.area_id
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       LEFT JOIN goal_task gt ON gt.task_id = t.id
       WHERE t.id = $1 AND t.is_active = true
       GROUP BY t.id, ar.name, ar.color_key, p.name, p.color_key, a.display_name, c.display_name`,
      [id]
    );
    if (!t) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

    const activity = await query<{ id: number; message: string; level: string; created_at: string; user_name: string | null }>(
      `SELECT al.id, al.message, al.level, al.created_at::text, u.display_name AS user_name
       FROM activity_log al LEFT JOIN actor u ON u.id = al.user_id
       WHERE al.task_id = $1 ORDER BY al.created_at DESC LIMIT 30`,
      [id]
    );

    return NextResponse.json({
      task: {
        id: t.id, title: t.title, description: t.description, status: t.status, priority: t.priority,
        origin: t.origin, workType: t.work_type, areaId: t.area_id, areaName: t.area_name, areaColor: t.area_color,
        projectId: t.project_id, projectName: t.project_name, colorKey: t.color_key,
        assigneeId: t.assignee_id, assigneeName: t.assignee_name, createdByName: t.created_by_name,
        startDate: t.start_date, dueDate: t.due_date, dropReason: t.drop_reason,
        goalIds: t.goal_ids ?? [],
      },
      activity,
    });
  } catch (error) {
    return jsonError(error);
  }
}
