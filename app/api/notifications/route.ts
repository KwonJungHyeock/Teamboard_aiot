// 알림 인박스 (협업 C) — 내 알림 목록·미확인 수 조회, 읽음 처리.
// type: mention·assign·reply·approval·share. read=false가 미확인.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const rows = await query<{
      id: number;
      type: string;
      ref_type: string;
      ref_id: number | null;
      snippet: string;
      read: boolean;
      actor_name: string | null;
      created_at: string;
    }>(
      `SELECT n.id, n.type, n.ref_type, n.ref_id, n.snippet, n.read,
              a.display_name AS actor_name, n.created_at::text
       FROM notification n
       LEFT JOIN actor a ON a.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 60`,
      [session.id]
    );
    const unread = rows.filter((r) => !r.read).length;
    return NextResponse.json({
      unread,
      items: rows.map((r) => ({
        id: r.id,
        type: r.type,
        refType: r.ref_type,
        refId: r.ref_id,
        snippet: r.snippet,
        read: r.read,
        actorName: r.actor_name,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

// 읽음 처리 — { id } 단건 또는 { all: true } 전체.
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    if (payload.all === true) {
      await query(`UPDATE notification SET read = true WHERE user_id = $1 AND read = false`, [session.id]);
    } else if (Number.isInteger(Number(payload.id))) {
      await query(`UPDATE notification SET read = true WHERE id = $1 AND user_id = $2`, [Number(payload.id), session.id]);
    } else {
      return NextResponse.json({ error: "id 또는 all이 필요합니다." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
