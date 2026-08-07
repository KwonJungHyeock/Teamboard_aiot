// 개인 메모 목록·생성 (MD-P-2026-025 §C).
//
// 모든 쿼리에 `owner_actor_id = $viewer` 가 붙는다. 예외 없다 — 팀장도 예외가 아니다.
// 조건을 빠뜨릴 자리를 만들지 않으려고 이 파일에는 소유자 없는 조회를 두지 않는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { normalizeNoteBlocks, noteExcerpt, noteTitle } from "@/lib/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const rows = await query<{
      id: number; title: string; body: unknown; updated_at: string; created_at: string;
    }>(
      `SELECT id, title, body, updated_at::text, created_at::text
         FROM note
        WHERE owner_actor_id = $1 AND is_active = true
        ORDER BY updated_at DESC
        LIMIT 200`,
      [session.id]
    );
    return NextResponse.json({
      notes: rows.map((r) => ({
        id: r.id,
        title: noteTitle(r.title, r.body),
        excerpt: noteExcerpt(r.body),
        updatedAt: r.updated_at,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    const title = String(payload.title ?? "").slice(0, 200);
    const blocks = normalizeNoteBlocks(payload.blocks);
    const row = await queryOne<{ id: number }>(
      `INSERT INTO note (owner_actor_id, title, body) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [session.id, title, JSON.stringify(blocks)]
    );
    // 활동 로그를 남기지 않는다 — 개인 메모는 팀 활동이 아니다.
    // 남기면 제목이 없어도 "누가 메모를 만들었다"가 팀에 보인다.
    return NextResponse.json({ id: row!.id });
  } catch (error) {
    return jsonError(error);
  }
}
