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

    // 영역 — 업무 등록 중 콤보박스에서 만들 때 그 업무의 영역을 물려받는다 (§D1).
    // 영역 없는 프로젝트를 만들면 영역 필터(B11-3)에서 영원히 안 보인다.
    //
    // project.area_id 는 NOT NULL 인데 기본값이 없다. 이 라우트는 지금껏 area_id 를
    // 아예 넣지 않아 **팀장이 눌러도 반드시 실패**했다 — 화면에서 프로젝트를 만들 길이
    // 없었으므로 아무도 밟지 않았을 뿐이다. 콤보박스가 이 경로를 처음 쓰게 되므로 함께 고친다.
    const rawArea = Number(payload.areaId);
    const picked = Number.isInteger(rawArea) && rawArea > 0
      ? await queryOne<{ id: number }>("SELECT id FROM area WHERE id = $1 AND is_active = true", [rawArea])
      : null;
    const fallback = picked
      ? null
      : await queryOne<{ id: number }>(
          "SELECT id FROM area WHERE is_active = true ORDER BY sort_order, id LIMIT 1"
        );
    const areaId = picked?.id ?? fallback?.id ?? null;
    if (!areaId) return NextResponse.json({ error: "업무 영역이 없습니다. 영역을 먼저 만들어 주세요." }, { status: 400 });

    const project = await queryOne<{ id: number }>(
      `INSERT INTO project (name, status, color_key, notion_url, area_id) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [name, status, colorKey, payload.notionUrl ? String(payload.notionUrl).slice(0, 500) : null, areaId]
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
