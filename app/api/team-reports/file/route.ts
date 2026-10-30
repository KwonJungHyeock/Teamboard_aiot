// 보고 파일 내려주기 — 로그인한 팀원만, 살아 있는 보고의 경로만. 없거나 규칙 밖이면 404.
//   GET ?p=reports/<보고 번호>/<uuid>-<이름>
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { blobEnabled, buildBlobResponse, getPrivate } from "@/lib/blob";
import { localMode, readLocal, reportIdOfPath } from "@/lib/report-files";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new NextResponse(null, { status: 404 });

export async function GET(request: Request) {
  if (!getSession()) return new NextResponse(null, { status: 401 });
  const p = new URL(request.url).searchParams.get("p") ?? "";
  const reportId = reportIdOfPath(p);
  if (!reportId) return notFound();
  const r = await queryOne<{ id: number }>(`SELECT id FROM team_report WHERE id = $1 AND is_active`, [reportId]);
  if (!r) return notFound();
  if (blobEnabled()) {
    try {
      const got = await getPrivate(p, request.headers.get("if-none-match"));
      return got ? buildBlobResponse(got) : notFound();
    } catch (e) {
      console.error(`[team-report file] ${p}`, e instanceof Error ? e.message : e);
      return notFound();
    }
  }
  if (!localMode()) return notFound();
  const f = await readLocal(p);
  if (!f) return notFound();
  return new NextResponse(new Uint8Array(f.body), { headers: { "Content-Type": f.type, "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff" } });
}
