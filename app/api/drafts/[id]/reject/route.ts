// 반려 — status=rejected, 재작업 지시(피드백) 저장 (PRD 7장)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const draftId = Number(params.id);
    const payload = await request.json().catch(() => ({}));
    const feedback = String(payload.feedback ?? "").trim();

    const draft = await queryOne<Draft>("SELECT * FROM drafts WHERE id = $1", [draftId]);
    if (!draft) return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    if (draft.status !== "pending") {
      return NextResponse.json({ error: "승인 대기 상태의 초안이 아닙니다." }, { status: 409 });
    }
    if (draft.user_id !== session.id && session.role !== "lead") {
      return NextResponse.json({ error: "반려 권한이 없습니다." }, { status: 403 });
    }

    await query(
      `UPDATE drafts SET status = 'rejected', approver_id = $1, feedback = $2, decided_at = now()
       WHERE id = $3`,
      [session.id, feedback || null, draftId]
    );
    await logActivity({
      userId: session.id,
      assistantId: draft.assistant_id,
      message: `${session.name}이(가) "${draft.title}" 반려${feedback ? ` — 사유: ${feedback.slice(0, 80)}` : ""}`,
      level: "warn",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
