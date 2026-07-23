// 목표 수정 (Phase 4) — 수동 진척/속성/Task 연결(월 목표). lead 또는 목표 소유자.
// 삭제는 소프트: isActive=false (lead만). 하드 삭제 없음.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const goalId = Number(params.id);
    const payload = await request.json();

    const goal = await queryOne<{
      id: number;
      title: string;
      period_type: string;
      owner_actor_id: number | null;
    }>("SELECT id, title, period_type, owner_actor_id FROM goal WHERE id = $1 AND is_active = true", [
      goalId,
    ]);
    if (!goal) return NextResponse.json({ error: "목표를 찾을 수 없습니다." }, { status: 404 });

    const isLead = session.role === "lead";
    const isOwner = goal.owner_actor_id === session.id;
    if (!isLead && !isOwner) {
      return NextResponse.json({ error: "수정 권한이 없습니다." }, { status: 403 });
    }

    // 소프트 삭제(보관)는 lead만
    if (payload.isActive === false) {
      if (!isLead) return NextResponse.json({ error: "팀장만 보관할 수 있습니다." }, { status: 403 });
      await query("UPDATE goal SET is_active = false, updated_at = now() WHERE id = $1", [goalId]);
      await logActivity({ userId: session.id, message: `${session.name}이(가) 목표 보관 — "${goal.title}"`, level: "warn" });
      return NextResponse.json({ ok: true });
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
    if (payload.ownerActorId !== undefined) set("owner_actor_id", payload.ownerActorId ? Number(payload.ownerActorId) : null);

    if (sets.length > 0) {
      values.push(goalId);
      await query(`UPDATE goal SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length}`, values);
    }

    // Task 연결 교체 (월 목표만, N:M — 다중 선택, 선택 사항)
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
    }

    await logActivity({ userId: session.id, message: `${session.name}이(가) 목표 수정 — "${goal.title}"` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
