// 회의록 본문 — 함께 쓴다(회의 중 · 끝난 뒤 모두). PUT { body, rev } → 새 판. 판이 어긋나면 409 + 최신 판.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { MeetingError, NotesConflict, saveNotes } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const p = await request.json().catch(() => ({}));
    return NextResponse.json({ notes: await saveNotes(id, s.id, p.body, p.rev) });
  } catch (e) {
    if (e instanceof NotesConflict) return NextResponse.json({ error: e.message, notes: e.current }, { status: 409 });
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
