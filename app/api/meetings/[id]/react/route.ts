// 회의 메시지 리액션 (0044) — POST { itemId, emoji } · 다시 누르면 거둔다
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { toggleReaction, MeetingError } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const p = await request.json().catch(() => ({}));
    await toggleReaction(id, Number(p.itemId), s.id, p.emoji);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
