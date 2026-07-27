// 리뷰 항목 코멘트 — 작성(POST). 코멘트·의견 = 전원(member 포함).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { addItemComment } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const body = await request.json();
    const text = String(body.body ?? "").trim();
    if (!text) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });
    const id = await addItemComment(Number(params.id), session.id, text);
    return NextResponse.json({ id });
  } catch (e) {
    return jsonError(e);
  }
}
