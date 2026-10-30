// 보고 에셋 · PDF 올리기 — 운영(Blob): 브라우저가 저장소로 바로 올리고, 여기서는 토큰만 내준다.
// 이미지 5MB · GIF · 영상 · PDF 50MB. 팀장만, 작성중인 보고에만(PDF 는 확정 직후에도 올린다).
// 저장소가 안 붙은 로컬 개발이면 { mode: "local" } — 화면이 /upload-local 로 보낸다.
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { isLeadUser } from "@/lib/task-permission";
import { blobEnabled } from "@/lib/blob";
import { localMode, maxFor, REPORT_TYPES, reportIdOfPath } from "@/lib/report-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mode: blobEnabled() ? "blob" : localMode() ? "local" : "none" });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const res = await handleUpload({
      body, request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // 토큰을 받는 건 화면(로그인한 팀장)이다. 업로드 완료 알림은 저장소가 직접 부르므로 세션을 보지 않는다
        const s = requireSession();
        if (!isLeadUser(s)) throw new Error("보고는 팀장이 고칩니다.");
        const reportId = reportIdOfPath(pathname);
        const type = String(JSON.parse(clientPayload ?? "{}").type ?? "");
        if (!reportId || !REPORT_TYPES[type]) throw new Error("올릴 수 없는 파일입니다.");
        const r = await queryOne<{ status: string }>(`SELECT status FROM team_report WHERE id = $1 AND is_active`, [reportId]);
        if (!r || (r.status !== "draft" && REPORT_TYPES[type] !== "pdf")) throw new Error("작성중인 보고에만 올립니다.");
        return { allowedContentTypes: [type], maximumSizeInBytes: maxFor(type), addRandomSuffix: false };
      },
      onUploadCompleted: async () => { /* 줄에 붙이는 건 화면이 올린 뒤 POST …/assets 로 한다 */ },
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof Error && !("status" in e)) return NextResponse.json({ error: e.message }, { status: 400 });
    return jsonError(e);
  }
}
