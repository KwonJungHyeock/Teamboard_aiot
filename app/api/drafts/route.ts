// 초안 목록 — 본인 것 조회. 팀장은 scope=all로 전체 조회 가능(관제뷰).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import type { Draft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const scope = url.searchParams.get("scope");

    const all = scope === "all" && session.role === "lead";
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!all) {
      params.push(session.id);
      conditions.push(`d.user_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`d.status = $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const drafts = await query<Draft & { user_name: string; assistant_name: string }>(
      `SELECT d.*, u.display_name AS user_name, a.display_name AS assistant_name
       FROM drafts d
       JOIN actor u ON u.id = d.user_id
       JOIN actor a ON a.id = d.assistant_id
       ${where}
       ORDER BY d.created_at DESC
       LIMIT 100`,
      params
    );
    return NextResponse.json({ drafts });
  } catch (error) {
    return jsonError(error);
  }
}
