// 회의 채팅 한 줄 (0044) — POST { body }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { addChat, MeetingError } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const p = await request.json().catch(() => ({}));
    return NextResponse.json({ id: await addChat(id, s.id, p.body) });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
