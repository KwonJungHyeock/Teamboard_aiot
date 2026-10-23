// 업무기록 — 한 달 읽기 · 한 줄 쓰기 (0037).
// 소유자 조건은 `lib/worklog.ts` 의 모든 쿼리에 붙어 있다. 여기서는 세션 id 만 넘긴다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { createEntry, listMonth, parseMonth, WorklogInputError } from "@/lib/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const month = parseMonth(new URL(request.url).searchParams.get("month"));
    return NextResponse.json({ month, ...(await listMonth(session.id, month)) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    // 활동 로그를 남기지 않는다 — 개인 기록은 팀 활동이 아니다(개인 메모와 같다).
    return NextResponse.json({ entry: await createEntry(session.id, payload) });
  } catch (error) {
    if (error instanceof WorklogInputError) return NextResponse.json({ error: error.message }, { status: 400 });
    return jsonError(error);
  }
}
