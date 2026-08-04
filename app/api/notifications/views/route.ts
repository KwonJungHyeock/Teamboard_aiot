// 저장된 뷰 (MD-P-2026-007 §D) — 현재 필터 조합에 이름을 붙여 필터 레일 하단에 고정.
// 기본 제공 2개("내 멘션만", "오늘 처리할 것")는 클라이언트 내장이며 여기 저장되지 않는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const rows = await query<{ id: number; name: string; filter: Record<string, unknown> }>(
      `SELECT id, name, filter FROM saved_view WHERE user_id = $1 ORDER BY created_at`,
      [session.id]
    );
    return NextResponse.json({ views: rows });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const name = String(body.name ?? "").trim().slice(0, 40);
    if (!name) return NextResponse.json({ error: "뷰 이름을 입력하세요." }, { status: 400 });
    const filter = body.filter && typeof body.filter === "object" ? body.filter : {};
    const dup = await queryOne<{ id: number }>(
      `SELECT id FROM saved_view WHERE user_id = $1 AND name = $2`, [session.id, name]
    );
    if (dup) return NextResponse.json({ error: "같은 이름의 뷰가 이미 있어요." }, { status: 409 });
    const row = await queryOne<{ id: number }>(
      `INSERT INTO saved_view (user_id, name, filter) VALUES ($1,$2,$3::jsonb) RETURNING id`,
      [session.id, name, JSON.stringify(filter)]
    );
    return NextResponse.json({ id: row!.id, name, filter });
  } catch (error) {
    return jsonError(error);
  }
}

/** 이름 변경 — { id, name } */
export async function PATCH(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const id = Number(body.id);
    const name = String(body.name ?? "").trim().slice(0, 40);
    if (!Number.isInteger(id) || !name) {
      return NextResponse.json({ error: "id와 이름이 필요합니다." }, { status: 400 });
    }
    const rows = await query<{ id: number }>(
      `UPDATE saved_view SET name = $1 WHERE id = $2 AND user_id = $3 RETURNING id`,
      [name, id, session.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: "뷰를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = requireSession();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    await query(`DELETE FROM saved_view WHERE id = $1 AND user_id = $2`, [id, session.id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
