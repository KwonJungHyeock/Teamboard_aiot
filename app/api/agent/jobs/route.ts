// 에이전트 작업 목록·상태 — FAB 폴링(4초). 본인 것만. 미확인 완료 수·크레딧 함께 반환.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { listJobs, unseenDoneCount, creditState } from "@/lib/agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const [jobs, unseen, credit] = await Promise.all([
      listJobs(session.id),
      unseenDoneCount(session.id),
      creditState(session.id),
    ]);
    return NextResponse.json({ jobs, unseen, credit });
  } catch (error) {
    return jsonError(error);
  }
}
