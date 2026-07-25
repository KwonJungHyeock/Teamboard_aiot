// 월간 보고 승인 (Phase 7) — 기존 승인 게이트(lib/notion.createTimelinePage) 재사용.
// 새 Notion 쓰기 코드를 만들지 않는다. 승인 시 draft·report를 함께 approved 처리.
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { createTimelinePage } from "@/lib/notion";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireLead(); // 월간 보고 승인은 lead
    const reportId = Number(params.id);
    const report = await queryOne<{
      id: number;
      period_year: number;
      period_month: number;
      status: string;
      draft_id: number | null;
    }>(
      `SELECT id, period_year, period_month, status, draft_id FROM report WHERE id = $1`,
      [reportId]
    );
    if (!report) return NextResponse.json({ error: "보고서를 찾을 수 없습니다." }, { status: 404 });
    if (report.status === "approved") {
      return NextResponse.json({ error: "이미 승인된 보고서입니다." }, { status: 409 });
    }
    if (!report.draft_id) {
      return NextResponse.json({ error: "연결된 초안이 없습니다." }, { status: 400 });
    }

    const draft = await queryOne<Draft & { notion_user_id: string | null }>(
      `SELECT d.*, ac.notion_user_id
       FROM drafts d LEFT JOIN account ac ON ac.actor_id = d.user_id
       WHERE d.id = $1`,
      [report.draft_id]
    );
    if (!draft) return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });

    const monthEnd = new Date(Date.UTC(report.period_year, report.period_month, 0)).toISOString().slice(0, 10);
    const monthStart = `${report.period_year}-${String(report.period_month).padStart(2, "0")}-01`;

    // Notion 기록은 미러(D-011) — 미연결이면 건너뛰고 자체 DB에만 확정(파트 Z), 실패해도 승인은 확정(파트 C).
    const notionConnected = !!process.env.NOTION_TOKEN;
    let pageId: string | null = null;
    let url: string | null = null;
    let notionError: string | null = null;
    if (notionConnected) try {
      const res = await createTimelinePage({
        title: draft.title,
        workType: "팀업무",
        workAreas: ["플랫폼"],
        status: "완료",
        priority: "High",
        assigneeNotionId: draft.notion_user_id,
        startDate: monthStart,
        endDate: monthEnd,
        memo: "팀보드 월간 보고 승인 기록 (monthly_report)",
        bodyMarkdown: draft.body,
      });
      pageId = res.pageId;
      url = res.url;
    } catch (e) {
      notionError = e instanceof Error ? e.message : "Notion 기록 실패";
    }

    await query(
      `UPDATE drafts SET status = 'approved', approver_id = $1, notion_page_id = $2, decided_at = now()
       WHERE id = $3`,
      [session.id, pageId, report.draft_id]
    );
    await query(
      `UPDATE report SET status = 'approved', approved_by = $1, approved_at = now(), notion_page_id = $2
       WHERE id = $3`,
      [session.id, pageId, reportId]
    );
    await logActivity({
      userId: session.id,
      assistantId: draft.assistant_id,
      message: notionError
        ? `${session.name}이(가) ${report.period_year}년 ${report.period_month}월 월간 보고 승인 — 저장 완료, Notion 기록 실패: ${notionError.slice(0, 200)}`
        : `${session.name}이(가) ${report.period_year}년 ${report.period_month}월 월간 보고 승인${notionConnected ? " → Notion 기록" : " (자체 DB 확정, Notion 미연결)"}`,
      level: notionError ? "error" : "success",
    });
    return NextResponse.json({ ok: true, notionPageId: pageId, notionUrl: url, notionError, notionConnected });
  } catch (error) {
    return jsonError(error);
  }
}
