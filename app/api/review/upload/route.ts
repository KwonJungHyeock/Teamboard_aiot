// 리뷰 이미지 업로드 — 붙여넣기/드롭한 이미지를 Vercel Blob 에 올리고 URL 반환.
// blob 자체는 자체 Postgres 에 넣지 않는다(기존 이미지URL 원칙). BLOB_READ_WRITE_TOKEN 필요.
import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024; // 8MB

export async function POST(request: Request) {
  try {
    requireSession();
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json(
        { error: "이미지 업로드가 설정되지 않았습니다(BLOB_READ_WRITE_TOKEN 미설정). 이미지 URL을 직접 붙여넣으세요." },
        { status: 503 }
      );
    }
    const type = request.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return NextResponse.json({ error: "이미지 파일만 업로드할 수 있습니다." }, { status: 400 });
    }
    const buf = Buffer.from(await request.arrayBuffer());
    if (buf.byteLength === 0) return NextResponse.json({ error: "빈 파일입니다." }, { status: 400 });
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "8MB 이하만 업로드할 수 있습니다." }, { status: 413 });

    const ext = type.split("/")[1]?.split("+")[0]?.replace(/[^a-z0-9]/gi, "") || "png";
    const stamp = new URL(request.url).searchParams.get("t") || String(buf.byteLength);
    const blob = await put(`review/${stamp}-${Math.round(buf.byteLength)}.${ext}`, buf, {
      access: "public",
      contentType: type,
      addRandomSuffix: true,
    });
    return NextResponse.json({ url: blob.url });
  } catch (e) {
    return jsonError(e);
  }
}
