// 업무기록 한 줄 — 고치기 · 지우기 (0037). 남의 줄이면 **없는 것처럼** 404 다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { deleteEntry, updateEntry, WorklogInputError } from "@/lib/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id);
    if (!id) return new NextResponse(null, { status: 404 });
    const entry = await updateEntry(session.id, id, await request.json().catch(() => ({})));
    if (!entry) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ entry });
  } catch (error) {
    if (error instanceof WorklogInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id);
    if (!id || !(await deleteEntry(session.id, id))) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
