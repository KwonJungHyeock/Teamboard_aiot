// 회의 파일 올리기 (0044) — 본문은 Private Blob `meetings/{회의}/…`, 항목은 meeting_item(kind 'file').
// 받는 형식 · 크기는 업무기록 첨부와 같다(이미지 · PDF · 오피스 · 한글 · zip · txt, 4MB).
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { blobEnabled, WORKLOG_TYPES } from "@/lib/blob";
import { addFile, MEETING_FILE_MAX, MeetingError } from "@/lib/meeting";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safe = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "file";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const m = await queryOne<{ status: string }>(`SELECT status FROM meeting WHERE id = $1`, [id]);
    if (!m) return new NextResponse(null, { status: 404 });
    if (m.status !== "live") return NextResponse.json({ error: "끝난 회의입니다." }, { status: 409 });
    if (!blobEnabled()) return NextResponse.json({ error: "파일 저장소가 연결되지 않았습니다." }, { status: 503 });
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    if (!WORKLOG_TYPES[type]) return NextResponse.json({ error: "이미지 · PDF · 한글 · 오피스 문서 · zip · txt 만 올릴 수 있습니다." }, { status: 415 });
    const buf = Buffer.from(await request.arrayBuffer());
    if (!buf.byteLength) return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
    if (buf.byteLength > MEETING_FILE_MAX) return NextResponse.json({ error: "4MB 이하만 올릴 수 있습니다." }, { status: 413 });
    const name = safe(new URL(request.url).searchParams.get("name") ?? "file");
    const res = await put(`meetings/${id}/${randomUUID()}-${name}`, buf, { access: "private", contentType: type, addRandomSuffix: false });
    const itemId = await addFile(id, s.id, { pathname: res.pathname, name, size: buf.byteLength, mime: type });
    return NextResponse.json({ id: itemId });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
