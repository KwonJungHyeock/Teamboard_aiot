// Notion 스키마 선택지 (Phase 9) — 승인 모달 드롭다운용. 캐시 우선(TTL 24h), 폴백 안전.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getSchemaOptions } from "@/lib/notion-schema-cache";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireSession();
    const result = await getSchemaOptions();
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
