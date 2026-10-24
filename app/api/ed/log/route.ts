// 업무일지 한 달 — 내 기록 + 카테고리 + 내가 끝낸 업무(「완료」 줄). 쓰기는 기존 `/api/worklog` 그대로.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { doneTasksOfMonth, listMonth, parseMonth } from "@/lib/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const s = requireSession();
    const month = parseMonth(new URL(request.url).searchParams.get("month"));
    const [m, done] = await Promise.all([listMonth(s.id, month), doneTasksOfMonth(s.id, month)]);
    return NextResponse.json({ month, ...m, done });
  } catch (error) { return jsonError(error); }
}
