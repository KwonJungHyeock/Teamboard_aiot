// 회의 파일 읽기 (0044) — 그 회의에 올라간 항목의 경로만 연다(경로를 알아도 다른 것은 못 연다).
//   ?dl=1 이면 원래 이름으로 내려받기. 저장소가 없는 로컬 개발은 임시 폴더에서 읽는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { blobEnabled, buildBlobResponse, getPrivate } from "@/lib/blob";
import { localMode, readLocal } from "@/lib/report-files";
import { meetingFileOf } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: { id: string; itemId: string } }) {
  try {
    requireSession();
    const id = Number(params.id), itemId = Number(params.itemId);
    if (!Number.isInteger(id) || !Number.isInteger(itemId)) return new NextResponse(null, { status: 404 });
    const f = await meetingFileOf(id, itemId);
    if (!f) return new NextResponse(null, { status: 404 });
    const disp = new URL(request.url).searchParams.get("dl")
      ? `attachment; filename*=UTF-8''${encodeURIComponent(f.name.replace(/[\r\n"]/g, ""))}` : null;
    if (blobEnabled()) {
      const r = await getPrivate(f.pathname, request.headers.get("if-none-match"));
      if (!r) return new NextResponse(null, { status: 404 });
      const res = buildBlobResponse(r as Parameters<typeof buildBlobResponse>[0]);
      if (disp) res.headers.set("Content-Disposition", disp);
      return res;
    }
    if (!localMode()) return new NextResponse(null, { status: 404 });
    const l = await readLocal(f.pathname);
    if (!l) return new NextResponse(null, { status: 404 });
    return new NextResponse(new Uint8Array(l.body), { headers: { "Content-Type": l.type, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", ...(disp ? { "Content-Disposition": disp } : {}) } });
  } catch (error) {
    return jsonError(error);
  }
}
