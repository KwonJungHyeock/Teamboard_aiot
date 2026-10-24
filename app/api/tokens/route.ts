// Claude 연결 키 — 내 것만 보고, 만든다 (0040). 키 자체는 만들 때 한 번만 돌려준다.
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { createToken, listTokens, TokenError } from "@/lib/api-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    return NextResponse.json({ tokens: await listTokens(live.user.id) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    // 키는 쿠키보다 오래 산다 — 만들 때는 **지금 살아 있는 계정인지** DB 로 본다
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json(await createToken(live.user.id, payload.name));
  } catch (error) {
    if (error instanceof TokenError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
