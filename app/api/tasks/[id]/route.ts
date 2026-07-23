// 업무 수정 (Phase 5) — 속성 수정 · 상태 전이 · 인박스 승인/기각 · 목표 연결(다중, 선택).
// 삭제는 소프트만: isActive=false. 하드 삭제 핸들러는 의도적으로 없다 (검수 포인트 4).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
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

    const task = await queryOne<{ id: number; title: string; status: string }>(
      "SELECT id, title, status FROM task WHERE id = $1 AND is_active = true",
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
    if (payload.dueDate !== undefined) {
      set(
        "due_date",
        typeof payload.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
          ? payload.dueDate
          : null
      );
    }

    let statusLog = "";
    if (payload.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(payload.status)) {
        return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
      }
      set("status", payload.status);
      // 완료 시각은 상태 전이에서만 기록/해제
      if (payload.status === "done") set("completed_at", new Date().toISOString());
      else set("completed_at", null);
      if (task.status === "proposed" && payload.status === "todo") {
        statusLog = `${session.name}이(가) 부사수 제안 업무 승인 — "${task.title}"`;
      } else if (task.status === "proposed" && payload.status === "dropped") {
        statusLog = `${session.name}이(가) 부사수 제안 업무 기각 — "${task.title}"`;
      } else {
        statusLog = `${session.name}이(가) 업무 상태 변경 (${task.status} → ${payload.status}) — "${task.title}"`;
      }
    }

    if (sets.length > 0) {
      values.push(taskId);
      await query(`UPDATE task SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    }

    // 목표 연결 교체 — 다중 선택, 선택 사항. 월 목표만 허용 (SPEC 2.2)
    if (Array.isArray(payload.goalIds)) {
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

    await logActivity({
      userId: session.id,
      message: statusLog || `${session.name}이(가) 업무 수정 — "${task.title}"`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
