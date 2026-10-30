// 로컬 개발 전용 — 저장소(Blob)가 안 붙은 개발 서버에서 보고 파일을 임시 폴더에 둔다. 운영에서는 404.
//   POST ?report=ID&name=파일명  (본문 = 파일, content-type = 파일 형식)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { isLeadUser } from "@/lib/task-permission";
import { localMode, maxFor, newReportPath, putLocal, REPORT_TYPES } from "@/lib/report-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    if (!localMode()) return new NextResponse(null, { status: 404 });
    const s = requireSession();
    if (!isLeadUser(s)) return NextResponse.json({ error: "보고는 팀장이 고칩니다." }, { status: 403 });
    const u = new URL(request.url);
    const reportId = Number(u.searchParams.get("report"));
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!REPORT_TYPES[type]) return NextResponse.json({ error: "올릴 수 없는 파일입니다." }, { status: 400 });
    const r = await queryOne<{ status: string }>(`SELECT status FROM team_report WHERE id = $1 AND is_active`, [reportId]);
    if (!r || (r.status !== "draft" && REPORT_TYPES[type] !== "pdf")) return NextResponse.json({ error: "작성중인 보고에만 올립니다." }, { status: 409 });
    const body = Buffer.from(await request.arrayBuffer());
    if (body.byteLength > maxFor(type)) return NextResponse.json({ error: `파일이 큽니다(최대 ${maxFor(type) / 1048576}MB).` }, { status: 413 });
    const path = newReportPath(reportId, u.searchParams.get("name") ?? "file");
    await putLocal(path, body, type);
    return NextResponse.json({ pathname: path });
  } catch (e) { return jsonError(e); }
}
