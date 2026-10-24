// Claude 연결 키 끊기 — 내 키만. 남의 키 번호를 넣으면 없는 것처럼 404.
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { revokeToken } from "@/lib/api-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: { id: string } }) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0 || !(await revokeToken(live.user.id, id)))
      return NextResponse.json({ error: "키를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
