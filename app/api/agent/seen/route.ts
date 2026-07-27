// 완료 알림 확인 — FAB 알림 탭을 열면 미확인 완료를 seen 처리(배지 해제). 본인 것만.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { markSeen } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const session = requireSession();
    await markSeen(session.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
