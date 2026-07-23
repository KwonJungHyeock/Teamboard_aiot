// 일정 조회 (Phase 3 — 캘린더 주·월 뷰용). 쓰기는 이후 Phase에서 확장.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { isoify } from "@/lib/home";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "+09:00";

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
      return NextResponse.json({ error: "from/to(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    }
    const rows = await query<{
      id: number;
      title: string;
      start_at: string;
      end_at: string;
      color_key: string | null;
      is_team: boolean;
      participant_ids: number[] | null;
    }>(
      `SELECT e.id, e.title, e.start_at::text, e.end_at::text, p.color_key, e.is_team,
              array_agg(ep.actor_id) FILTER (WHERE ep.actor_id IS NOT NULL) AS participant_ids
       FROM event e
       LEFT JOIN project p ON p.id = e.project_id
       LEFT JOIN event_participant ep ON ep.event_id = e.id
       WHERE e.is_active = true AND e.start_at < $2::timestamptz AND e.end_at > $1::timestamptz
       GROUP BY e.id, p.color_key
       ORDER BY e.start_at`,
      [`${from}T00:00:00${TZ}`, `${to}T00:00:00${TZ}`]
    );
    return NextResponse.json({
      events: rows.map((e) => ({
        id: e.id,
        title: e.title,
        startAt: isoify(e.start_at),
        endAt: isoify(e.end_at),
        colorKey: e.color_key,
        isTeam: e.is_team,
        participantIds: e.participant_ids ?? [],
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
