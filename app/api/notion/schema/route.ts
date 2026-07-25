// Notion 스키마 선택지 (Phase 9) — 승인 모달 드롭다운용. 캐시 우선(TTL 24h), 폴백 안전.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getResolvedSchema } from "@/lib/notion-schema-cache";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireSession();
    const result = await getResolvedSchema();
    // 파트 Z — 토큰 유무로 Notion UI 자동 분기 (미연결 시 승인 모달의 Notion 문구 숨김)
    return NextResponse.json({ ...result, notionConnected: !!process.env.NOTION_TOKEN });
  } catch (error) {
    return jsonError(error);
  }
}
