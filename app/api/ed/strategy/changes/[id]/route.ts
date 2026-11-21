// 운영 전략 승인 대기 처리: PATCH { action: "approve" | "reject" } (팀장만)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { decideChange } from "@/lib/strategy";
import { agentBlocked, fail } from "../../_err";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const blocked = agentBlocked(s); if (blocked) return blocked;
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    await decideChange(s, id, b.action);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
