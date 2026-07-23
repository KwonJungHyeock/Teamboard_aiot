// 월간 보고 PPTX 내보내기 (Phase 9 E-5) — report.content에 저장된 값(집계+서술)을 그대로 사용.
// PPTX용 별도 집계를 하지 않는다 (수치 불일치 차단). lead 전용.
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { buildReportPptx } from "@/lib/report-pptx";
import type { MonthlyReportData } from "@/lib/report";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireLead();
    const report = await queryOne<{
      period_year: number;
      period_month: number;
      content: { aggregate: MonthlyReportData; narration: Record<string, string> };
    }>(`SELECT period_year, period_month, content FROM report WHERE id = $1`, [Number(params.id)]);
    if (!report) return NextResponse.json({ error: "보고서를 찾을 수 없습니다." }, { status: 404 });

    const buffer = await buildReportPptx(report.content.aggregate, report.content.narration ?? {});
    const filename = `teamboard-report-${report.period_year}-${String(report.period_month).padStart(2, "0")}.pptx`;
    // Buffer → Uint8Array로 감싸 BodyInit 타입 충족
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
