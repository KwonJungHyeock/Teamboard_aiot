// 주간 브리핑 — 읽기는 팀원 누구나, 만들기도 누구나(한 주에 처음 한 번). 다시 만들기는 팀장만.
//   GET  ?week=this|last       그 주의 브리핑(없으면 null)
//   POST { week: this|last }   만들기 — 이미 있으면 팀장만 다시 만든다(AI 를 한 번 더 부른다)
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { getBrief, makeBrief, weekOf } from "@/lib/brief";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pick = (v: unknown) => weekOf(v === "this" ? 0 : -1);

export async function GET(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const w = pick(new URL(request.url).searchParams.get("week"));
    return NextResponse.json({ week: w, brief: await getBrief(w.start) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const payload = await request.json().catch(() => ({}));
    const w = pick(payload.week);
    const had = await getBrief(w.start);
    if (had && !hasLead(live.user.role))
      return NextResponse.json({ error: "이미 만든 브리핑입니다. 다시 만들기는 팀장이 합니다." }, { status: 403 });
    return NextResponse.json({ week: w, brief: await makeBrief(w.start, w.end, { id: live.user.id, name: live.user.name }) });
  } catch (error) {
    return jsonError(error);
  }
}
