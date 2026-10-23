// 내 카테고리 만들기 (0037). 같은 이름이 있으면 그걸 돌려준다 — 두 번 눌러도 하나다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { ensureCategory, WorklogInputError } from "@/lib/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json({ category: await ensureCategory(session.id, String(payload.name ?? "")) });
  } catch (error) {
    if (error instanceof WorklogInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return jsonError(error);
  }
}
