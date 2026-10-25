// OAuth 찾기 주소(/.well-known/oauth-*) — 우리는 OAuth 를 안 쓴다(연결 키 = Bearer 헤더).
// Claude 데스크톱이 쓰는 mcp-remote 는 연결 전에 이 주소를 먼저 묻는데, 로그인 화면(HTML)이
// 돌아오면 JSON 으로 읽다가 죽는다(2026-10). 그래서 「없음」을 JSON 404 로 분명히 답한다.
import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
