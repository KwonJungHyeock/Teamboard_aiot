// 비밀번호 변경 (Phase 8) — 본인. 최초 로그인 강제 변경 및 일반 변경 공용.
// 현재 비밀번호 검증 → 새 비밀번호 해시 저장 → must_change_pw=false → 세션 재발급.
import { NextResponse } from "next/server";
import { requireSession, verifyPassword, hashPassword, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "현재/새 비밀번호를 입력하세요." }, { status: 400 });
    }
    if (String(newPassword).length < 8) {
      return NextResponse.json({ error: "새 비밀번호는 8자 이상이어야 합니다." }, { status: 400 });
    }

    const acc = await queryOne<{ password_hash: string }>(
      "SELECT password_hash FROM account WHERE actor_id = $1",
      [session.id]
    );
    if (!acc || !verifyPassword(String(currentPassword), acc.password_hash)) {
      return NextResponse.json({ error: "현재 비밀번호가 올바르지 않습니다." }, { status: 403 });
    }
    if (verifyPassword(String(newPassword), acc.password_hash)) {
      return NextResponse.json({ error: "이전과 다른 비밀번호를 사용하세요." }, { status: 400 });
    }

    await query("UPDATE account SET password_hash = $1, must_change_pw = false WHERE actor_id = $2", [
      hashPassword(String(newPassword)),
      session.id,
    ]);
    await logActivity({ userId: session.id, message: `${session.name} 비밀번호 변경`, level: "info" });

    // 세션 재발급 (변경 직후 재로그인 없이 이어가도록)
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
