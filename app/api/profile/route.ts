// 개별 프로필 (신규) — 본인만. 이름(display_name)·닉네임(short_name)만 수정.
// email·role·is_active 는 여기서 못 바꾼다 (lead 전용 /members 유지).
// 항상 세션 본인(session.id)만 갱신하므로 타인 수정은 구조적으로 불가(403 요건 충족).
// 비밀번호 변경은 기존 POST /api/account/password 재사용.
import { NextResponse } from "next/server";
import { requireSession, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { query } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();
    const name = String(payload.name ?? "").trim().slice(0, 60);
    const shortName = String(payload.shortName ?? "").trim().slice(0, 30);
    if (!name) return NextResponse.json({ error: "이름을 입력하세요." }, { status: 400 });

    await query(
      "UPDATE actor SET display_name = $1, short_name = $2 WHERE id = $3 AND type = 'human'",
      [name, shortName || null, session.id]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name} 프로필 수정 — 이름 "${name}"${shortName ? ` · 닉네임 "${shortName}"` : ""}`,
      level: "info",
    });

    // 세션 name 재발급 — 인사말·담당 표시 등이 재로그인 없이 즉시 반영되도록
    const response = NextResponse.json({ ok: true, name, shortName });
    response.cookies.set(SESSION_COOKIE, createSessionToken({ ...session, name }), {
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
