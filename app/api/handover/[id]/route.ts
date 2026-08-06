// 인수인계 상세 / 편집 / 삭제 (파트 Y).
// 편집·삭제: 작성자 본인만. 조회: 본인 또는 (shared & (lead | 해당 영역 담당)).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HandoverRow {
  id: number; author_id: number; author_name: string; title: string; content: string;
  area_id: number | null; area_name: string | null; status: string; updated_at: string;
}

async function canView(session: { id: number; role: string }, h: HandoverRow): Promise<boolean> {
  if (h.author_id === session.id) return true;
  if (h.status !== "shared") return false;
  if (session.role === "lead") return true;
  if (h.area_id == null) return false;
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM actor_area WHERE actor_id = $1 AND area_id = $2`,
    [session.id, h.area_id]
  );
  return (row?.n ?? 0) > 0;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    const h = await queryOne<HandoverRow>(
      `SELECT h.id, h.author_id, au.display_name AS author_name, h.title, h.content,
              h.area_id, ar.name AS area_name, h.status, h.updated_at::text
       FROM handover h JOIN actor au ON au.id = h.author_id
       LEFT JOIN area ar ON ar.id = h.area_id
       WHERE h.id = $1 AND h.is_active = true`,
      [id]
    );
    if (!h) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (!(await canView(session, h))) {
      return NextResponse.json({ error: "열람 권한이 없습니다." }, { status: 403 });
    }

    // 포함 업무 — 제목·상태·기한·프로젝트 + 연결 자료(artifact)
    const tasks = await query<{
      id: number; title: string; status: string; due_date: string | null;
      project_name: string | null; area_name: string;
    }>(
      `SELECT t.id, t.title, t.status, t.due_date::text, p.name AS project_name, ar.name AS area_name
       FROM handover_task ht
       -- 인수인계 항목 — 남의 개인 업무는 넘길 대상이 아니다 (§A3)
       JOIN task t ON t.id = ht.task_id AND (t.visibility = 'team' OR t.created_by = $2)
       LEFT JOIN project p ON p.id = t.project_id
       JOIN area ar ON ar.id = t.area_id
       WHERE ht.handover_id = $1
       ORDER BY t.due_date ASC NULLS LAST, t.id`,
      [id, session.id]
    );
    const taskIds = tasks.map((t) => t.id);
    const arts = taskIds.length
      ? await query<{ task_id: number; kind: string; title: string; url: string }>(
          `SELECT ta.task_id, a.kind, a.title, a.url
           FROM task_artifact ta JOIN artifact a ON a.id = ta.artifact_id
           WHERE ta.task_id = ANY($1) AND a.is_active = true`,
          [taskIds]
        )
      : [];
    const linkedTasks = tasks.map((t) => ({
      id: t.id, title: t.title, status: t.status, dueDate: t.due_date,
      projectName: t.project_name, areaName: t.area_name,
      artifacts: arts.filter((a) => a.task_id === t.id).map((a) => ({ kind: a.kind, title: a.title, url: a.url })),
    }));

    return NextResponse.json({
      handover: {
        id: h.id, title: h.title, content: h.content, areaId: h.area_id, areaName: h.area_name,
        status: h.status, authorId: h.author_id, authorName: h.author_name, updatedAt: h.updated_at,
      },
      linkedTasks,
      taskIds,
      canEdit: h.author_id === session.id,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    const h = await queryOne<{ author_id: number; status: string; title: string }>(
      `SELECT author_id, status, title FROM handover WHERE id = $1 AND is_active = true`,
      [id]
    );
    if (!h) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (h.author_id !== session.id) {
      return NextResponse.json({ error: "본인 문서만 편집할 수 있습니다." }, { status: 403 });
    }

    const payload = await request.json().catch(() => ({}));
    const sets: string[] = [];
    const vals: unknown[] = [];
    const add = (col: string, v: unknown) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

    if (typeof payload.title === "string") add("title", payload.title.trim().slice(0, 200));
    if (typeof payload.content === "string") add("content", payload.content.slice(0, 20000));
    if ("areaId" in payload) add("area_id", payload.areaId ? Number(payload.areaId) : null);
    if (payload.status === "draft" || payload.status === "shared") add("status", payload.status);

    if (sets.length) {
      vals.push(id);
      await query(`UPDATE handover SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
    }

    // 포함 업무 갱신 (전달된 경우 전체 교체)
    if (Array.isArray(payload.taskIds)) {
      const ids = (payload.taskIds as unknown[]).map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0);
      await query(`DELETE FROM handover_task WHERE handover_id = $1`, [id]);
      for (const tid of ids) {
        await query(
          `INSERT INTO handover_task (handover_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, tid]
        );
      }
    }

    if (payload.status === "shared" && h.status !== "shared") {
      await logActivity({ userId: session.id, message: `${session.name}이(가) 인수인계 "${h.title}" 공유` });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    const h = await queryOne<{ author_id: number; title: string }>(
      `SELECT author_id, title FROM handover WHERE id = $1 AND is_active = true`,
      [id]
    );
    if (!h) return NextResponse.json({ error: "문서를 찾을 수 없습니다." }, { status: 404 });
    if (h.author_id !== session.id) {
      return NextResponse.json({ error: "본인 문서만 삭제할 수 있습니다." }, { status: 403 });
    }
    await query(`UPDATE handover SET is_active = false, updated_at = now() WHERE id = $1`, [id]);
    await logActivity({ userId: session.id, message: `${session.name}이(가) 인수인계 "${h.title}" 삭제`, level: "warn" });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
