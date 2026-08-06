import { NextResponse } from "next/server";
import { AuthError } from "./auth";
import { UnknownPropertyTypeError } from "./notion-schema";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Notion 속성 타입 미확정 — 스키마 새로고침 안내 (400)
  if (error instanceof UnknownPropertyTypeError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  // DB 가드가 거부한 요청은 서버 장애가 아니라 잘못된 입력이다 → 409 (MD-P-2026-024 §2).
  // 대상: 업무 구조 트리거(깊이 2단·차단 순환·하위 있는 상위 삭제)가 던지는 예외.
  // 메시지가 사용자용 한국어인 우리 가드만 통과시키고, 그 외 제약 위반은 500 그대로 둔다.
  if (isTaskGuardViolation(error)) {
    return NextResponse.json({ error: (error as Error).message }, { status: 409 });
  }
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  console.error("[api]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}

/** 업무 구조 가드(0023 트리거)가 던진 예외인가 — 사용자 입력 문제이므로 409 로 돌린다. */
function isTaskGuardViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code !== "23514" && code !== "23503") return false;   // check / foreign_key violation
  return /하위 업무|차단 관계|깊이 2단/.test(error.message);
}
