// 운영 전략 API 공통: 규칙 오류는 사람 말로, 에이전트를 거친 세션은 쓰기 막음(자동 반영 없음)
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/api";
import { viaClaude } from "@/lib/claude-guard";
import { StrategyError } from "@/lib/strategy";
import type { SessionUser } from "@/lib/types";

export function fail(e: unknown) {
  if (e instanceof StrategyError) return NextResponse.json({ error: e.message }, { status: e.status });
  return jsonError(e);
}
export function agentBlocked(s: SessionUser) {
  return viaClaude(s) ? NextResponse.json({ error: "운영 전략은 화면에서 직접 고쳐 주세요." }, { status: 403 }) : null;
}
