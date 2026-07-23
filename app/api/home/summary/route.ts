// 홈 대시보드 요약 (Phase 3) — 집계는 lib/home.ts, 수치는 전부 DB 산출
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { buildHomeSummary } from "@/lib/home";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const session = requireSession();
    const summary = await buildHomeSummary(session.id);
    return NextResponse.json(summary);
  } catch (error) {
    return jsonError(error);
  }
}
