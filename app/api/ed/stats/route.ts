// 성과 분석 숫자 — 팀장 · 관리자만 (화면과 같은 문)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { kstToday } from "@/lib/home";
import { getStats } from "@/lib/ed/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const s = requireSession();
    if (!hasLead(s.role) && !s.adminGrant) return NextResponse.json({ error: "팀장만 볼 수 있습니다." }, { status: 403 });
    const today = kstToday();
    const m = new URL(request.url).searchParams.get("month") ?? "";
    const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(m) ? m : today.slice(0, 7);
    return NextResponse.json(await getStats(s.id, month, today));
  } catch (error) { return jsonError(error); }
}
