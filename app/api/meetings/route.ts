// 회의실 — 목록 · 열기 (0038). 회의는 팀 것이라 팀원 누구나 본다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { listMeetings, startMeeting, MeetingError } from "@/lib/meeting";
import { getActiveHumans } from "@/lib/db";
import { notify as pushNotify } from "@/lib/push";

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
    const id = await startMeeting(session.id, payload.title);
    // 팀 전원(연 사람 빼고)에게 「회의가 열렸습니다」(0041) — 누르면 바로 그 회의로
    const others = (await getActiveHumans()).map((a) => a.id).filter((x) => x !== session.id);
    await pushNotify(others, "meeting", {
      title: `회의가 열렸습니다 — ${String(payload.title ?? "").trim().slice(0, 60)}`,
      body: `${session.name.replace(/ \(Claude\)$/, "")} 님이 열었습니다. 눌러서 들어가기`, url: `/v3/room/${id}`, tag: `meeting-${id}`,
    });
    return NextResponse.json({ id });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
