// Notion 연동 범위 — 조회는 로그인 사용자, 수정은 팀장만 (PRD 11장 2항)
import { NextResponse } from "next/server";
import { requireLead, requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireSession();
    const row = await queryOne<{ value: any; updated_at: string }>(
      "SELECT value, updated_at FROM app_settings WHERE key = 'notion_scope'"
    );
    return NextResponse.json({
      scope: row?.value ?? {
        dataSourceId: process.env.NOTION_TIMELINE_DS_ID ?? null,
        label: "🗓️ 팀 업무 타임라인",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = requireLead();
    const payload = await request.json();
    const dataSourceId = String(payload.dataSourceId ?? "").trim();
    const label = String(payload.label ?? "").trim().slice(0, 100) || "팀 업무 타임라인";
    if (!dataSourceId) {
      return NextResponse.json({ error: "data source id를 입력하세요." }, { status: 400 });
    }

    const value = { dataSourceId, label };
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at)
       VALUES ('notion_scope', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`,
      [JSON.stringify(value), session.id]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) Notion 연동 범위 변경 → ${label} (${dataSourceId})`,
      level: "warn",
    });
    return NextResponse.json({ scope: value });
  } catch (error) {
    return jsonError(error);
  }
}
