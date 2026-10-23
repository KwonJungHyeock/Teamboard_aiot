// 회의 하나 — 읽기 · 항목 올리기. 읽을 때마다 「여기 있다」를 남긴다(열린 회의일 때만).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { addItem, getMeeting, heartbeat, MeetingError } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id);
    if (!id) return new NextResponse(null, { status: 404 });
    // `?look=1` 은 목록에서 들여다보는 것 — 참석으로 치지 않는다
    if (new URL(request.url).searchParams.get("look") !== "1") await heartbeat(id, session.id);
    const m = await getMeeting(id);
    if (!m) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ meeting: m, me: session.id });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id);
    if (!id) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ id: await addItem(id, session.id, await request.json().catch(() => ({}))) });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
