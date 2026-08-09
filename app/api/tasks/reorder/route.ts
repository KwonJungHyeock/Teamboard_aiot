// 업무 순서 바꾸기 (MD-P-2026-028 §C).
//
// 화면은 **보이는 행의 순서**만 보낸다. 서버가 안 보이는 형제 사이에 끼워 정리한다 —
// 필터가 걸린 목록에서 드래그해도 저장되는 것은 전역 sort_order 이기 때문이다(§C3).
//
// 순서는 **같은 부모 안에서만** 뜻이 있다. 부모가 섞인 요청은 거절한다 —
// 드래그로 부모를 바꾸지 않는다(§C3). 부모 변경은 §A4 의 속성 편집이다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { visibleTaskSql } from "@/lib/visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const parentTaskId: number | null =
      body.parentTaskId === null || body.parentTaskId === undefined ? null : Number(body.parentTaskId);
    const orderedIds: number[] = Array.isArray(body.orderedIds)
      ? body.orderedIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    if (orderedIds.length === 0) {
      return NextResponse.json({ error: "정렬할 업무가 없습니다." }, { status: 400 });
    }

    // 보낸 것들이 정말 같은 부모의 형제인가. 아니면 드래그로 부모가 바뀐 셈이 된다.
    const given = await query<{ id: number; parent_task_id: number | null }>(
      `SELECT t.id, t.parent_task_id FROM task t
        WHERE t.id = ANY($1::int[]) AND t.is_active = true AND ${visibleTaskSql("$2")}`,
      [orderedIds, session.id]
    );
    if (given.length !== orderedIds.length) {
      return NextResponse.json({ error: "옮길 수 없는 업무가 섞여 있습니다." }, { status: 400 });
    }
    const mixed = given.find((g) => (g.parent_task_id ?? null) !== parentTaskId);
    if (mixed) {
      return NextResponse.json(
        { error: "순서는 같은 상위 업무 안에서만 바꿀 수 있습니다. 상위를 바꾸려면 업무 상세의 「상위 업무」를 쓰세요." },
        { status: 400 }
      );
    }

    // 형제 **전체**를 현재 순서대로 가져온다. 화면에 안 보이는 것도 포함한다.
    const siblings = await query<{ id: number }>(
      `SELECT id FROM task
        WHERE is_active = true AND parent_task_id IS NOT DISTINCT FROM $1
        ORDER BY sort_order ASC, id ASC`,
      [parentTaskId]
    );

    // 안 보이는 행의 자리는 그대로 두고, **보이는 자리에만** 새 순서를 끼워 넣는다.
    // 이렇게 하면 필터를 바꿔도 전역 순서가 깨지지 않는다 (§C3).
    const moving = new Set(orderedIds);
    let cursor = 0;
    const merged = siblings.map((s) => (moving.has(s.id) ? orderedIds[cursor++] : s.id));

    // 1..N 로 다시 번호를 매긴다. 023 backfill 이후 생긴 sort_order=0 뭉치도 여기서 풀린다.
    await query(
      `UPDATE task AS t SET sort_order = v.ord, updated_at = now()
         FROM (SELECT * FROM unnest($1::int[], $2::int[]) AS x(id, ord)) AS v
        WHERE t.id = v.id`,
      [merged, merged.map((_, i) => i + 1)]
    );
    return NextResponse.json({ ok: true, ordered: merged.length });
  } catch (error) {
    return jsonError(error);
  }
}
