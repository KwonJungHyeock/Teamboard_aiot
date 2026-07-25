// 업무 코멘트 (파트 1 상세 패널) — task_comment 신규 테이블. signal comment(signal_id 전용)와 분리.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const id = Number(params.id);
    const comments = await query<{ id: number; body: string; created_at: string; author_name: string }>(
      `SELECT c.id, c.body, c.created_at::text, a.display_name AS author_name
       FROM task_comment c JOIN actor a ON a.id = c.author_id
       WHERE c.task_id = $1 ORDER BY c.created_at ASC`,
      [id]
    );
    return NextResponse.json({ comments });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    const payload = await request.json();
    const text = String(payload.body ?? "").trim().slice(0, 2000);
    if (!text) return NextResponse.json({ error: "코멘트를 입력하세요." }, { status: 400 });

    const task = await queryOne<{ id: number }>("SELECT id FROM task WHERE id = $1 AND is_active = true", [id]);
    if (!task) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

    const row = await queryOne<{ id: number; created_at: string }>(
      "INSERT INTO task_comment (task_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, created_at::text",
      [id, session.id, text]
    );
    // 코멘트도 활동 타임라인(activity_log)에 남겨 상태 변경과 함께 이력으로 보이게 한다
    await logActivity({ userId: session.id, message: `${session.name} 코멘트: ${text.slice(0, 80)}`, taskId: id });
    return NextResponse.json({ id: row!.id, created_at: row!.created_at, author_name: session.name });
  } catch (error) {
    return jsonError(error);
  }
}
