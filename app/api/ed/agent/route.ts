// 앱 안 에이전트 — POST { turns: [{ role, text }] } → NDJSON 줄(도구 진행 · 답 · 끝).
// 로그인한 사람으로만, 쓰기는 Claude 울타리(나 · 개인)를 거친다 (lib/agent.ts).
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { claudeCall } from "@/lib/claude-call";
import { runAgent, type Turn } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const p = await request.json().catch(() => ({}));
    const turns: Turn[] = (Array.isArray(p.turns) ? p.turns : [])
      .filter((m: Turn) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string" && m.text.trim())
      .map((m: Turn) => ({ role: m.role, text: m.text.slice(0, 4000) }));
    if (!turns.length || turns[turns.length - 1].role !== "user") return NextResponse.json({ error: "물어볼 말이 없습니다." }, { status: 400 });
    const call = claudeCall(new URL(request.url).origin, live.user);
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        try {
          for await (const ev of runAgent(turns, { id: live.user.id, name: live.user.name }, call)) ctrl.enqueue(enc.encode(`${JSON.stringify(ev)}\n`));
        } catch (e) {
          console.error("[agent]", e);
          ctrl.enqueue(enc.encode(`${JSON.stringify({ t: "error", d: "AI 에 연결하지 못했습니다." })}\n${JSON.stringify({ t: "done" })}\n`));
        }
        ctrl.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (e) { return jsonError(e); }
}
