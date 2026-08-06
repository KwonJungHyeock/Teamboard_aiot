// 영역 작업 공간 데이터 (파트 6) — /areas/[key] 에서 사용.
// key = area.id. is_active=false 또는 미존재 → 404. 탭(업무/프로젝트/목표/자료) 데이터를 한 번에 반환.
import { NextResponse } from "next/server";
import { countableSql, doneSql, projectProgressSql, projectCountedSql } from "@/lib/progress";
import { requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";
import { getAreaDefaultWorkType } from "@/lib/area-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function dday(due: string, today: string): string {
  const diff = Math.round(
    (new Date(`${due}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000
  );
  return diff < 0 ? `D+${-diff}` : diff === 0 ? "D-DAY" : `D-${diff}`;
}

export async function GET(_req: Request, { params }: { params: { key: string } }) {
  try {
    const session = requireSession();
    const areaId = Number(params.key);
    if (!Number.isInteger(areaId) || areaId <= 0) {
      return NextResponse.json({ error: "영역을 찾을 수 없습니다." }, { status: 404 });
    }

    const area = await queryOne<{ id: number; name: string; color_key: string | null }>(
      `SELECT id, name, color_key FROM area WHERE id = $1 AND is_active = true`,
      [areaId]
    );
    if (!area) {
      return NextResponse.json({ error: "영역을 찾을 수 없습니다." }, { status: 404 });
    }

    const today = kstToday();
    const defaultWorkType = await getAreaDefaultWorkType(areaId);

    // ── 업무 (proposed 제외, 활성) ──
    const taskRows = await query<{
      id: number; title: string; status: string; priority: string;
      project_name: string | null; color_key: string | null;
      assignee_name: string | null; work_type: string; due_date: string | null;
    }>(
      `SELECT t.id, t.title, t.status, t.priority, p.name AS project_name, p.color_key,
              a.display_name AS assignee_name, t.work_type, t.due_date::text
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       -- 영역 작업 공간 — 남의 개인 업무는 영역 목록에 오르지 않는다 (§A3 ①)
       WHERE t.area_id = $1 AND t.is_active = true AND t.status <> 'proposed'
         AND ${visibleTaskSql("$2")}
       ORDER BY t.due_date ASC NULLS LAST, t.id DESC
       LIMIT 200`,
      [areaId, session.id]
    );
    const tasks = taskRows.map((r) => ({
      id: r.id,
      title: r.title,
      projectName: r.project_name,
      colorKey: r.color_key,
      assigneeName: r.assignee_name,
      status: r.status,
      priority: r.priority,
      workType: r.work_type,
      dday: r.due_date ? dday(r.due_date, today) : null,
      overdue: r.due_date ? r.due_date < today && !["done", "dropped"].includes(r.status) : false,
    }));

    // ── 프로젝트 — 진척·분모는 lib/progress.ts 정의 (MD-P-2026-024 §3) ──
    const projRows = await query<{
      id: number; name: string; color_key: string | null; status: string;
      total: string; done: string; percent: string | null;
    }>(
      `SELECT p.id, p.name, p.color_key, p.status,
              ${projectCountedSql("p.id")}::text AS total,
              (SELECT count(*) FROM task t
                WHERE t.project_id = p.id AND t.parent_task_id IS NULL
                  AND ${countableSql("t")} AND ${doneSql("t")})::text AS done,
              ${projectProgressSql("p.id")}::text AS percent
       FROM project p
       WHERE p.area_id = $1 AND p.is_active = true
       ORDER BY p.id DESC`,
      [areaId]
    );
    const projects = projRows.map((r) => ({
      id: r.id,
      name: r.name,
      colorKey: r.color_key,
      status: r.status,
      total: Number(r.total),
      done: Number(r.done),
      percent: r.percent === null ? null : Math.round(Number(r.percent)),
    }));

    // ── 목표 (해당 영역) ──
    const goalRows = await query<{
      id: number; title: string; period_type: string; period_start: string;
      progress: number | null; color_key: string | null;
    }>(
      `SELECT g.id, g.title, g.period_type, g.period_start::text, g.progress, ar.color_key
       FROM goal g
       JOIN area ar ON ar.id = g.area_id
       WHERE g.area_id = $1 AND g.is_active = true
       ORDER BY g.period_start DESC NULLS LAST, g.id DESC
       LIMIT 100`,
      [areaId]
    );
    const PERIOD_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월간" };
    const goals = goalRows.map((r) => ({
      id: r.id,
      title: r.title,
      period: `${PERIOD_LABEL[r.period_type] ?? r.period_type} · ${r.period_start.slice(0, 7)}`,
      progress: r.progress === null ? null : Math.round(Number(r.progress)),
      colorKey: r.color_key,
    }));

    // ── 자료 (영역 소속 프로젝트의 artifact) ──
    const assetRows = await query<{
      id: number; kind: string; title: string; url: string; project_name: string | null;
    }>(
      `SELECT ar.id, ar.kind, ar.title, ar.url, p.name AS project_name
       FROM artifact ar
       JOIN project p ON p.id = ar.project_id
       WHERE p.area_id = $1 AND ar.is_active = true AND p.is_active = true
       ORDER BY ar.external_updated_at DESC NULLS LAST, ar.id DESC
       LIMIT 100`,
      [areaId]
    );
    const assets = assetRows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      url: r.url,
      projectName: r.project_name,
    }));

    return NextResponse.json({
      area: { id: area.id, name: area.name, colorKey: area.color_key, defaultWorkType },
      tasks,
      projects,
      goals,
      assets,
      today,
    });
  } catch (error) {
    return jsonError(error);
  }
}
