// 읽음 표시 (MD-P-2026-006 §F) — 목록별 "여기까지 읽음" 기준선.
// scope 예: 'activity' · 'signals' · 'project:12'. 사용자×scope 당 한 줄만 유지한다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const rows = await query<{ scope: string; read_at: string }>(
      `SELECT scope, read_at::text FROM read_marker WHERE user_id = $1`,
      [session.id]
    );
    const markers: Record<string, string> = {};
    for (const r of rows) markers[r.scope] = r.read_at;
    return NextResponse.json({ markers });
  } catch (error) {
    return jsonError(error);
  }
}

/** 목록을 읽음 처리 — Esc 또는 목록 이탈 시 호출된다. at 생략 시 now(). */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json().catch(() => ({}));
    const scope = String(body.scope ?? "").trim().slice(0, 60);
    if (!scope) return NextResponse.json({ error: "scope가 필요합니다." }, { status: 400 });
    const at = typeof body.at === "string" && body.at ? body.at : null;
    const row = await query<{ read_at: string }>(
      `INSERT INTO read_marker (user_id, scope, read_at)
       VALUES ($1, $2, COALESCE($3::timestamptz, now()))
       ON CONFLICT (user_id, scope)
       DO UPDATE SET read_at = GREATEST(read_marker.read_at, EXCLUDED.read_at)
       RETURNING read_at::text`,
      [session.id, scope, at]
    );
    return NextResponse.json({ scope, readAt: row[0]?.read_at ?? null });
  } catch (error) {
    return jsonError(error);
  }
}
