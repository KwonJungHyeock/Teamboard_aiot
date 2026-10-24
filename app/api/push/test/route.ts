// 시험 알림 — 내 기기 전부에 한 번. 「켰는데 오나?」를 사람이 바로 확인한다.
import { NextResponse } from "next/server";
import { getLiveSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { notifyTest } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const live = await getLiveSession();
    if (!live) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
    return NextResponse.json(await notifyTest(live.user.id));
  } catch (error) {
    return jsonError(error);
  }
}
