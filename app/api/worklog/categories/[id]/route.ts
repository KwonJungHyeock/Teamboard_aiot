// 내 카테고리 — 이름·색 바꾸기 · 숨기기 (0037). 숨기면 그 기록은 「분류 없음」으로 남는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hideCategory, renameCategory, WorklogInputError } from "@/lib/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id);
    if (!id || !(await renameCategory(session.id, id, await request.json().catch(() => ({}))))) {
      return new NextResponse(null, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof WorklogInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = idOf(params.id);
    if (!id || !(await hideCategory(session.id, id))) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
