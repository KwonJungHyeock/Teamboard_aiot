// 월간 보고 「팀원 보고」 — 팀원 전부의 그 달 상태(팀장 · 관리자만). 확인 · 코멘트는 `/api/monthly/:id` PATCH.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { checkMonth, MonthlyError, teamStatus } from "@/lib/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const s = requireSession();
    if (!(hasLead(s.role) || s.adminGrant)) return NextResponse.json({ error: "팀장만 봅니다." }, { status: 403 });
    const month = checkMonth(new URL(request.url).searchParams.get("m"));
    return NextResponse.json({ month, team: await teamStatus(month, s.id) });
  } catch (e) {
    return e instanceof MonthlyError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e);
  }
}
