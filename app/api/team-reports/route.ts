// 팀 보고 목록 · 만들기 (0047). 보기는 팀원 모두, 만들기는 팀장(관리자 권한 포함).
//   GET  ?kind=month|quarter|year
//   POST { kind, periodStart }  — 같은 종류 · 같은 기간의 살아 있는 보고는 하나
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { isLeadUser } from "@/lib/task-permission";
import { isDay, KIND_LABEL, periodLabel, periodOf, ReportError, teamPartOrder, type ReportKind } from "@/lib/team-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS: ReportKind[] = ["month", "quarter", "year"];

export async function GET(request: Request) {
  try {
    const s = requireSession();
    const kind = new URL(request.url).searchParams.get("kind");
    const rows = await query<{ id: number; kind: ReportKind; period_start: string; period_end: string; title: string; status: string; pdf_path: string | null;
      finalized_at: string | null; updated_at: string; items: number; counts: unknown }>(
      `SELECT r.id, r.kind, r.period_start::text, r.period_end::text, r.title, r.status, r.pdf_path, r.finalized_at::text, r.updated_at::text,
              (SELECT count(*)::int FROM team_report_item i WHERE i.report_id = r.id AND i.is_active) AS items,
              r.snapshot -> 'agg' -> 'counts' AS counts
         FROM team_report r WHERE r.is_active ${KINDS.includes(kind as ReportKind) ? "AND r.kind = $1" : ""}
        ORDER BY r.period_start DESC, r.id DESC LIMIT 200`, KINDS.includes(kind as ReportKind) ? [kind] : []);
    return NextResponse.json({
      canEdit: isLeadUser(s),
      reports: rows.map((r) => ({ id: r.id, kind: r.kind, start: r.period_start, end: r.period_end, label: periodLabel(r.kind, r.period_start),
        title: r.title, status: r.status, pdf: !!r.pdf_path, finalizedAt: r.finalized_at, updatedAt: r.updated_at, items: r.items, counts: r.counts ?? null })),
    });
  } catch (e) { return jsonError(e); }
}

export async function POST(request: Request) {
  try {
    const s = requireSession();
    if (!isLeadUser(s)) return NextResponse.json({ error: "보고는 팀장이 만듭니다." }, { status: 403 });
    const p = await request.json().catch(() => ({}));
    const kind = p.kind as ReportKind;
    if (!KINDS.includes(kind)) throw new ReportError("보고 종류가 올바르지 않습니다.");
    if (!isDay(p.periodStart)) throw new ReportError("기간을 고르세요.");
    const { start, end } = periodOf(kind, p.periodStart);
    const dup = await queryOne<{ id: number }>(`SELECT id FROM team_report WHERE is_active AND kind = $1 AND period_start = $2::date`, [kind, start]);
    if (dup) return NextResponse.json({ id: dup.id, existed: true });
    const title = `${periodLabel(kind, start)} ${KIND_LABEL[kind]} 보고`;
    const row = await queryOne<{ id: number }>(
      `INSERT INTO team_report (kind, period_start, period_end, title, part_order, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [kind, start, end, title, JSON.stringify(await teamPartOrder()), s.id]);
    await logActivity({ userId: s.id, message: `${s.name}이(가) 보고 만들기 — "${title}"` });
    return NextResponse.json({ id: row!.id });
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    return jsonError(e);
  }
}
