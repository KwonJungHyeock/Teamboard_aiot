// 자동 로그인 링크 (기획자 편의) — 링크에 담긴 계정/비밀번호로 서버가 검증 후 세션 쿠키를 심고 홈으로.
// 공개 저장소라 라우트 자체는 보이지만, 유효한 계정+비밀번호가 있어야만 동작한다(코드에 비밀 없음).
// 사용: /api/auth/auto-login?e=<email/id>&pw=<password>  (없으면 로그인 화면으로).
// 비밀번호를 바꾸면 기존 링크는 즉시 무효화된다.
import { NextResponse } from "next/server";
import { authenticate, createSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const email = (url.searchParams.get("e") ?? url.searchParams.get("email") ?? "").trim();
  const pw = url.searchParams.get("pw") ?? url.searchParams.get("k") ?? "";
  const origin = url.origin;

  if (!email || !pw) {
    return NextResponse.redirect(`${origin}/login`);
  }
  const user = await authenticate(email, pw);
  if (!user) {
    return NextResponse.redirect(`${origin}/login?reason=autofail`);
  }
  const res = NextResponse.redirect(`${origin}/`);
  res.cookies.set(SESSION_COOKIE, createSessionToken(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
