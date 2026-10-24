// 업무 현황 — 팀원(마지막 활동 · 최근 활동) · 목표 미니바. 업무는 `/api/tasks` 에서 센다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { getMonitor } from "@/lib/ed/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = requireSession();
    return NextResponse.json(await getMonitor(s.id));
  } catch (error) { return jsonError(error); }
}
