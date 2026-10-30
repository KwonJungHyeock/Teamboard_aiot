// 팀 보고의 줄 하나 고치기 · 지우기(소프트) — 팀장. res = items | assets | requests | issues | actions | plans
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { isLeadUser } from "@/lib/task-permission";
import { ReportError } from "@/lib/team-report";
import { removeRow, updateRow } from "@/lib/team-report-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e: unknown) => (e instanceof ReportError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e));
function guard(rowId: string) {
  const s = requireSession();
  if (!isLeadUser(s)) throw new ReportError("보고는 팀장이 고칩니다.", 403);
  const n = Number(rowId);
  if (!Number.isInteger(n) || n <= 0) throw new ReportError("찾을 수 없습니다.", 404);
  return n;
}

export async function PATCH(request: Request, { params }: { params: { res: string; rowId: string } }) {
  try {
    const id = guard(params.rowId);
    await updateRow(params.res, id, await request.json().catch(() => ({})));
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(_r: Request, { params }: { params: { res: string; rowId: string } }) {
  try {
    const id = guard(params.rowId);
    await removeRow(params.res, id);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
