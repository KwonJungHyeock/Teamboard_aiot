// 운영 전략: GET: 항목 전체(폐기 포함) + 내 권한 / POST: 항목 추가 { axis, phase, title, standard?, linkUrl?, meetingId?, meetingItemId? }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { isLeadUser } from "@/lib/task-permission";
import { canWrite, createItem, listItems } from "@/lib/strategy";
import { agentBlocked, fail } from "./_err";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = requireSession();
    return NextResponse.json({ items: await listItems(), me: { id: s.id, lead: isLeadUser(s), write: canWrite(s) } });
  } catch (e) { return fail(e); }
}

export async function POST(request: Request) {
  try {
    const s = requireSession();
    const blocked = agentBlocked(s); if (blocked) return blocked;
    const id = await createItem(s, await request.json().catch(() => ({})));
    return NextResponse.json({ id });
  } catch (e) { return fail(e); }
}
