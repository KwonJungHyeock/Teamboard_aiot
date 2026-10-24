// 월간 보고 — 팀장 확인 · 한 줄 코멘트 (0042). 팀장 · 관리자만, 낸 보고에만.
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { leadReview, MonthlyError } from "@/lib/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    if (!(hasLead(live.user.role) || live.user.adminGrant))
      return NextResponse.json({ error: "보고 확인은 팀장이 합니다." }, { status: 403 });
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "보고를 찾을 수 없습니다." }, { status: 404 });
    const p = await request.json().catch(() => ({}));
    return NextResponse.json({ report: await leadReview(id, { id: live.user.id, name: live.user.name }, p.comment) });
  } catch (e) {
    return e instanceof MonthlyError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e);
  }
}
