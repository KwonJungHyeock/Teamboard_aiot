// 알림 인박스 (협업 C) — 내 알림 목록·미확인 수 조회, 읽음 처리.
// type: mention·assign·reply·approval·share. read=false가 미확인.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    // C3: 마감 알림 — 내 담당 미완료 업무의 마감 임박(오늘~+2)·지연(지난 마감). 저장 없이 파생.
    const today = kstToday();
    const dueRows = await query<{ id: number; title: string; due_date: string }>(
      `SELECT id, title, due_date::text FROM task
       WHERE is_active = true AND status IN ('todo','doing','review')
         AND assignee_id = $1 AND due_date IS NOT NULL
         AND due_date <= (($2::date) + 2)
       ORDER BY due_date ASC LIMIT 12`,
      [session.id, today]
    );
    const dstamp = `${today}T00:00:00+09:00`;
    const deadlineItems = dueRows.map((r) => {
      const overdue = r.due_date < today;
      return {
        id: overdue ? -200000 - r.id : -100000 - r.id, // 합성 음수 id(저장 아님)
        type: overdue ? "overdue" : "deadline",
        refType: "task", refId: r.id,
        snippet: `${overdue ? "지연" : "마감 임박"} · ${r.title}`,
        read: false, synthetic: true, actorName: null,
        createdAt: dstamp,
      };
    });
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
    const unread = rows.filter((r) => !r.read).length; // 배지는 저장 알림 기준(합성 마감 제외)
    const stored = rows.map((r) => ({
      id: r.id, type: r.type, refType: r.ref_type, refId: r.ref_id,
      snippet: r.snippet, read: r.read, actorName: r.actor_name, createdAt: r.created_at, synthetic: false,
    }));
    return NextResponse.json({
      unread,
      // 마감 임박/지연을 상단에 노출(합성) + 저장 알림
      items: [...deadlineItems, ...stored],
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
