// 아침 관제 알림 — 매일 09:00(서울) (2026-10 관제 패널 · `lib/control-watch.ts`).
// 호출 인증은 `goal-snapshot` 과 같다: CRON_SECRET 이 있으면 그것만, 없으면 Vercel 내부 헤더.
// POST 는 팀장이 손으로 한 번 돌려 볼 때다(같은 키라 두 번 돌려도 알림은 한 번).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { runControlWatch } from "@/lib/control-watch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isCronCaller(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  return request.headers.get("x-vercel-cron") === "1";
}

export async function GET(request: Request) {
  try {
    if (!isCronCaller(request)) {
      return NextResponse.json({ error: "인증되지 않은 호출입니다." }, { status: 401 });
    }
    return NextResponse.json(await runControlWatch());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    const session = getSession();
    if (!session || !hasLead(session.role)) {
      return NextResponse.json({ error: "팀장만 돌릴 수 있습니다." }, { status: 403 });
    }
    return NextResponse.json(await runControlWatch());
  } catch (error) {
    return jsonError(error);
  }
}
