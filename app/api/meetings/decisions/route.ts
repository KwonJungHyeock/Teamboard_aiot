// 결정 찾기 — 회의에서 확정한 결정을 낱말로 찾는다. 회의는 팀 것이라 결정도 팀원 누구나 본다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { findDecisions } from "@/lib/meeting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSession();
    const q = new URL(request.url).searchParams.get("q") ?? "";
    return NextResponse.json({ decisions: await findDecisions(q) });
  } catch (error) {
    return jsonError(error);
  }
}
