// 운영 전략 항목: GET: 상세(이력 · 의견 · 고를 회의) / PATCH: { standard, reason?, meetingId?, meetingItemId? } 는 기준 변경,
// 그 밖의 칸 { title, axis, phase, status, linkUrl, ownerId, locked } 은 항목 고치기
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { changeStandard, getItem, recentMeetings, updateItem } from "@/lib/strategy";
import { agentBlocked, fail } from "../_err";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function GET(_: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const id = idOf(params.id); if (!id) return new NextResponse(null, { status: 404 });
    const d = await getItem(id);
    if (!d) return NextResponse.json({ error: "항목을 찾지 못했습니다." }, { status: 404 });
    return NextResponse.json({ ...d, meetings: await recentMeetings() });
  } catch (e) { return fail(e); }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const blocked = agentBlocked(s); if (blocked) return blocked;
    const id = idOf(params.id); if (!id) return new NextResponse(null, { status: 404 });
    const b = await request.json().catch(() => ({})) as Record<string, unknown>;
    if ("standard" in b) return NextResponse.json(await changeStandard(s, id, b));
    await updateItem(s, id, b);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
