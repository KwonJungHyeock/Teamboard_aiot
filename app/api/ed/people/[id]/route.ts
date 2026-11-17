// 팀원 상세 · 개인 성과 카드 — 팀장은 누구든, 팀원은 자기 것만. ?period=month|quarter&at=YYYY-MM
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { isLeadUser } from "@/lib/task-permission";
import { kstToday } from "@/lib/home";
import { personCard, type PeriodKind } from "@/lib/person-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    if (id !== s.id && !isLeadUser(s)) return NextResponse.json({ error: "다른 사람의 성과는 팀장만 봅니다." }, { status: 403 });
    const u = new URL(request.url);
    const kind: PeriodKind = u.searchParams.get("period") === "quarter" ? "quarter" : "month";
    const today = kstToday();
    const atRaw = u.searchParams.get("at") ?? "";
    const at = /^\d{4}-\d{2}$/.test(atRaw) ? `${atRaw}-01` : today;
    const card = await personCard(id, s.id, kind, at, today);
    if (!card) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ card, canLead: isLeadUser(s) });
  } catch (e) { return jsonError(e); }
}
