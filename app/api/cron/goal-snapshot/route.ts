// 성과 스냅샷 적립 엔드포인트 (MD-P-2026-011 §B·C·D·F)
// 호출 경로 셋:
//   1. Vercel Cron — 매일 KST 00:10 (UTC 15:10, vercel.json의 "10 15 * * *")
//   2. 배포 직후 1회 — 같은 GET을 CRON_SECRET으로 호출
//   3. 수동 — 목표 페이지 [지금 스냅샷 저장] (팀장 세션, POST)
// 외부 무인증 호출은 막는다.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import {
  captureGoalSnapshots, logSnapshotRun, failedTwiceInARow,
  notifySnapshotFailure, recentSnapshotRuns,
} from "@/lib/goal-snapshot";
import { kstTodayForGoals } from "@/lib/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 외부 호출 차단 (§B).
 * CRON_SECRET이 설정돼 있으면 그것만 인정한다 — 헤더는 위조될 수 있으므로 병행 허용하지 않는다.
 * 시크릿이 없는 환경에서는 Vercel이 붙이는 내부 헤더로만 통과시킨다.
 * 운영 배포 시 CRON_SECRET 환경변수 설정을 권장한다.
 */
function isCronCaller(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return request.headers.get("authorization") === `Bearer ${secret}`;
  return request.headers.get("x-vercel-cron") === "1";
}

async function run(source: "auto" | "manual") {
  const date = kstTodayForGoals();
  try {
    const r = await captureGoalSnapshots(source);
    await logSnapshotRun({ date: r.date, source, ok: true, goalCount: r.goalCount, durationMs: r.durationMs });
    return { ok: true as const, ...r };
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    await logSnapshotRun({ date, source, ok: false, goalCount: 0, durationMs: 0, error: message });
    // 1회 실패는 다음 회차 재시도로 흡수하고, 연속 2회일 때만 알린다 (§F)
    if (source === "auto" && (await failedTwiceInARow())) {
      await notifySnapshotFailure(message);
    }
    return { ok: false as const, error: message, date };
  }
}

/** Cron / 배포 직후 1회. */
export async function GET(request: Request) {
  try {
    if (!isCronCaller(request)) {
      return NextResponse.json({ error: "인증되지 않은 호출입니다." }, { status: 401 });
    }
    const result = await run("auto");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return jsonError(error);
  }
}

/** 수동 실행 (§D) — 팀장만. 같은 날 재실행은 upsert. */
export async function POST(request: Request) {
  try {
    const session = getSession();
    const byCron = isCronCaller(request);
    if (!byCron && (!session || session.role !== "lead")) {
      return NextResponse.json({ error: "팀장만 스냅샷을 저장할 수 있습니다." }, { status: 403 });
    }
    const result = await run(byCron ? "auto" : "manual");
    if (result.ok && session) {
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 성과 스냅샷 수동 저장 — ${result.date} (목표 ${result.goalCount}건)`,
        level: "success",
      });
    }
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (error) {
    return jsonError(error);
  }
}

/** 실행 이력 조회 (§F) — 팀장만. */
export async function PATCH() {
  try {
    const session = getSession();
    if (!session || session.role !== "lead") {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    return NextResponse.json({ runs: await recentSnapshotRuns(20) });
  } catch (error) {
    return jsonError(error);
  }
}
