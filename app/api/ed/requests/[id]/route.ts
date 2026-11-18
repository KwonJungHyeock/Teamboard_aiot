// 업무 요청 처리 — PATCH { action: "accept", areaId? } · { action: "decline", reply? } · { action: "cancel" }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { viaClaude } from "@/lib/claude-guard";
import { acceptRequest, cancelRequest, declineRequest, RequestError } from "@/lib/task-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    // 에이전트를 거친 세션은 남에게 일을 부탁하거나 대신 수락 · 거절하지 않는다(사람이 직접)
    if (viaClaude(s)) return NextResponse.json({ error: "업무 요청은 화면에서 직접 해 주세요." }, { status: 403 });
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    const r = b.action === "accept" ? await acceptRequest(s, id, b.areaId)
      : b.action === "decline" ? await declineRequest(s, id, b.reply)
      : b.action === "cancel" ? await cancelRequest(s, id)
      : null;
    if (!r) return NextResponse.json({ error: "알 수 없는 처리입니다." }, { status: 400 });
    return NextResponse.json({ request: r });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
