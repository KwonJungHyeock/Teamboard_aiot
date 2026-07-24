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
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  console.error("[api]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}
