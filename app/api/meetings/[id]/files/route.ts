// 회의 자료 항목 만들기 (0044 · 2026-11 개선) — 두 길.
//   ① JSON { pathname, name, size, mime } — 브라우저가 저장소로 바로 올린 뒤(…/upload) 항목만 만든다. 최대 50MB
//   ② 파일 본문(?name=) — 저장소가 없는 로컬 개발은 임시 폴더에, 운영은 함수로 받아 저장소에 둔다(4MB)
// 받는 형식: 이미지 · PDF · 오피스 · 한글 · zip · txt · 영상(mp4 · webm · mov).
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { blobEnabled } from "@/lib/blob";
import { localMode, putLocal } from "@/lib/report-files";
import { addFile, MEETING_FILE_MAX, MEETING_TYPES, MEETING_UPLOAD_MAX, MeetingError, meetingIdOfPath, newMeetingPath } from "@/lib/meeting";
import { queryOne } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safe = (n: string) => n.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 120) || "file";
const TYPE_ERR = "이미지 · PDF · 한글 · 오피스 문서 · zip · txt · 영상만 올릴 수 있습니다.";

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) return new NextResponse(null, { status: 404 });
    const m = await queryOne<{ status: string }>(`SELECT status FROM meeting WHERE id = $1`, [id]);
    if (!m) return new NextResponse(null, { status: 404 });
    if (m.status !== "live") return NextResponse.json({ error: "끝난 회의입니다." }, { status: 409 });
    const type = (request.headers.get("content-type") ?? "").split(";")[0].trim();

    // ① 저장소로 바로 올린 파일 — 이 회의의 경로만 받는다
    if (type === "application/json") {
      const p = await request.json().catch(() => ({}));
      const pathname = String(p.pathname ?? ""), mime = String(p.mime ?? ""), size = Number(p.size);
      if (meetingIdOfPath(pathname) !== id) return NextResponse.json({ error: "올린 파일을 찾을 수 없습니다." }, { status: 400 });
      if (!MEETING_TYPES[mime]) return NextResponse.json({ error: TYPE_ERR }, { status: 415 });
      if (!(size > 0) || size > MEETING_UPLOAD_MAX) return NextResponse.json({ error: "50MB 이하만 올릴 수 있습니다." }, { status: 413 });
      return NextResponse.json({ id: await addFile(id, s.id, { pathname, name: safe(String(p.name ?? "file")), size, mime }) });
    }

    // ② 파일 본문
    if (!MEETING_TYPES[type]) return NextResponse.json({ error: TYPE_ERR }, { status: 415 });
    const local = localMode();
    if (!local && !blobEnabled()) return NextResponse.json({ error: "파일 저장소가 연결되지 않았습니다." }, { status: 503 });
    const buf = Buffer.from(await request.arrayBuffer());
    if (!buf.byteLength) return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
    const max = local ? MEETING_UPLOAD_MAX : MEETING_FILE_MAX;
    if (buf.byteLength > max) return NextResponse.json({ error: `${max / 1048576}MB 이하만 올릴 수 있습니다.` }, { status: 413 });
    const name = safe(new URL(request.url).searchParams.get("name") ?? "file");
    const pathname = newMeetingPath(id, name);
    if (local) await putLocal(pathname, buf, type);
    else await put(pathname, buf, { access: "private", contentType: type, addRandomSuffix: false });
    const itemId = await addFile(id, s.id, { pathname, name, size: buf.byteLength, mime: type });
    return NextResponse.json({ id: itemId });
  } catch (error) {
    if (error instanceof MeetingError) return NextResponse.json({ error: error.message }, { status: error.status });
    return jsonError(error);
  }
}
