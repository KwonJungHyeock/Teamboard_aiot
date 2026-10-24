// LIVE 티커 — 팀 최신 활동 몇 줄. 남의 개인 업무 줄은 빠진다(recentActivity 가 거른다).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { recentActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = requireSession();
    // 사람이 한 일만 — 보안 · 시스템 줄(이름 없음)은 티커에 올리지 않는다
    const rows = (await recentActivity(20, undefined, s.id)).filter((r) => r.user_name && r.level !== "warn" && r.level !== "error").slice(0, 8);
    return NextResponse.json({
      entries: rows.map((r) => ({ id: r.id, who: r.user_name, message: r.message, at: r.created_at, taskId: r.task_id, userId: r.user_id })),
    });
  } catch (error) { return jsonError(error); }
}
