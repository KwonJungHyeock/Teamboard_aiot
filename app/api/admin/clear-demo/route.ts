// 데모 데이터 비우기 (파트 A) — lead 전용. is_demo=true 레코드만 소프트 삭제(is_active=false).
// 운영 시드(actor/account/area/config/project)는 대상이 아니다. 자식 행(코멘트·참여자·목표연결·
// 활동로그)은 부모가 숨겨지면 조인에서 함께 사라지므로 별도 삭제하지 않는다(복구 여지 보존).
// drafts는 is_active가 없어 승인 흐름에서 빠지도록 status='rejected'로 종료한다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 현재 남은(활성) 데모 레코드 수 — 설정 카드 표시용
export async function GET() {
  try {
    const session = requireSession();
    if (session.role !== "lead") {
      return NextResponse.json({ error: "권한이 없습니다." }, { status: 403 });
    }
    const count = async (table: string) =>
      (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table} WHERE is_demo = true AND is_active = true`))[0]?.n ?? 0;
    const draftsN =
      (await query<{ n: number }>(
        `SELECT count(*)::int AS n FROM drafts WHERE is_demo = true AND status IN ('working','pending','failed')`
      ))[0]?.n ?? 0;
    const counts = {
      task: await count("task"),
      goal: await count("goal"),
      event: await count("event"),
      signal: await count("signal"),
      drafts: draftsN,
    };
    return NextResponse.json({ counts, total: Object.values(counts).reduce((a, b) => a + b, 0) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    const session = requireSession();
    if (session.role !== "lead") {
      return NextResponse.json({ error: "팀장만 데모 데이터를 비울 수 있습니다." }, { status: 403 });
    }

    const softDelete = async (table: string) => {
      const rows = await query<{ id: number }>(
        `UPDATE ${table} SET is_active = false WHERE is_demo = true AND is_active = true RETURNING id`
      );
      return rows.length;
    };

    const counts = {
      task: await softDelete("task"),
      goal: await softDelete("goal"),
      event: await softDelete("event"),
      signal: await softDelete("signal"),
      drafts: (
        await query<{ id: number }>(
          `UPDATE drafts SET status = 'rejected', decided_at = now()
           WHERE is_demo = true AND status IN ('working', 'pending', 'failed') RETURNING id`
        )
      ).length,
    };

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 데모 데이터 비우기 실행 — 업무 ${counts.task}·목표 ${counts.goal}·일정 ${counts.event}·시그널 ${counts.signal}·초안 ${counts.drafts} (총 ${total}건)`,
      level: "warn",
    });

    return NextResponse.json({ ok: true, counts, total });
  } catch (error) {
    return jsonError(error);
  }
}
