// 업무 요청 처리 — PATCH { action: "accept", areaId?, done? } · { action: "remind" } · { action: "decline", reply? } · { action: "cancel" }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { viaClaude } from "@/lib/claude-guard";
import { acceptRequest, cancelRequest, declineRequest, remindRequest, RequestError } from "@/lib/task-request";
import { kstToday } from "@/lib/home";

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
    if (b.action === "remind") {
      const sent = await remindRequest(s, id, kstToday());
      return sent ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "오늘은 이미 다시 알렸습니다." }, { status: 429 });
    }
    const r = b.action === "accept" ? await acceptRequest(s, id, b.areaId, b.done === true)
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
