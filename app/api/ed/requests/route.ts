// 업무 요청 — GET: 받은 · 보낸 요청 + 대기 수 / POST: 요청 보내기 { toId, title, body?, dueDate?, priority? }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { viaClaude } from "@/lib/claude-guard";
import { createRequest, listRequests, pendingCount, RequestError } from "@/lib/task-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const s = requireSession();
    if (new URL(request.url).searchParams.get("count") === "1") return NextResponse.json({ pending: await pendingCount(s.id) });
    const { received, sent } = await listRequests(s.id);
    return NextResponse.json({ received, sent, pending: received.filter((r) => r.status === "pending").length });
  } catch (e) { return jsonError(e); }
}

export async function POST(request: Request) {
  try {
    const s = requireSession();
    // 에이전트를 거친 세션은 남에게 일을 부탁하거나 대신 수락 · 거절하지 않는다(사람이 직접)
    if (viaClaude(s)) return NextResponse.json({ error: "업무 요청은 화면에서 직접 해 주세요." }, { status: 403 });
    const req = await createRequest(s, await request.json().catch(() => ({})));
    return NextResponse.json({ request: req });
  } catch (e) {
    if (e instanceof RequestError) return NextResponse.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
