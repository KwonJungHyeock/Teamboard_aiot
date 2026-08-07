// 개인 메모 상세·저장·삭제 (MD-P-2026-025 §C).
//
// 남의 메모는 **404**. 403 이면 "그 id 는 존재한다"를 알려주는 셈이다 (§A3 ⑨ 와 같은 규칙).
// 낙관적 동시성은 업무 문서(app/api/tasks/[id]/doc)와 같은 baseUpdatedAt 방식이다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { normalizeNoteBlocks } from "@/lib/notes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "메모를 찾을 수 없습니다." };

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
    const row = await queryOne<{ id: number; title: string; body: unknown; updated_at: string }>(
      `SELECT id, title, body, updated_at::text FROM note
        WHERE id = $1 AND owner_actor_id = $2 AND is_active = true`,
      [id, session.id]
    );
    if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });
    const blocks = Array.isArray(row.body) ? row.body : [];
    return NextResponse.json({
      note: { id: row.id, title: row.title, blocks, updatedAt: row.updated_at },
      // DocEditor 가 읽는 모양 그대로 함께 싣는다 — 편집기를 고치지 않고 그대로 쓰기 위함.
      blocks,
      updatedAt: row.updated_at,
      // 메모는 blob 스코프('note')가 없어 이미지 블록을 허용하지 않는다 (백로그 B-6).
      // 편집기는 blobReady=false 면 이미지 명령을 막는다 — 별도 장치를 만들지 않는다.
      blobReady: false,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
    const payload = await request.json();

    // 내 메모인지 먼저 확인 — 남의 것이면 존재 여부도 알리지 않는다.
    const cur = await queryOne<{ updated_at: string }>(
      `SELECT updated_at::text FROM note WHERE id = $1 AND owner_actor_id = $2 AND is_active = true`,
      [id, session.id]
    );
    if (!cur) return NextResponse.json(NOT_FOUND, { status: 404 });

    // 동시 편집 보호 — 업무 문서·캔버스와 같은 규칙 (MD-P-2026-013).
    if (typeof payload.baseUpdatedAt === "string") {
      if (cur.updated_at !== payload.baseUpdatedAt) {
        return NextResponse.json({
          error: "다른 창에서 먼저 저장했어요. 최신 내용을 불러온 뒤 다시 편집하세요.",
          conflict: true,
          serverUpdatedAt: cur.updated_at,
        }, { status: 409 });
      }
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    if (typeof payload.title === "string") {
      values.push(payload.title.slice(0, 200));
      sets.push(`title = $${values.length}`);
    }
    if (payload.blocks !== undefined) {
      values.push(JSON.stringify(normalizeNoteBlocks(payload.blocks)));
      sets.push(`body = $${values.length}::jsonb`);
    }
    if (sets.length === 0) return NextResponse.json({ ok: true, updatedAt: cur.updated_at });

    values.push(id, session.id);
    const saved = await query<{ updated_at: string }>(
      `UPDATE note SET ${sets.join(", ")}, updated_at = now()
        WHERE id = $${values.length - 1} AND owner_actor_id = $${values.length}
        RETURNING updated_at::text`,
      values
    );
    return NextResponse.json({ ok: true, updatedAt: saved[0]?.updated_at ?? null });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
    // 소프트 삭제 — 업무와 같은 방식. 실수로 지운 것을 되살릴 여지를 남긴다.
    const done = await query<{ id: number }>(
      `UPDATE note SET is_active = false, updated_at = now()
        WHERE id = $1 AND owner_actor_id = $2 AND is_active = true RETURNING id`,
      [id, session.id]
    );
    if (done.length === 0) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
