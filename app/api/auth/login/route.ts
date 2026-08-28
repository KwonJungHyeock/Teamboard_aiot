import { NextResponse } from "next/server";
import { authenticate, createSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();
    if (!email || !password) {
      return NextResponse.json({ error: "이메일과 비밀번호를 입력하세요." }, { status: 400 });
    }
    const user = await authenticate(email, password);
    if (!user) {
      return NextResponse.json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });
    }
    const response = NextResponse.json({ user });
    response.cookies.set(SESSION_COOKIE, createSessionToken(user), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
    // 기록은 best-effort 다. 로그인은 이미 성공했고 쿠키도 실렸다.
    // 마이그레이션이 깨진 상태에서는 이 쓰기가 던진다 — 그때 로그인까지
    // 500 이 되면 §5 예외를 둔 의미가 없다.
    try {
      await logActivity({ userId: user.id, message: `${user.name} 로그인`, level: "info" });
    } catch (err) {
      // **삼켜도 되는 이유** — 로그인은 이미 성공했고 쿠키도 response 에 실렸다.
      // 기록은 그 사실을 남기는 부수 작업이다. 마이그레이션이 깨진 상태에서는
      // 이 쓰기가 던지는데(B-29 §5), 그때 로그인까지 500 이 되면 예외를 둔
      // 의미가 없다 — 사람이 들어와서 원인을 볼 수 없게 된다.
      // 삼키되 **조용히는 아니다** — 빈 catch 는 다음 사람에게 이유를 안 남긴다.
      console.error(
        `[auth] 로그인은 성공했으나 활동 기록에 실패 — actor#${user.id}: ` +
        (err instanceof Error ? err.message : String(err))
      );
    }
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
