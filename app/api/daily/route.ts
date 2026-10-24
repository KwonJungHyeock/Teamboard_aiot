// 하루 한 줄 · 상태 (0039). 읽기는 팀원 누구나(관제에 뜬다), 쓰기는 **내 줄만**.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { DailyError, setMyDay, todayNotes } from "@/lib/daily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireSession();
    return NextResponse.json({ notes: Object.fromEntries(await todayNotes()) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json({ note: await setMyDay(session.id, payload ?? {}) });
  } catch (error) {
    if (error instanceof DailyError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
