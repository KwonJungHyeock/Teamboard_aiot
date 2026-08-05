// 첫 사용 안내 표시 여부 (MD-P-2026-015 §A)
// GET  — 이 계정이 안내를 봐야 하는가
// POST — 봤음(또는 건너뜀)으로 표시. { reset: true } 면 다시 보기(⌘/ 하단 링크용)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryOne, query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const row = await queryOne<{ onboarded_at: string | null }>(
      `SELECT onboarded_at::text FROM account WHERE actor_id = $1`,
      [session.id]
    );
    return NextResponse.json({ show: !row?.onboarded_at });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json().catch(() => ({}));
    if (body?.reset === true) {
      await query(`UPDATE account SET onboarded_at = NULL WHERE actor_id = $1`, [session.id]);
      return NextResponse.json({ show: true });
    }
    await query(`UPDATE account SET onboarded_at = now() WHERE actor_id = $1`, [session.id]);
    return NextResponse.json({ show: false });
  } catch (error) {
    return jsonError(error);
  }
}
