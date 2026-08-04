// 저장됨 (MD-P-2026-006 §C·G) — hover 액션 바의 [저장]이 쓰는 토글 + /saved 목록.
// Slack의 "나중에" 와 같은 자리·같은 동작: 저장 → 한 곳에 모임 → 다시 찾기.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["task", "signal", "decision", "project"] as const;
type TargetType = (typeof TYPES)[number];

export interface SavedItem {
  id: number;
  targetType: TargetType;
  targetId: number;
  title: string;
  meta: string;
  createdAt: string;
  missing: boolean;
}

/** 저장 목록 — 최신순. 대상이 사라졌으면 missing으로 남겨 사용자가 정리할 수 있게 한다. */
export async function GET() {
  try {
    const session = requireSession();
    const rows = await query<{
      id: number; target_type: TargetType; target_id: number; created_at: string;
      title: string | null; meta: string | null;
    }>(
      `SELECT s.id, s.target_type, s.target_id, s.created_at::text,
              COALESCE(t.title, sg.title, d.title, p.name) AS title,
              CASE s.target_type
                WHEN 'task'     THEN COALESCE(tp.name, ta.name, '업무')
                WHEN 'signal'   THEN COALESCE(sa.display_name, '논의')
                WHEN 'decision' THEN COALESCE(da.display_name, '결정')
                WHEN 'project'  THEN COALESCE(pa.name, '프로젝트')
              END AS meta
       FROM saved_item s
       LEFT JOIN task t      ON s.target_type = 'task'     AND t.id  = s.target_id
       LEFT JOIN project tp  ON tp.id = t.project_id
       LEFT JOIN area ta     ON ta.id = t.area_id
       LEFT JOIN signal sg   ON s.target_type = 'signal'   AND sg.id = s.target_id
       LEFT JOIN actor sa    ON sa.id = sg.author_id
       LEFT JOIN decision d  ON s.target_type = 'decision' AND d.id  = s.target_id
       LEFT JOIN actor da    ON da.id = d.decided_by
       LEFT JOIN project p   ON s.target_type = 'project'  AND p.id  = s.target_id
       LEFT JOIN area pa     ON pa.id = p.area_id
       WHERE s.user_id = $1
       ORDER BY s.created_at DESC
       LIMIT 200`,
      [session.id]
    );
    const items: SavedItem[] = rows.map((r) => ({
      id: r.id,
      targetType: r.target_type,
      targetId: r.target_id,
      title: r.title ?? `#${r.target_id}`,
      meta: r.meta ?? "",
      createdAt: r.created_at,
      missing: r.title === null,
    }));
    return NextResponse.json({ items });
  } catch (error) {
    return jsonError(error);
  }
}

/** 저장 토글 — { targetType, targetId, saved? }. saved 생략 시 현재 상태를 뒤집는다. */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const targetType = String(body.targetType ?? "");
    const targetId = Number(body.targetId);
    if (!(TYPES as readonly string[]).includes(targetType) || !Number.isInteger(targetId) || targetId <= 0) {
      return NextResponse.json({ error: "대상이 올바르지 않습니다." }, { status: 400 });
    }
    const existing = await queryOne<{ id: number }>(
      `SELECT id FROM saved_item WHERE user_id = $1 AND target_type = $2 AND target_id = $3`,
      [session.id, targetType, targetId]
    );
    const want = typeof body.saved === "boolean" ? body.saved : !existing;
    if (want && !existing) {
      await query(
        `INSERT INTO saved_item (user_id, target_type, target_id) VALUES ($1, $2, $3)
         ON CONFLICT (user_id, target_type, target_id) DO NOTHING`,
        [session.id, targetType, targetId]
      );
    } else if (!want && existing) {
      await query(`DELETE FROM saved_item WHERE id = $1`, [existing.id]);
    }
    return NextResponse.json({ saved: want });
  } catch (error) {
    return jsonError(error);
  }
}
