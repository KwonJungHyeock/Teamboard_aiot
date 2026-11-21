// 운영 전략 의견: POST { body }. 담당자 알림함에 한 줄
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { addComment } from "@/lib/strategy";
import { agentBlocked, fail } from "../../_err";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const blocked = agentBlocked(s); if (blocked) return blocked;
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    await addComment(s, id, b.body);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
