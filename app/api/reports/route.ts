// 월간 보고 목록 (Phase 7) — 월별 최신 1건만 노출(이전 재생성본은 보존하되 숨김). lead 전용.
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    requireLead();
    const rows = await query<{
      id: number;
      period_year: number;
      period_month: number;
      status: string;
      draft_id: number | null;
      draft_status: string | null;
      title: string | null;
      approved_at: string | null;
      created_at: string;
    }>(
      `SELECT DISTINCT ON (r.period_year, r.period_month)
              r.id, r.period_year, r.period_month, r.status, r.draft_id,
              d.status AS draft_status, d.title, r.approved_at::text, r.created_at::text
       FROM report r
       LEFT JOIN drafts d ON d.id = r.draft_id
       ORDER BY r.period_year DESC, r.period_month DESC, r.created_at DESC`
    );
    return NextResponse.json({
      reports: rows.map((r) => ({
        id: r.id,
        year: r.period_year,
        month: r.period_month,
        status: r.status,
        draftId: r.draft_id,
        draftStatus: r.draft_status,
        title: r.title,
        approvedAt: r.approved_at,
        createdAt: r.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
