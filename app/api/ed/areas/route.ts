// 카테고리(area) — 업무 상세에서 바로 만들고 지운다 (2026-10 운영 요청: 「자유롭게 적고 나중에 정리」).
//   POST   { name }  누구나. 같은 이름이 지워져 있으면 되살리고, 살아 있으면 그것을 돌려준다.
//   DELETE ?id=      팀장 — 또는 아직 업무가 하나도 없는 카테고리면 누구나(잘못 적은 것 지우기).
//                    그 카테고리의 업무는 「기타」로 옮긴다. 「기타」는 지우지 않는다(옮길 자리).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query, queryOne } from "@/lib/db";
import { hasLead } from "@/lib/types";
import { logActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK = "기타";

export async function POST(request: Request) {
  try {
    const s = requireSession();
    const p = await request.json().catch(() => ({}));
    const name = String(p.name ?? "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!name) return NextResponse.json({ error: "이름을 적으세요." }, { status: 400 });
    const was = await queryOne<{ id: number; is_active: boolean }>(`SELECT id, is_active FROM area WHERE name = $1`, [name]);
    if (was?.is_active) return NextResponse.json({ area: { id: was.id, name } });
    const row = was
      ? await queryOne<{ id: number }>(`UPDATE area SET is_active = true WHERE id = $1 RETURNING id`, [was.id])
      : await queryOne<{ id: number }>(
          `INSERT INTO area (name, sort_order) VALUES ($1, (SELECT COALESCE(max(sort_order), 0) + 1 FROM area)) RETURNING id`, [name]);
    await logActivity({ userId: s.id, message: `${s.name}이(가) 카테고리 추가 — "${name}"` });
    return NextResponse.json({ area: { id: row!.id, name } });
  } catch (e) { return jsonError(e); }
}

export async function DELETE(request: Request) {
  try {
    const s = requireSession();
    const id = Number(new URL(request.url).searchParams.get("id"));
    const a = await queryOne<{ id: number; name: string }>(`SELECT id, name FROM area WHERE id = $1 AND is_active`, [id]);
    if (!a) return NextResponse.json({ error: "카테고리를 찾을 수 없습니다." }, { status: 404 });
    if (a.name === FALLBACK) return NextResponse.json({ error: `「${FALLBACK}」는 다른 카테고리를 지울 때 업무를 옮길 자리라 남겨 둡니다.` }, { status: 400 });
    const used = await queryOne<{ n: number }>(`SELECT count(*)::int AS n FROM task WHERE area_id = $1 AND is_active`, [id]);
    const n = used?.n ?? 0;
    if (n > 0 && !hasLead(s.role)) {
      return NextResponse.json({ error: `업무 ${n}건이 있는 카테고리는 팀장이 정리합니다.` }, { status: 403 });
    }
    const fb = await queryOne<{ id: number }>(
      `INSERT INTO area (name, sort_order) VALUES ($1, 999) ON CONFLICT (name) DO UPDATE SET is_active = true RETURNING id`, [FALLBACK]);
    // 지운 업무(is_active=false)도 옮긴다 — 되살렸을 때 꺼진 카테고리를 가리키지 않게
    await query(`UPDATE task SET area_id = $1, updated_at = now() WHERE area_id = $2`, [fb!.id, id]);
    await query(`UPDATE goal SET area_id = NULL WHERE area_id = $1`, [id]);
    await query(`UPDATE area SET is_active = false WHERE id = $1`, [id]);
    await logActivity({ userId: s.id, message: `${s.name}이(가) 카테고리 삭제 — "${a.name}"${n ? ` (업무 ${n}건 → ${FALLBACK})` : ""}`, level: "warn" });
    return NextResponse.json({ ok: true, moved: n });
  } catch (e) { return jsonError(e); }
}
