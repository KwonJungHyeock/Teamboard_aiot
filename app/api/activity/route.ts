// 실시간 활동 로그 — 본인 로그 (팀장은 scope=all로 전체)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { recentActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const all = url.searchParams.get("scope") === "all" && session.role === "lead";
    const entries = await recentActivity(30, all ? undefined : session.id);
    return NextResponse.json({ entries });
  } catch (error) {
    return jsonError(error);
  }
}
