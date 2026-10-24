// 월간 보고 AI 초안 — **흘려 보낸다**(text/plain 조각). 끝나면 서버가 본문 저장 + ai_at.
// 보내는 것: 그 달 내 기록 · 끝낸 업무 제목 · 들어간 회의 이름(lib/monthly.ts facts). 첨부 파일은 보내지 않는다.
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { streamText } from "@/lib/llm";
import { checkMonth, demoDraft, draftHeader, draftReady, draftUser, MonthlyError, saveDraft, SYSTEM } from "@/lib/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const p = await request.json().catch(() => ({}));
    const month = checkMonth(p.month);
    const { id, name } = live.user;
    const f = await draftReady(id, month);
    const head = draftHeader(name, month);
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        let text = "";
        try {
          ctrl.enqueue(enc.encode(head));
          for await (const chunk of streamText(SYSTEM, draftUser(name, month, f), () => demoDraft(f))) {
            text += chunk;
            ctrl.enqueue(enc.encode(chunk));
          }
          await saveDraft(id, month, `${head}${text.trim()}`);
        } catch (e) {
          // 흘리던 중 끊기면 쓴 데까지는 남기고, 끝에 표식을 붙인다 — 화면이 오류로 읽는다
          if (text.trim()) await saveDraft(id, month, `${head}${text.trim()}`).catch(() => {});
          ctrl.enqueue(enc.encode(`\n\u0000${e instanceof Error ? e.message : "AI 초안을 만들지 못했습니다"}`));
        }
        ctrl.close();
      },
    });
    return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
  } catch (e) {
    return e instanceof MonthlyError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e);
  }
}
