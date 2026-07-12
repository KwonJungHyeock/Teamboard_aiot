import { NextResponse } from "next/server";
import { AuthError } from "./auth";

export function jsonError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "알 수 없는 오류";
  console.error("[api]", error);
  return NextResponse.json({ error: message }, { status: 500 });
}
