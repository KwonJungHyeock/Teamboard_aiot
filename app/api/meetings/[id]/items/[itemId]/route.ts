// 회의 항목 하나 — 정해진 일만(끝냄 · 찬성 · 확정 · 업무 달기 · 내리기). `lib/meeting.ts` 의 updateItem.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { updateItem, MeetingError } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function PATCH(request: Request, { params }: { params: { id: string; itemId: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id), itemId = idOf(params.itemId);
    if (!id || !itemId) return new NextResponse(null, { status: 404 });
    await updateItem(id, itemId, session.id, hasLead(session.role), await request.json().catch(() => ({})));
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
