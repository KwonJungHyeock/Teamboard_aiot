// Private Blob 업로드 (MD-P-2026-014 §A + 014a §A) — 서버 라우트 경유. 토큰은 클라이언트에 나가지 않는다.
// 응답은 pathname 만 준다. 공개 URL은 만들지도, 돌려주지도 않는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { blobEnabled, blobAuthMode, putPrivate, MAX_UPLOAD_BYTES, ALLOWED_TYPES, WORKLOG_MAX_BYTES, WORKLOG_TYPES, type BlobScopeKind } from "@/lib/blob";
import { canWriteBlob } from "@/lib/blob-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: BlobScopeKind[] = ["project", "task", "review", "signal", "worklog"];

export async function POST(request: Request) {
  try {
    const session = requireSession();
    if (!blobEnabled()) {
      return NextResponse.json(
        { error: "이미지 저장소가 연결되지 않았습니다. 관리자에게 문의하세요." },
        { status: 503 }
      );
    }

    const url = new URL(request.url);
    const kind = url.searchParams.get("kind") as BlobScopeKind | null;
    const id = Number(url.searchParams.get("id"));
    if (!kind || !KINDS.includes(kind) || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "업로드 대상이 올바르지 않습니다." }, { status: 400 });
    }
    // 대상이 없거나 권한이 없으면 404 — 존재 여부를 노출하지 않는다.
    if (!(await canWriteBlob({ kind, id }, session.id))) return new NextResponse(null, { status: 404 });

    const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim();
    // 업무기록만 문서까지 받는다 — 나머지 자리는 예전 그대로 이미지만(014 §A).
    const worklog = kind === "worklog";
    const types = worklog ? WORKLOG_TYPES : ALLOWED_TYPES;
    const max = worklog ? WORKLOG_MAX_BYTES : MAX_UPLOAD_BYTES;
    if (!types[contentType]) {
      return NextResponse.json(
        { error: worklog
            ? "이미지 · PDF · 한글 · 오피스 문서 · zip · txt 만 올릴 수 있습니다."
            : "png · jpg · webp · gif 만 올릴 수 있습니다." },
        { status: 415 }
      );
    }
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.byteLength === 0) return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
    if (buf.byteLength > max) {
      return NextResponse.json({ error: `${Math.round(max / 1024 / 1024)}MB 이하만 올릴 수 있습니다.` }, { status: 413 });
    }

    const name = url.searchParams.get("name") ?? "image";
    const stored = await putPrivate({ kind, id }, buf, name, contentType);
    // pathname · 원본 파일명 · 크기 · contentType 을 그대로 돌려준다(DB에 함께 저장한다).
    return NextResponse.json({ ...stored, auth: blobAuthMode() });
  } catch (error) {
    return jsonError(error);
  }
}
