// 보고 파트 순서 — 팀 기본값(config report_part_order). 새 보고가 이 순서로 시작하고, 보고마다 바꿀 수 있다.
//   GET  누구나  → { partOrder }
//   PUT  팀장    { partOrder: ["platform","rnd","etc"] 의 순열 }
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query } from "@/lib/db";
import { isLeadUser } from "@/lib/task-permission";
import { normalizeOrder, PART_ORDER_KEY, teamPartOrder } from "@/lib/team-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { requireSession(); return NextResponse.json({ partOrder: await teamPartOrder() }); }
  catch (e) { return jsonError(e); }
}

export async function PUT(request: Request) {
  try {
    const s = requireSession();
    if (!isLeadUser(s)) return NextResponse.json({ error: "팀장만 바꿉니다." }, { status: 403 });
    const p = await request.json().catch(() => ({}));
    const order = normalizeOrder(p.partOrder);
    await query(`INSERT INTO config (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [PART_ORDER_KEY, JSON.stringify(order), s.id]);
    return NextResponse.json({ partOrder: order });
  } catch (e) { return jsonError(e); }
}
