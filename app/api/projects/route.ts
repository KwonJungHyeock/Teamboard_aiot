// 프로젝트 API (Phase 5) — GET: 인덱스 카드용 집계 목록, POST: 생성(lead).
// 진행률·목표 수·열린 업무 수는 전부 서버가 DB에서 산출한다 (금지 3 동일 원칙).
import { NextResponse } from "next/server";
import { requireLead, requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_STATUSES = ["active", "done", "hold"] as const; // 진행중 / 완료 / 보류
const COLOR_KEYS = ["edu", "play", "train", "team"] as const;

export async function GET() {
  try {
    requireSession();
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
    }>(
      `SELECT p.id, p.name, p.status, p.color_key, p.start_date::text, p.end_date::text, p.notion_url,
              count(t.id) FILTER (WHERE t.status <> 'proposed') AS total,
              count(t.id) FILTER (WHERE t.status = 'done') AS done,
              count(t.id) FILTER (WHERE t.status IN ('todo','doing','review')) AS open_count,
              (SELECT count(*) FROM goal g WHERE g.project_id = p.id AND g.is_active = true) AS goal_count
       FROM project p
       LEFT JOIN task t ON t.project_id = p.id AND t.is_active = true
       WHERE p.is_active = true
       GROUP BY p.id
       ORDER BY p.id`
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
        percent: Number(p.total) > 0 ? Math.round((Number(p.done) / Number(p.total)) * 100) : null,
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
