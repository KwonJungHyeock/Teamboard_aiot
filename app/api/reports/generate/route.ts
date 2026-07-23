// 월간 보고 생성 (Phase 7) — lib/report.ts 집계 → lib/llm.narrateReport 문장화 →
// drafts(task_type='monthly_report', status='pending') 저장 + report 레코드(content=집계 원본).
// 기존 승인 게이트를 재사용하므로 새 Notion 쓰기 로직을 만들지 않는다. lead 전용.
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { query, queryOne, getAssistantByOwner } from "@/lib/db";
import { buildMonthlyReport, renderReportMarkdown, REPORT_SECTIONS } from "@/lib/report";
import { narrateReport } from "@/lib/llm";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const session = requireLead(); // 월간 보고는 lead (SPEC 4장 /reports 접근 lead)
    const payload = await request.json().catch(() => ({}));
    const year = Number(payload.year);
    const month = Number(payload.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: "year/month가 올바르지 않습니다." }, { status: 400 });
    }

    // 1. 집계 (모든 수치는 여기서 확정)
    const data = await buildMonthlyReport(year, month);

    // 2. 문장화 (LLM은 서술만 — 수치 생성 금지). 키 없으면 데모 모드 자동 처리
    const narration = await narrateReport({
      periodLabel: data.periodLabel,
      data,
      sections: REPORT_SECTIONS,
    });

    // 3. 초안 저장 — 부사수(에이전트) 명의, 승인 대기
    const assistant = await getAssistantByOwner(session.id);
    if (!assistant) {
      return NextResponse.json({ error: "보고 작성 부사수를 찾을 수 없습니다." }, { status: 400 });
    }
    const body = renderReportMarkdown(data, narration);
    const title = `${data.periodLabel} 월간 보고`;
    const draft = await queryOne<{ id: number }>(
      `INSERT INTO drafts (assistant_id, user_id, task_type, instruction, title, body, status)
       VALUES ($1,$2,'monthly_report',$3,$4,$5,'pending') RETURNING id`,
      [assistant.id, session.id, `${year}-${month} 월간 보고 생성`, title, body]
    );

    // 4. report 레코드 — content에 집계 원본 + 서술 보관 (감사 추적)
    const report = await queryOne<{ id: number }>(
      `INSERT INTO report (period_year, period_month, draft_id, content, status)
       VALUES ($1,$2,$3,$4,'draft') RETURNING id`,
      [year, month, draft!.id, JSON.stringify({ aggregate: data, narration })]
    );

    await logActivity({
      userId: session.id,
      assistantId: assistant.id,
      message: `${session.name}이(가) ${data.periodLabel} 월간 보고 초안 생성`,
    });
    return NextResponse.json({ reportId: report!.id, draftId: draft!.id });
  } catch (error) {
    return jsonError(error);
  }
}
