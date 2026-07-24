// Notion 스키마 강제 새로고침 (Phase 9) — /settings의 "Notion 스키마 새로고침" 버튼. lead 전용.
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { getSchemaOptions } from "@/lib/notion-schema-cache";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    const session = requireLead();
    const result = await getSchemaOptions({ forceRefresh: true });
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) Notion 스키마 새로고침 (source: ${result.source}, drift ${result.drift.length}건)`,
    });
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
