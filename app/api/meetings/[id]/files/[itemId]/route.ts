// 회의 파일 읽기 (0044) — 그 회의에 올라간 항목의 경로만 연다(경로를 알아도 다른 것은 못 연다).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { blobEnabled, buildBlobResponse, getPrivate } from "@/lib/blob";
import { meetingFileOf } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string; itemId: string } }) {
  try {
    requireSession();
    const id = Number(params.id), itemId = Number(params.itemId);
    if (!Number.isInteger(id) || !Number.isInteger(itemId) || !blobEnabled()) return new NextResponse(null, { status: 404 });
    const f = await meetingFileOf(id, itemId);
    if (!f) return new NextResponse(null, { status: 404 });
    const r = await getPrivate(f.pathname, request.headers.get("if-none-match"));
    if (!r) return new NextResponse(null, { status: 404 });
    return buildBlobResponse(r as Parameters<typeof buildBlobResponse>[0]);
  } catch (error) {
    return jsonError(error);
  }
}
