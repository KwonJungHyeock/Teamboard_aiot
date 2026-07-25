// 인수인계 자료 (파트 Y) — 목록 + 생성.
// 열람 규칙: 본인 문서는 항상. 타인 문서는 status='shared' 이고 (lead 이거나 해당 영역 담당)일 때만.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const isLead = session.role === "lead";

    const base = `
      SELECT h.id, h.title, h.status, h.area_id, ar.name AS area_name, ar.color_key,
             h.author_id, au.display_name AS author_name, h.updated_at::text,
             (SELECT count(*)::int FROM handover_task ht WHERE ht.handover_id = h.id) AS task_count
      FROM handover h
      JOIN actor au ON au.id = h.author_id
      LEFT JOIN area ar ON ar.id = h.area_id
      WHERE h.is_active = true`;

    const mine = await query(`${base} AND h.author_id = $1 ORDER BY h.updated_at DESC`, [session.id]);

    // 공유된 타인 문서 — lead 는 전체, 그 외는 본인 소속 영역(actor_area) 문서만
    const shared = await query(
      `${base} AND h.author_id <> $1 AND h.status = 'shared'
         AND ($2 OR (h.area_id IS NOT NULL AND h.area_id IN (
              SELECT area_id FROM actor_area WHERE actor_id = $1)))
       ORDER BY h.updated_at DESC`,
      [session.id, isLead]
    );

    return NextResponse.json({ mine, shared });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    const title = String(payload.title ?? "").trim().slice(0, 200) || "제목 없는 인수인계";

    const row = await queryOne<{ id: number }>(
      `INSERT INTO handover (author_id, title, status) VALUES ($1, $2, 'draft') RETURNING id`,
      [session.id, title]
    );
    await logActivity({ userId: session.id, message: `${session.name}이(가) 인수인계 문서 생성 — "${title}"` });
    return NextResponse.json({ id: row!.id });
  } catch (error) {
    return jsonError(error);
  }
}
