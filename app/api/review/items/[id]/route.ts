// 리뷰 항목 — 필드 수정(PUT) · 확정 승격(POST promote) · 삭제(DELETE)
// 옵션·이미지 수정 = 전원 / decision 변경·확정·삭제 = lead
import { NextResponse } from "next/server";
import { requireSession, requireLead } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { updateReviewItem, deleteReviewItem, promoteItemToSignal, type Decision } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS: Decision[] = ["none", "done", "rev", "hold"];

function normUrl(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return null;
  return /^https?:\/\//.test(s) ? s.slice(0, 1000) : undefined; // http(s)만
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const body = await request.json();
    const itemId = Number(params.id);
    // decision 변경(확정/수정/보류)은 lead. 옵션·이미지는 전원.
    if (body.decision !== undefined) {
      requireLead();
      if (!DECISIONS.includes(body.decision)) {
        return NextResponse.json({ error: "잘못된 결정 값" }, { status: 400 });
      }
      await updateReviewItem(itemId, { decision: body.decision });
      return NextResponse.json({ ok: true });
    }
    requireSession();
    const fields: Parameters<typeof updateReviewItem>[1] = {};
    if (body.optionText !== undefined) fields.optionText = String(body.optionText);
    const bu = normUrl(body.beforeUrl); if (bu !== undefined) fields.beforeUrl = bu;
    const au = normUrl(body.afterUrl); if (au !== undefined) fields.afterUrl = au;
    await updateReviewItem(itemId, fields);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}

// 확정 → 논의·결정(signal) 자동 생성
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireLead();
    const body = await request.json().catch(() => ({}));
    if (body.action === "promote") {
      const signalId = await promoteItemToSignal(Number(params.id), session.id);
      return NextResponse.json({ signalId });
    }
    return NextResponse.json({ error: "알 수 없는 동작" }, { status: 400 });
  } catch (e) {
    return jsonError(e);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    requireLead();
    await deleteReviewItem(Number(params.id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
