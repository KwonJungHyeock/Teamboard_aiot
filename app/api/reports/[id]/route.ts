// 월간 보고 상세·편집 (Phase 7) — GET: 집계+서술+상태, PUT: 서술 문단만 수정(수치 잠금). lead 전용.
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { renderReportMarkdown, REPORT_SECTIONS, type MonthlyReportData } from "@/lib/report";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ReportRow {
  id: number;
  period_year: number;
  period_month: number;
  status: string;
  draft_id: number | null;
  content: { aggregate: MonthlyReportData; narration: Record<string, string> };
  notion_page_id: string | null;
  approved_at: string | null;
}

async function loadReport(id: number): Promise<ReportRow | null> {
  return queryOne<ReportRow>(
    `SELECT id, period_year, period_month, status, draft_id, content, notion_page_id, approved_at::text
     FROM report WHERE id = $1`,
    [id]
  );
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireLead();
    const report = await loadReport(Number(params.id));
    if (!report) return NextResponse.json({ error: "보고서를 찾을 수 없습니다." }, { status: 404 });
    const draft = report.draft_id
      ? await queryOne<{ status: string; title: string; body: string }>(
          `SELECT status, title, body FROM drafts WHERE id = $1`,
          [report.draft_id]
        )
      : null;
    return NextResponse.json({
      report: {
        id: report.id,
        year: report.period_year,
        month: report.period_month,
        status: report.status,
        draftId: report.draft_id,
        draftStatus: draft?.status ?? null,
        title: draft?.title ?? null,
        notionPageId: report.notion_page_id,
        approvedAt: report.approved_at,
      },
      sections: REPORT_SECTIONS,
      data: report.content.aggregate,
      narration: report.content.narration ?? {},
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireLead();
    const report = await loadReport(Number(params.id));
    if (!report) return NextResponse.json({ error: "보고서를 찾을 수 없습니다." }, { status: 404 });
    if (report.status === "approved") {
      return NextResponse.json({ error: "이미 승인된 보고서입니다." }, { status: 409 });
    }
    const payload = await request.json();
    // 서술 문단만 수정 — 집계 수치(content.aggregate)는 잠근다
    if (typeof payload.narration !== "object" || payload.narration === null) {
      return NextResponse.json({ error: "narration 객체가 필요합니다." }, { status: 400 });
    }
    const narration: Record<string, string> = {};
    for (const s of REPORT_SECTIONS) {
      const v = payload.narration[s.key];
      narration[s.key] = typeof v === "string" ? v.slice(0, 4000) : report.content.narration?.[s.key] ?? "";
    }
    const newBody = renderReportMarkdown(report.content.aggregate, narration);
    await query(`UPDATE report SET content = $1 WHERE id = $2`, [
      JSON.stringify({ aggregate: report.content.aggregate, narration }),
      report.id,
    ]);
    if (report.draft_id) {
      await query(`UPDATE drafts SET body = $1 WHERE id = $2 AND status = 'pending'`, [
        newBody,
        report.draft_id,
      ]);
    }
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) ${report.period_year}년 ${report.period_month}월 보고 서술 수정`,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
