// 리뷰 세션 상세(GET) · 항목 추가(POST, lead 전용)
import { NextResponse } from "next/server";
import { requireSession, requireLead } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getReviewSession, addReviewItem } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const detail = await getReviewSession(Number(params.id));
    if (!detail) return NextResponse.json({ error: "세션을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json(detail);
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    requireLead(); // 항목(안건) 추가 = lead
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    if (!name) return NextResponse.json({ error: "항목 이름을 입력하세요." }, { status: 400 });
    const itemId = await addReviewItem(Number(params.id), name);
    return NextResponse.json({ id: itemId });
  } catch (e) {
    return jsonError(e);
  }
}
