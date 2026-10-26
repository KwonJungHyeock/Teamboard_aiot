// 내 메모 — 회의마다 나만 읽고 쓰는 메모. 다른 사람(팀장 포함)의 메모를 읽는 길은 없다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getMemo, MeetingError, saveMemo } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function GET(_r: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = idOf(params.id);
    if (!id) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ memo: await getMemo(id, s.id) });
  } catch (e) { return jsonError(e); }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = idOf(params.id);
    if (!id) return new NextResponse(null, { status: 404 });
    const p = await request.json().catch(() => ({}));
    return NextResponse.json({ memo: await saveMemo(id, s.id, p.body) });
  } catch (e) {
    if (e instanceof MeetingError) return NextResponse.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
