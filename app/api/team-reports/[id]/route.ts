// 팀 보고 하나 — 읽기 · 고치기 · 확정 · 지우기(소프트).
//   GET    전부: 보고 · 숫자(작성중이면 지금 값, 확정이면 굳은 값) · 항목 · 에셋 · 결정 · 이슈 · 계획 · 지난 계획 · 경고
//   PATCH  { title?, headline?, partOrder?, status?: "final" | "draft", pdfPath? }   — 팀장
//   DELETE 작성중인 보고만 — 팀장
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { isLeadUser } from "@/lib/task-permission";
import { reportIdOfPath } from "@/lib/report-files";
import {
  aggregate, getReportRow, KIND_LABEL, normalizeOrder, periodLabel, prevPlans, ReportError, tasksByIds, unfinishedSubs,
  type RTask, type Snapshot,
} from "@/lib/team-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idOf = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const fail = (e: unknown) => (e instanceof ReportError ? NextResponse.json({ error: e.message }, { status: e.status }) : jsonError(e));

export async function GET(_r: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    const id = idOf(params.id);
    const r = id ? await getReportRow(id) : null;
    if (!r) return NextResponse.json({ error: "보고를 찾을 수 없습니다." }, { status: 404 });
    const final = r.status === "final" && r.snapshot;
    const agg = final ? r.snapshot!.agg : await aggregate(r.kind, r.period_start, r.period_end);

    const items = await query<{ id: number; task_id: number; summary: string; comment: string; visible: boolean; sort_order: number }>(
      `SELECT id, task_id, summary, comment, visible, sort_order FROM team_report_item WHERE report_id = $1 AND is_active ORDER BY sort_order, id`, [r.id]);
    const live = final ? new Map<number, RTask>() : await tasksByIds(items.map((i) => i.task_id));
    const assets = items.length ? await query<{ id: number; item_id: number; kind: string; path: string | null; url: string | null; caption: string; sort_order: number }>(
      `SELECT id, item_id, kind, path, url, caption, sort_order FROM team_report_asset WHERE item_id = ANY($1::int[]) AND is_active ORDER BY sort_order, id`,
      [items.map((i) => i.id)]) : [];
    const [requests, issues, plans, people] = await Promise.all([
      query(`SELECT id, kind, body, due_date::text AS due, requester, status, sort_order FROM team_report_request WHERE report_id = $1 AND is_active ORDER BY sort_order, id`, [r.id]),
      query<{ id: number }>(`SELECT id, title, background, alt_a, alt_b, discussion, decision, sort_order FROM team_report_issue WHERE report_id = $1 AND is_active ORDER BY sort_order, id`, [r.id]),
      query(`SELECT id, body, status, sort_order FROM team_report_plan WHERE report_id = $1 AND is_active ORDER BY sort_order, id`, [r.id]),
      query(`SELECT id, display_name AS name FROM actor WHERE type = 'human' AND is_active ORDER BY id`),
    ]);
    const actions = issues.length ? await query(
      `SELECT x.id, x.issue_id, x.body, x.assignee_id, a.display_name AS assignee, x.due_date::text AS due, x.status, x.sort_order
         FROM team_report_action x LEFT JOIN actor a ON a.id = x.assignee_id
        WHERE x.issue_id = ANY($1::int[]) AND x.is_active ORDER BY x.sort_order, x.id`, [issues.map((i) => i.id)]) : [];

    return NextResponse.json({
      report: {
        id: r.id, kind: r.kind, start: r.period_start, end: r.period_end, label: periodLabel(r.kind, r.period_start), kindLabel: KIND_LABEL[r.kind],
        title: r.title, status: r.status, partOrder: normalizeOrder(r.part_order), headline: r.headline, pdfPath: r.pdf_path,
        finalizedAt: r.finalized_at, finalizedBy: r.finalized_by_name, snapshotAt: final ? r.snapshot!.at : null,
      },
      isLead: isLeadUser(s),
      canEdit: isLeadUser(s) && r.status === "draft",
      agg,
      items: items.map((i) => ({
        id: i.id, taskId: i.task_id, summary: i.summary, comment: i.comment, visible: i.visible, sortOrder: i.sort_order,
        task: (final ? r.snapshot!.items[i.id] : live.get(i.task_id)) ?? null,
        assets: assets.filter((a) => a.item_id === i.id).map((a) => ({ id: a.id, kind: a.kind, path: a.path, url: a.url, caption: a.caption })),
      })),
      requests, plans, people,
      issues: issues.map((i) => ({ ...i, actions: actions.filter((x: { issue_id?: number }) => x.issue_id === i.id) })),
      prevPlans: final ? r.snapshot!.prevPlans : await prevPlans(r.kind, r.period_start),
      warnings: r.kind === "month" ? [] : await unfinishedSubs(r.kind, r.period_start),
    });
  } catch (e) { return fail(e); }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    if (!isLeadUser(s)) throw new ReportError("보고는 팀장이 고칩니다.", 403);
    const id = idOf(params.id);
    const r = id ? await getReportRow(id) : null;
    if (!r) throw new ReportError("보고를 찾을 수 없습니다.", 404);
    const p = await request.json().catch(() => ({}));

    // 확정 해제 — 굳힌 숫자와 PDF 를 비우고 다시 작성중으로
    if (p.status === "draft") {
      if (r.status !== "final") return NextResponse.json({ ok: true });
      await query(`UPDATE team_report SET status = 'draft', snapshot = NULL, pdf_path = NULL, finalized_at = NULL, finalized_by = NULL, updated_at = now() WHERE id = $1`, [r.id]);
      await logActivity({ userId: s.id, message: `${s.name}이(가) 보고 확정 해제 — "${r.title}"`, level: "warn" });
      return NextResponse.json({ ok: true });
    }
    // 확정 PDF 경로만 — 확정한 뒤 화면이 PDF 를 만들어 올리고 붙인다
    if (typeof p.pdfPath === "string") {
      if (reportIdOfPath(p.pdfPath) !== r.id) throw new ReportError("PDF 경로가 이 보고의 것이 아닙니다.");
      await query(`UPDATE team_report SET pdf_path = $2, updated_at = now() WHERE id = $1`, [r.id, p.pdfPath]);
      return NextResponse.json({ ok: true });
    }
    if (r.status === "final") throw new ReportError("확정한 보고입니다. 고치려면 먼저 「확정 해제」를 누르세요.", 409);

    if (p.status === "final") {
      const subs = r.kind === "month" ? [] : await unfinishedSubs(r.kind, r.period_start);
      if (subs.length) throw new ReportError(`하위 보고가 확정되지 않았습니다 — ${subs.join(" · ")}`, 409);
      const agg = await aggregate(r.kind, r.period_start, r.period_end);
      const items = await query<{ id: number; task_id: number }>(`SELECT id, task_id FROM team_report_item WHERE report_id = $1 AND is_active`, [r.id]);
      const live = await tasksByIds(items.map((i) => i.task_id));
      const snap: Snapshot = {
        at: new Date().toISOString(), agg,
        items: Object.fromEntries(items.map((i) => [i.id, live.get(i.task_id)]).filter(([, t]) => t)),
        prevPlans: await prevPlans(r.kind, r.period_start),
      };
      await query(`UPDATE team_report SET status = 'final', snapshot = $2::jsonb, finalized_at = now(), finalized_by = $3, updated_at = now() WHERE id = $1`,
        [r.id, JSON.stringify(snap), s.id]);
      await logActivity({ userId: s.id, message: `${s.name}이(가) 보고 확정 — "${r.title}"`, level: "success" });
      return NextResponse.json({ ok: true });
    }

    const sets: string[] = []; const vals: unknown[] = [r.id];
    const set = (col: string, v: unknown, cast = "") => { vals.push(v); sets.push(`${col} = $${vals.length}${cast}`); };
    if (typeof p.title === "string" && p.title.trim()) set("title", p.title.trim().slice(0, 120));
    if (typeof p.headline === "string") set("headline", p.headline.slice(0, 400));
    if (p.partOrder !== undefined) set("part_order", JSON.stringify(normalizeOrder(p.partOrder)), "::jsonb");
    if (!sets.length) return NextResponse.json({ ok: true });
    await query(`UPDATE team_report SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, vals);
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}

export async function DELETE(_r: Request, { params }: { params: { id: string } }) {
  try {
    const s = requireSession();
    if (!isLeadUser(s)) throw new ReportError("보고는 팀장이 지웁니다.", 403);
    const id = idOf(params.id);
    const r = id ? await queryOne<{ id: number; title: string; status: string }>(`SELECT id, title, status FROM team_report WHERE id = $1 AND is_active`, [id]) : null;
    if (!r) throw new ReportError("보고를 찾을 수 없습니다.", 404);
    if (r.status === "final") throw new ReportError("확정한 보고는 지울 수 없습니다. 먼저 확정을 해제하세요.", 409);
    await query(`UPDATE team_report SET is_active = false, updated_at = now() WHERE id = $1`, [r.id]);
    await logActivity({ userId: s.id, message: `${s.name}이(가) 보고 지우기 — "${r.title}"`, level: "warn" });
    return NextResponse.json({ ok: true });
  } catch (e) { return fail(e); }
}
