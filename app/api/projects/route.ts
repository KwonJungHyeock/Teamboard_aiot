// 프로젝트 API (Phase 5) — GET: 인덱스 카드용 집계 목록, POST: 생성(lead).
// 진행률·목표 수·열린 업무 수는 전부 서버가 DB에서 산출한다 (금지 3 동일 원칙).
import { NextResponse } from "next/server";
import { countableSql, doneSql, projectProgressSql, projectCountedSql } from "@/lib/progress";
import { requireLead, requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_STATUSES = ["active", "done", "hold"] as const; // 진행중 / 완료 / 보류
const COLOR_KEYS = ["edu", "play", "train", "team"] as const;

export async function GET(request: Request) {
  try {
    requireSession();
    // 영역 필터 — /tasks 와 같은 형식(`?area=2,3`)이다 (MD-P-2026-027 B11-3).
    // 영역을 사이드바에서 내렸으므로 그 축을 여기서도 쓸 수 있어야 한다.
    const areaIds = (new URL(request.url).searchParams.get("area") ?? "")
      .split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0);
    const rows = await query<{
      id: number;
      name: string;
      status: string;
      color_key: string | null;
      start_date: string | null;
      end_date: string | null;
      notion_url: string | null;
      total: string;
      done: string;
      open_count: string;
      goal_count: string;
      percent: string | null;
    }>(
      // 진척·분모는 lib/progress.ts 정의를 그대로 쓴다 (MD-P-2026-024 §3).
      `SELECT p.id, p.name, p.status, p.color_key, p.start_date::text, p.end_date::text, p.notion_url,
              ${projectCountedSql("p.id")}::text AS total,
              (SELECT count(*) FROM task t
                WHERE t.project_id = p.id AND t.parent_task_id IS NULL
                  AND ${countableSql("t")} AND ${doneSql("t")})::text AS done,
              (SELECT count(*) FROM task t
                WHERE t.project_id = p.id AND t.parent_task_id IS NULL
                  AND ${countableSql("t")} AND t.status IN ('todo','doing','review'))::text AS open_count,
              ${projectProgressSql("p.id")}::text AS percent,
              (SELECT count(*) FROM goal g WHERE g.project_id = p.id AND g.is_active = true) AS goal_count
       FROM project p
       WHERE p.is_active = true
         ${areaIds.length ? "AND p.area_id = ANY($1::int[])" : ""}
       ORDER BY p.id`,
      areaIds.length ? [areaIds] : []
    );
    return NextResponse.json({
      projects: rows.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        colorKey: p.color_key,
        startDate: p.start_date,
        endDate: p.end_date,
        notionUrl: p.notion_url,
        total: Number(p.total),
        done: Number(p.done),
        openCount: Number(p.open_count),
        goalCount: Number(p.goal_count),
        percent: p.percent === null ? null : Math.round(Number(p.percent)),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireLead(); // 새 프로젝트는 lead만
    const payload = await request.json();
    const name = String(payload.name ?? "").trim().slice(0, 100);
    if (!name) return NextResponse.json({ error: "프로젝트 이름을 입력하세요." }, { status: 400 });
    const colorKey = (COLOR_KEYS as readonly string[]).includes(payload.colorKey)
      ? payload.colorKey
      : "team";
    const status = (PROJECT_STATUSES as readonly string[]).includes(payload.status)
      ? payload.status
      : "active";

    const project = await queryOne<{ id: number }>(
      `INSERT INTO project (name, status, color_key, notion_url) VALUES ($1,$2,$3,$4) RETURNING id`,
      [name, status, colorKey, payload.notionUrl ? String(payload.notionUrl).slice(0, 500) : null]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 프로젝트 생성 — "${name}"`,
    });
    return NextResponse.json({ id: project!.id });
  } catch (error) {
    return jsonError(error);
  }
}
