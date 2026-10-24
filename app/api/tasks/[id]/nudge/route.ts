// 확인 요청 — 맡긴 일의 담당에게 알림 한 번 (2026-10 리디자인 · 업무 상세 드로어)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { nudge, RevisionError } from "@/lib/revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    await nudge(Number(params.id), { id: s.id, name: s.name });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof RevisionError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
