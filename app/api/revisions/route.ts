// 수정 요청 (0043) — GET 열린 요청 · POST { taskId, memo } 달기 · PATCH { taskId } 닫기(수정 완료)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { openRevisions, requestRevision, resolveRevision, RevisionError } from "@/lib/revision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(error: unknown) {
  if (error instanceof RevisionError) return NextResponse.json({ error: error.message }, { status: error.status });
  return jsonError(error);
}
export async function GET() {
  try { const s = requireSession(); return NextResponse.json({ revisions: await openRevisions(s.id) }); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    const s = requireSession();
    const p = await request.json().catch(() => ({}));
    await requestRevision(Number(p.taskId), { id: s.id, name: s.name, lead: hasLead(s.role) }, p.memo);
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
export async function PATCH(request: Request) {
  try {
    const s = requireSession();
    const p = await request.json().catch(() => ({}));
    await resolveRevision(Number(p.taskId), { id: s.id, name: s.name });
    return NextResponse.json({ ok: true });
  } catch (error) { return fail(error); }
}
