import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}

// GET — 서버측 세션 무효화(비활성 계정 등)에서 쿠키를 지우고 로그인으로 리디렉트.
// reason 쿼리를 /login에 그대로 전달해 사유를 표시한다.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason");
  const loginUrl = new URL("/login", url.origin);
  if (reason) loginUrl.searchParams.set("reason", reason);
  const response = NextResponse.redirect(loginUrl);
  response.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
