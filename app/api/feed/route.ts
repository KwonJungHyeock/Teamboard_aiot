// 타임라인 공유 피드 (협업 A) — 팀 타임라인 활동 포스트 조회 + 업무 공유 생성.
// 공유 시 activity(kind=task_share) 저장 + 노트의 @멘션 대상에게 알림.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { notify, notifyMentions } from "@/lib/notify";
import { reactionsFor } from "@/lib/reactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const rows = await query<{
      id: number;
      actor_id: number;
      actor_name: string;
      avatar_url: string | null;
      kind: string;
      ref_type: string;
      ref_id: number | null;
      note: string;
      task_title: string | null;
      task_status: string | null;
      created_at: string;
    }>(
      `SELECT ac.id, ac.actor_id, a.display_name AS actor_name, a.avatar_url,
              ac.kind, ac.ref_type, ac.ref_id, ac.note,
              t.title AS task_title, t.status AS task_status, ac.created_at::text
       FROM activity ac
       JOIN actor a ON a.id = ac.actor_id
       LEFT JOIN task t ON t.id = ac.ref_id AND ac.ref_type = 'task'
       -- ③ 활동 피드 — 남의 개인 업무를 가리키는 활동은 **줄 자체를 뺀다** (§A3).
       --    JOIN 만 막으면 제목만 비고 "무언가 있었다"는 사실이 남는다.
       WHERE ac.ref_type <> 'task' OR t.id IS NULL OR ${visibleTaskSql("$1")}
       ORDER BY ac.created_at DESC
       LIMIT 40`,
      [session.id]
    );
    const ids = rows.map((r) => r.id);
    const reactions = await reactionsFor("activity", ids, session.id);
    return NextResponse.json({
      items: rows.map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_name,
        avatarUrl: r.avatar_url,
        kind: r.kind,
        refType: r.ref_type,
        refId: r.ref_id,
        note: r.note,
        taskTitle: r.task_title,
        taskStatus: r.task_status,
        createdAt: r.created_at,
        reactions: reactions.get(r.id) ?? [],
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();
    const taskId = Number(payload.taskId);
    if (!Number.isInteger(taskId)) {
      return NextResponse.json({ error: "업무를 지정하세요." }, { status: 400 });
    }
    const task = await queryOne<{ id: number; title: string; assignee_id: number | null }>(
      // 남의 개인 업무는 공유(활동 게시)도 못 한다 — 안 보이는 것은 없는 것이다.
      `SELECT id, title, assignee_id FROM task t
        WHERE id = $1 AND is_active = true AND ${visibleTaskSql("$2")}`,
      [taskId, session.id]
    );
    if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    const note = String(payload.note ?? "").trim().slice(0, 500);
    const post = await queryOne<{ id: number }>(
      `INSERT INTO activity (actor_id, kind, ref_type, ref_id, note)
       VALUES ($1, 'task_share', 'task', $2, $3) RETURNING id`,
      [session.id, taskId, note]
    );
    // 노트 @멘션 → mention 알림. 담당자에겐 share 알림(중복·본인 제외).
    const snippet = note || `업무 공유 — ${task.title}`;
    const mentioned = await notifyMentions(note, session.id, "task", taskId, snippet);
    if (task.assignee_id && task.assignee_id !== session.id && !mentioned.includes(task.assignee_id)) {
      await notify({ userId: task.assignee_id, type: "share", refType: "task", refId: taskId, snippet, actorId: session.id });
    }
    return NextResponse.json({ id: post!.id });
  } catch (error) {
    return jsonError(error);
  }
}
