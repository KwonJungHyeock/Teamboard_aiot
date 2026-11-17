// 회의 자료 올리기 — 운영(Blob): 브라우저가 저장소로 바로 올리고(최대 50MB), 여기서는 토큰만 내준다.
// 올린 뒤 화면이 POST …/files { pathname, name, size, mime } 로 회의 항목을 만든다.
// 저장소가 안 붙은 로컬 개발이면 GET 이 { mode: "local" } — 화면이 …/files 로 파일 본문을 보낸다.
import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { blobEnabled } from "@/lib/blob";
import { localMode } from "@/lib/report-files";
import { MEETING_TYPES, MEETING_UPLOAD_MAX, meetingIdOfPath } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ mode: blobEnabled() ? "blob" : localMode() ? "local" : "none", max: MEETING_UPLOAD_MAX });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const id = Number(params.id);
    const body = (await request.json()) as HandleUploadBody;
    const res = await handleUpload({
      body, request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        // 토큰을 받는 건 화면(로그인한 참석자)이다. 완료 알림은 저장소가 직접 부르므로 세션을 보지 않는다
        requireSession();
        const type = String(JSON.parse(clientPayload ?? "{}").type ?? "");
        if (meetingIdOfPath(pathname) !== id || !MEETING_TYPES[type]) throw new Error("올릴 수 없는 파일입니다.");
        const m = await queryOne<{ status: string }>(`SELECT status FROM meeting WHERE id = $1`, [id]);
        if (!m || m.status !== "live") throw new Error("끝난 회의입니다.");
        return { allowedContentTypes: [type], maximumSizeInBytes: MEETING_UPLOAD_MAX, addRandomSuffix: false };
      },
      onUploadCompleted: async () => { /* 항목은 화면이 올린 뒤 POST …/files 로 만든다 */ },
    });
    return NextResponse.json(res);
  } catch (e) {
    if (e instanceof Error && !("status" in e)) return NextResponse.json({ error: e.message }, { status: 400 });
    return jsonError(e);
  }
}
