// 시그널 코멘트 (Phase 6) — 스레드 조회·작성. 코멘트는 signal_id에 붙으므로
// 허들 공유·결정 승격 후에도 그대로 보존된다 (검수 포인트 2).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guardSignal(signalId: number, viewerId: number) {
  const signal = await queryOne<{ id: number; scope: string; author_id: number; title: string }>(
    `SELECT id, scope, author_id, title FROM signal WHERE id = $1 AND is_active = true`,
    [signalId]
  );
  if (!signal) return { error: NextResponse.json({ error: "시그널을 찾을 수 없습니다." }, { status: 404 }) };
  if (signal.scope === "private" && signal.author_id !== viewerId) {
    return { error: NextResponse.json({ error: "비공개 메모입니다." }, { status: 403 }) };
  }
  return { signal };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const guarded = await guardSignal(Number(params.id), session.id);
    if (guarded.error) return guarded.error;
    const comments = await query<{
      id: number;
      body: string;
      author_name: string;
      author_type: string;
      created_at: string;
    }>(
      `SELECT c.id, c.body, a.display_name AS author_name, a.type AS author_type, c.created_at::text
       FROM comment c JOIN actor a ON a.id = c.author_id
       WHERE c.signal_id = $1 ORDER BY c.created_at ASC`,
      [Number(params.id)]
    );
    return NextResponse.json({
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        authorName: c.author_name,
        agent: c.author_type === "agent",
        createdAt: c.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const guarded = await guardSignal(Number(params.id), session.id);
    if (guarded.error) return guarded.error;
    const payload = await request.json();
    const body = String(payload.body ?? "").trim().slice(0, 2000);
    if (!body) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });
    const comment = await queryOne<{ id: number }>(
      `INSERT INTO comment (signal_id, author_id, body) VALUES ($1,$2,$3) RETURNING id`,
      [Number(params.id), session.id, body]
    );
    return NextResponse.json({ id: comment!.id });
  } catch (error) {
    return jsonError(error);
  }
}
