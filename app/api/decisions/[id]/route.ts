// 결정 상세 (MD-P-2026-006 §B) — 전역 우측 패널이 읽는다.
// 결정 본문 + 연결 업무 제목 + 번복 사슬(원본/새 결정)을 한 번에 돌려준다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getDecision } from "@/lib/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "잘못된 결정입니다." }, { status: 400 });
    }
    const decision = await getDecision(id);
    if (!decision) return NextResponse.json({ error: "결정을 찾을 수 없습니다." }, { status: 404 });

    const [tasks, supersedes] = await Promise.all([
      decision.linkedTaskIds.length
        ? query<{ id: number; title: string; status: string; progress: number }>(
            // 결정에 연결된 업무 — 남의 개인 업무는 제목이 뜨지 않는다 (§A3)
            `SELECT id, title, status, progress FROM task t
              WHERE id = ANY($1::int[]) AND ${visibleTaskSql("$2")} ORDER BY id`,
            [decision.linkedTaskIds, session.id]
          )
        : Promise.resolve([]),
      // 이 결정이 무엇을 번복했는지 (역방향 사슬)
      query<{ id: number; title: string }>(
        `SELECT id, title FROM decision WHERE superseded_by = $1`,
        [id]
      ),
    ]);

    return NextResponse.json({
      decision,
      tasks: tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, progress: t.progress })),
      supersedes: supersedes.map((d) => ({ id: d.id, title: d.title })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
