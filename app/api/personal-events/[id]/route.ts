// 개인 일정 수정·삭제 (MD-P-2026-025 §D).
// 남의 일정은 404 — 존재 자체를 알리지 않는다 (§A3 ⑨ 와 같은 규칙).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND = { error: "일정을 찾을 수 없습니다." };
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
    const payload = await request.json();

    const sets: string[] = [];
    const values: unknown[] = [];
    if (typeof payload.title === "string" && payload.title.trim()) {
      values.push(payload.title.trim().slice(0, 200));
      sets.push(`title = $${values.length}`);
    }
    if (isDate(payload.startDate)) {
      values.push(payload.startDate);
      sets.push(`starts_at = ($${values.length}::date)::timestamptz`);
    }
    if (isDate(payload.endDate)) {
      values.push(payload.endDate);
      sets.push(`ends_at = (($${values.length}::date) + 1)::timestamptz - interval '1 second'`);
    }
    if (sets.length === 0) return NextResponse.json({ ok: true });

    values.push(id, session.id);
    const done = await query<{ id: number }>(
      `UPDATE personal_event SET ${sets.join(", ")}
        WHERE id = $${values.length - 1} AND owner_actor_id = $${values.length} AND is_active = true
        RETURNING id`,
      values
    );
    if (done.length === 0) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
    const done = await query<{ id: number }>(
      `UPDATE personal_event SET is_active = false
        WHERE id = $1 AND owner_actor_id = $2 AND is_active = true RETURNING id`,
      [id, session.id]
    );
    if (done.length === 0) return NextResponse.json(NOT_FOUND, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
