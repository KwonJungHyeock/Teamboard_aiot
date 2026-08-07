// 저장된 뷰 — 업무·목표·활동 공용 (MD-P-2026-027 §B3).
//
// 예전에는 `/api/notifications/views` 하나뿐이었고 활동 화면 전용이었다.
// 화면이 늘 때마다 경로를 하나씩 더 만들면 소유자 판정이 세 벌이 되고,
// 그중 하나는 반드시 낡는다. 경로도 표도 하나로 둔다.
//
// **소유자 조건은 이 파일 안에서만 쓴다** — `owner_actor_id = $viewer`.
// 저장된 뷰는 항상 개인이므로 공유·팀 조건이 아예 없다. 받지 않는 것으로 만든다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import {
  isViewTarget, normalizeFilters, VIEW_NAME_MAX, type ViewTarget,
} from "@/lib/saved-views";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: number;
  name: string;
  target: ViewTarget;
  filters: Record<string, string>;
  sort_order: number;
  is_pinned: boolean;
}

const shape = (r: Row) => ({
  id: r.id, name: r.name, target: r.target,
  filters: r.filters ?? {}, sortOrder: r.sort_order, isPinned: r.is_pinned,
});

/** GET /api/saved-views?target=tasks — target 을 안 주면 전부. */
export async function GET(request: Request) {
  try {
    const session = requireSession();
    const t = new URL(request.url).searchParams.get("target");
    if (t && !isViewTarget(t)) {
      return NextResponse.json({ error: "알 수 없는 화면입니다." }, { status: 400 });
    }
    const rows = await query<Row>(
      `SELECT id, name, target, filters, sort_order, is_pinned
         FROM saved_view
        WHERE owner_actor_id = $1 ${t ? "AND target = $2" : ""}
        ORDER BY sort_order, id`,
      t ? [session.id, t] : [session.id]
    );
    return NextResponse.json({ views: rows.map(shape) });
  } catch (error) {
    return jsonError(error);
  }
}

/** POST — { name, target, filters } */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const name = String(body.name ?? "").trim().slice(0, VIEW_NAME_MAX);
    if (!name) return NextResponse.json({ error: "뷰 이름을 입력하세요." }, { status: 400 });
    const target = body.target;
    if (!isViewTarget(target)) {
      return NextResponse.json({ error: "알 수 없는 화면입니다." }, { status: 400 });
    }
    const filters = normalizeFilters(body.filters);

    const dup = await queryOne<{ id: number }>(
      `SELECT id FROM saved_view WHERE owner_actor_id = $1 AND target = $2 AND name = $3`,
      [session.id, target, name]
    );
    if (dup) return NextResponse.json({ error: "이 화면에 같은 이름의 뷰가 이미 있어요." }, { status: 409 });

    // 새 뷰는 맨 아래에 붙인다. 만들자마자 순서가 섞이면 어디 갔는지 찾아야 한다.
    const last = await queryOne<{ n: number }>(
      `SELECT COALESCE(MAX(sort_order), 0) AS n FROM saved_view WHERE owner_actor_id = $1 AND target = $2`,
      [session.id, target]
    );
    const row = await queryOne<Row>(
      `INSERT INTO saved_view (owner_actor_id, name, target, filters, sort_order)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, name, target, filters, sort_order, is_pinned`,
      [session.id, name, target, JSON.stringify(filters), (last?.n ?? 0) + 1]
    );
    return NextResponse.json(shape(row!));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * PATCH — 이름 변경 `{ id, name }` · 핀 토글 `{ id, isPinned }` ·
 *         순서 변경 `{ order: [id, id, …] }` (드래그 후 한 번에 보낸다)
 */
export async function PATCH(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();

    if (Array.isArray(body.order)) {
      const ids = body.order.map(Number).filter(Number.isInteger);
      if (ids.length === 0) return NextResponse.json({ error: "순서가 비어 있습니다." }, { status: 400 });
      // 남의 뷰 id 가 섞여 들어와도 `owner_actor_id` 조건이 걸러낸다.
      await query(
        `UPDATE saved_view v SET sort_order = o.n
           FROM unnest($1::int[]) WITH ORDINALITY AS o(id, n)
          WHERE v.id = o.id AND v.owner_actor_id = $2`,
        [ids, session.id]
      );
      return NextResponse.json({ ok: true });
    }

    const id = Number(body.id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });

    if (typeof body.isPinned === "boolean") {
      const rows = await query<{ id: number }>(
        `UPDATE saved_view SET is_pinned = $1 WHERE id = $2 AND owner_actor_id = $3 RETURNING id`,
        [body.isPinned, id, session.id]
      );
      if (rows.length === 0) return NextResponse.json({ error: "뷰를 찾을 수 없습니다." }, { status: 404 });
      return NextResponse.json({ ok: true });
    }

    const name = String(body.name ?? "").trim().slice(0, VIEW_NAME_MAX);
    if (!name) return NextResponse.json({ error: "이름이 필요합니다." }, { status: 400 });
    const rows = await query<{ id: number }>(
      `UPDATE saved_view SET name = $1 WHERE id = $2 AND owner_actor_id = $3 RETURNING id`,
      [name, id, session.id]
    );
    if (rows.length === 0) return NextResponse.json({ error: "뷰를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const session = requireSession();
    const id = Number(new URL(request.url).searchParams.get("id"));
    if (!Number.isInteger(id)) return NextResponse.json({ error: "id가 필요합니다." }, { status: 400 });
    await query(`DELETE FROM saved_view WHERE id = $1 AND owner_actor_id = $2`, [id, session.id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
