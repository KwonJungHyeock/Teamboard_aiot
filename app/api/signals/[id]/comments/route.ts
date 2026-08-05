// 시그널 코멘트 (Phase 6) — 스레드 조회·작성. 코멘트는 signal_id에 붙으므로
// 허들 공유·결정 승격 후에도 그대로 보존된다 (검수 포인트 2).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { parseScope } from "@/lib/blob";
import { notify, notifyMentions } from "@/lib/notify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guardSignal(signalId: number, viewerId: number, isLead: boolean) {
  const signal = await queryOne<{
    id: number;
    scope: string;
    type: string;
    author_id: number;
    target_actor_id: number | null;
    title: string;
  }>(
    `SELECT id, scope, type, author_id, target_actor_id, title FROM signal WHERE id = $1 AND is_active = true`,
    [signalId]
  );
  if (!signal) return { error: NextResponse.json({ error: "시그널을 찾을 수 없습니다." }, { status: 404 }) };
  // 가시성: private=작성자 / review=작성자+대상+lead / 그 외 공개
  const visible =
    signal.scope === "private"
      ? signal.author_id === viewerId
      : signal.type === "review"
        ? signal.author_id === viewerId || signal.target_actor_id === viewerId || isLead
        : true;
  if (!visible) {
    return { error: NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 }) };
  }
  return { signal };
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const guarded = await guardSignal(Number(params.id), session.id, session.role === "lead");
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
    const guarded = await guardSignal(Number(params.id), session.id, session.role === "lead");
    if (guarded.error) return guarded.error;
    const payload = await request.json();
    const body = String(payload.body ?? "").trim().slice(0, 2000);
    // 첨부 이미지 — 예전 http URL 또는 이 시그널의 Private Blob pathname (MD-P-2026-014a).
    // 남의 경로를 심을 수 없도록 scope 가 이 시그널과 일치하는지 확인한다.
    const raw = typeof payload.imageUrl === "string" ? payload.imageUrl.trim() : "";
    const sc = raw ? parseScope(raw) : null;
    const imageUrl = /^https?:\/\//.test(raw)
      ? raw.slice(0, 1000)
      : (sc && sc.kind === "signal" && sc.id === Number(params.id) ? raw.slice(0, 500) : null);
    if (!body && !imageUrl) return NextResponse.json({ error: "내용 또는 이미지를 입력하세요." }, { status: 400 });
    const signalId = Number(params.id);
    const comment = await queryOne<{ id: number }>(
      `INSERT INTO comment (signal_id, author_id, body, image_url) VALUES ($1,$2,$3,$4) RETURNING id`,
      [signalId, session.id, body, imageUrl]
    );
    // 알림 — @멘션 대상 + 시그널 작성자(답글). 자기 자신·중복은 제외.
    const snippet = body || "이미지 답글";
    const mentioned = await notifyMentions(body, session.id, "signal", signalId, snippet);
    const author = guarded.signal.author_id;
    if (author !== session.id && !mentioned.includes(author)) {
      // 같은 스레드에 답글이 연속되면 "답글 N개"로 묶는다 (MD-P-2026-007 §E)
      await notify({ userId: author, type: "reply", refType: "signal", refId: signalId, snippet, actorId: session.id, bundle: true });
    }
    return NextResponse.json({ id: comment!.id });
  } catch (error) {
    return jsonError(error);
  }
}

/** 코멘트 수정 (MD-P-2026-006 §A) — 입력창이 빈 상태에서 ↑로 직전 내 메시지를 고칠 때 쓴다.
 *  본인 코멘트만 수정 가능하고, 새로 등장한 @멘션에는 알림을 보낸다. */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const guarded = await guardSignal(Number(params.id), session.id, session.role === "lead");
    if (guarded.error) return guarded.error;
    const payload = await request.json();
    const commentId = Number(payload.id);
    const body = String(payload.body ?? "").trim().slice(0, 2000);
    if (!Number.isInteger(commentId) || commentId <= 0) {
      return NextResponse.json({ error: "코멘트를 지정하세요." }, { status: 400 });
    }
    if (!body) return NextResponse.json({ error: "내용을 입력하세요." }, { status: 400 });

    const own = await queryOne<{ id: number; body: string }>(
      `SELECT id, body FROM comment WHERE id = $1 AND signal_id = $2 AND author_id = $3`,
      [commentId, Number(params.id), session.id]
    );
    if (!own) return NextResponse.json({ error: "본인 코멘트만 수정할 수 있습니다." }, { status: 403 });

    await query(`UPDATE comment SET body = $1 WHERE id = $2`, [body, commentId]);
    // 편집으로 새로 생긴 멘션만 알린다(기존 멘션 재알림 방지)
    const added = body.replace(own.body, "");
    if (added.includes("@")) {
      await notifyMentions(added, session.id, "signal", Number(params.id), body.slice(0, 120));
    }
    return NextResponse.json({ id: commentId, body });
  } catch (error) {
    return jsonError(error);
  }
}
