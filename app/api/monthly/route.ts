// 월간 보고(개인 · 0042). 내 보고 읽기 · 쓰기 · AI 초안 · 내기 · 되돌리기. 팀장은 낸 보고 목록도 받는다.
//   GET  ?m=YYYY-MM              { mine, team? }   team 은 팀장 · 관리자에게만
//   PUT  { month, body }         내 보고 저장(쓰는 중)
//   POST { month, action }       action: ai | submit | withdraw
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { checkMonth, draftWithAI, getMine, listSubmitted, MonthlyError, saveBody, submit, withdraw } from "@/lib/monthly";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const lead = (u: { role: string; adminGrant: boolean }) => hasLead(u.role) || u.adminGrant;
const fail = (e: unknown) => (e instanceof MonthlyError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e));

export async function GET(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const month = checkMonth(new URL(request.url).searchParams.get("m"));
    return NextResponse.json({ month, mine: await getMine(live.user.id, month),
      team: lead(live.user) ? await listSubmitted(month) : null });
  } catch (e) { return fail(e); }
}

export async function PUT(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const p = await request.json().catch(() => ({}));
    const month = checkMonth(p.month);
    const cur = await getMine(live.user.id, month);
    if (cur?.status === "submitted") throw new MonthlyError("낸 보고는 고칠 수 없습니다. 되돌린 뒤에 고치세요.", 409);
    return NextResponse.json({ mine: await saveBody(live.user.id, month, p.body) });
  } catch (e) { return fail(e); }
}

export async function POST(request: Request) {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    const p = await request.json().catch(() => ({}));
    const month = checkMonth(p.month);
    const u = live.user;
    if (p.action === "ai") return NextResponse.json({ mine: await draftWithAI(u.id, u.name, month) });
    if (p.action === "submit") return NextResponse.json({ mine: await submit(u.id, u.name, month) });
    if (p.action === "withdraw") return NextResponse.json({ mine: await withdraw(u.id, month) });
    throw new MonthlyError("할 수 없는 일입니다.");
  } catch (e) { return fail(e); }
}
