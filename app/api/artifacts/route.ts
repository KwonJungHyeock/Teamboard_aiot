// 자료(Artifact) API (Phase 5) — 링크 카드 메타데이터만 다룬다.
// {kind, title, url}만 저장·반환하고 대상 문서의 본문은 절대 가져오지 않는다 (Phase 5-5).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["notion", "github", "figma", "file", "link"] as const;

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const projectId = url.searchParams.get("project");
    const where = ["a.is_active = true"];
    const params: unknown[] = [];
    if (projectId) {
      params.push(Number(projectId));
      where.push(`a.project_id = $${params.length}`);
    }
    const artifacts = await query<{
      id: number;
      project_id: number | null;
      kind: string;
      title: string;
      url: string;
      created_at: string;
    }>(
      `SELECT a.id, a.project_id, a.kind, a.title, a.url, a.created_at::text
       FROM artifact a WHERE ${where.join(" AND ")}
       ORDER BY a.created_at DESC LIMIT 200`,
      params
    );
    return NextResponse.json({ artifacts });
  } catch (error) {
    return jsonError(error);
  }
}

/** URL에서 kind 자동 추정 — 명시값이 있으면 그대로 사용 */
function inferKind(url: string): (typeof KINDS)[number] {
  if (/notion\.(so|site)/.test(url)) return "notion";
  if (/github\.com/.test(url)) return "github";
  if (/figma\.com/.test(url)) return "figma";
  return "link";
}

export async function POST(request: Request) {
  try {
    const session = requireSession(); // 자료 등록은 전원
    const payload = await request.json();
    const title = String(payload.title ?? "").trim().slice(0, 200);
    const urlValue = String(payload.url ?? "").trim().slice(0, 1000);
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    if (!/^https?:\/\//.test(urlValue)) {
      return NextResponse.json({ error: "http(s) URL이 필요합니다." }, { status: 400 });
    }
    const kind = (KINDS as readonly string[]).includes(payload.kind)
      ? payload.kind
      : inferKind(urlValue);

    const artifact = await queryOne<{ id: number }>(
      `INSERT INTO artifact (project_id, kind, title, url) VALUES ($1,$2,$3,$4) RETURNING id`,
      [payload.projectId ? Number(payload.projectId) : null, kind, title, urlValue]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 자료 링크 추가 — "${title}"`,
    });
    return NextResponse.json({ id: artifact!.id });
  } catch (error) {
    return jsonError(error);
  }
}
