// 팀 보고에 줄 더하기 · 순서 바꾸기 — 팀장, 작성중인 보고만.
//   POST /api/team-reports/:id/items     { taskId }
//   POST /api/team-reports/:id/assets    { itemId, kind, path? | url?, caption? }
//   POST /api/team-reports/:id/requests  { kind, body, due?, requester?, status? }
//   POST /api/team-reports/:id/issues    { title, background, alt_a, alt_b, discussion, decision }
//   POST /api/team-reports/:id/actions   { issueId, body, assigneeId?, due?, status? }
//   POST /api/team-reports/:id/plans     { body }
//   POST /api/team-reports/:id/reorder   { res: "items" | …, ids: [...] }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { isLeadUser } from "@/lib/task-permission";
import { ReportError } from "@/lib/team-report";
import { createRow, reorder } from "@/lib/team-report-rows";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/team-reports/:id/pdf — 확정 때 보관한 PDF 를 내려받기(팀원 모두) */
export async function GET(_request: Request, { params }: { params: { id: string; res: string } }) {
  try {
    requireSession();
    if (params.res !== "pdf") return new NextResponse(null, { status: 404 });
    const r = await queryOne<{ pdf_path: string | null; title: string }>(`SELECT pdf_path, title FROM team_report WHERE id = $1 AND is_active`, [Number(params.id)]);
    if (!r?.pdf_path) return NextResponse.json({ error: "보관한 PDF 가 없습니다." }, { status: 404 });
    // 상대 주소로 넘긴다 — 개발 서버는 요청 주소의 호스트를 localhost 로 바꿔 놓아서 쿠키가 따라가지 않는다
    return new NextResponse(null, { status: 307, headers: { Location: `/api/team-reports/file?p=${encodeURIComponent(r.pdf_path)}&dl=${encodeURIComponent(`${r.title}.pdf`)}` } });
  } catch (e) { return jsonError(e); }
}

export async function POST(request: Request, { params }: { params: { id: string; res: string } }) {
  try {
    const s = requireSession();
    if (!isLeadUser(s)) throw new ReportError("보고는 팀장이 고칩니다.", 403);
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw new ReportError("보고를 찾을 수 없습니다.", 404);
    const p = await request.json().catch(() => ({}));
    if (params.res === "reorder") { await reorder(id, String(p.res), p.ids); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ id: await createRow(id, params.res, p) });
  } catch (e) {
    return e instanceof ReportError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e);
  }
}
