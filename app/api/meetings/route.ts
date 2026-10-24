// 회의실 — 목록 · 열기 (0038). 회의는 팀 것이라 팀원 누구나 본다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { listMeetings, startMeeting, MeetingError } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireSession();
    return NextResponse.json({ meetings: await listMeetings() });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json({ id: await startMeeting(session.id, payload.title) });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
