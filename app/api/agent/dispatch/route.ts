// 에이전트 위임 (FAB) — 전원 사용(1인 1에이전트). 결과는 승인 대기 초안으로 등록.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { dispatchJob, CreditError, type AgentJobType } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60; // 초안 생성 대기 (Vercel Hobby 상한)

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();
    const type: AgentJobType = payload.type === "organize" ? "organize" : "research";
    const prompt = String(payload.prompt ?? "").trim();

    if (!prompt) {
      return NextResponse.json({ error: "지시 내용을 입력하세요." }, { status: 400 });
    }
    if (prompt.length > 2000) {
      return NextResponse.json({ error: "지시가 너무 깁니다. (2000자 이내)" }, { status: 400 });
    }

    const job = await dispatchJob({ userId: session.id, userName: session.name, type, prompt });
    return NextResponse.json({ job });
  } catch (error) {
    // 크레딧 부족 — graceful(402). FAB가 안내 문구로 표시.
    if (error instanceof CreditError) {
      return NextResponse.json({ error: error.message, code: "credit" }, { status: 402 });
    }
    return jsonError(error);
  }
}
