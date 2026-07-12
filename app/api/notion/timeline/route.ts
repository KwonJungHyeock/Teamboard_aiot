// 팀 타임라인 조회 (화면 B) — Notion "팀 업무 타임라인" 전체 리스트 읽기
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryTimeline } from "@/lib/notion";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    requireSession();
    const items = await queryTimeline();
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}
