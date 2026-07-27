// 리뷰 세션 — 목록(GET) · 개설(POST, lead 전용)
import { NextResponse } from "next/server";
import { requireSession, requireLead } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { createReviewSession, listReviewSessions } from "@/lib/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSession();
    const huddle = new URL(request.url).searchParams.get("huddle");
    const sessions = await listReviewSessions(huddle ? Number(huddle) : undefined);
    return NextResponse.json({
      sessions: sessions.map((s) => ({
        id: s.id, title: s.title, status: s.status, createdAt: s.created_at,
        done: Number(s.done), total: Number(s.total),
      })),
    });
  } catch (e) {
    return jsonError(e);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireLead(); // 세션 개설 = lead
    const body = await request.json();
    const title = String(body.title ?? "").trim() || "리뷰 세션";
    const id = await createReviewSession({
      title,
      huddleId: body.huddleId ? Number(body.huddleId) : null,
      createdBy: session.id,
      preset: body.preset !== false,
    });
    return NextResponse.json({ id });
  } catch (e) {
    return jsonError(e);
  }
}
