// 아침 관제 알림 — 매일 09:00(서울). 월요일엔 주간 요약, 평일엔 업무일지 빈 날 알림도(lib/team-digest.ts) (2026-10 관제 패널 · `lib/control-watch.ts`).
// 호출 인증은 `goal-snapshot` 과 같다: CRON_SECRET 이 있으면 그것만, 없으면 Vercel 내부 헤더.
// POST 는 팀장이 손으로 한 번 돌려 볼 때다(같은 키라 두 번 돌려도 알림은 한 번).
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { hasLead } from "@/lib/types";
import { runControlWatch } from "@/lib/control-watch";
import { remindNoLog, runWeeklyDigest } from "@/lib/team-digest";
import { pushMorningDue } from "@/lib/push";
import { kstToday } from "@/lib/home";

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
    const watch = await runControlWatch();
    // 2026-11 — 월요일이면 주간 요약, 평일이면 어제 업무일지 빈 사람 알림(lib/team-digest.ts)
    const weekly = await runWeeklyDigest(kstToday()).catch(() => null);
    const nolog = await remindNoLog(kstToday()).catch(() => null);
    // 데스크톱 알림(0041) — 하루 한 번, 예약 호출일 때만(팀장이 손으로 돌리는 POST 는 다시 안 보낸다)
    const pushed = await pushMorningDue(kstToday()).catch(() => 0);
    return NextResponse.json({ ...watch, pushed, weekly, nolog });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = getSession();
    if (!session || !hasLead(session.role)) {
      return NextResponse.json({ error: "팀장만 돌릴 수 있습니다." }, { status: 403 });
    }
    // { day: "YYYY-MM-DD" } — 그 날 아침인 것처럼 주간 요약 · 일지 알림을 돌린다(놓친 날 다시 보내기 · 점검)
    const p = await request.json().catch(() => ({}));
    const today = typeof p.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.day) ? p.day : kstToday();
    return NextResponse.json({ ...(await runControlWatch()), weekly: await runWeeklyDigest(today), nolog: await remindNoLog(today) });
  } catch (error) {
    return jsonError(error);
  }
}
