// 활동 인박스 API (MD-P-2026-007) — 조회 · 일괄 처리.
// 조회 시 마감·승인 대기 알림을 동기화하지만, dedupe_key 덕분에 몇 번을 조회해도 늘지 않는다 (§E).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import {
  listActivity, countsFor, getMuteState, shouldSync,
  syncDeadlineNotifications, syncApprovalNotifications,
} from "@/lib/activity-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    // 파생 알림(마감·승인 대기)을 저장 알림으로 맞춘다 — 중복은 dedupe_key가 막는다.
    // 폴링마다 돌 필요는 없어 5분에 한 번으로 줄인다(멱등이라 건너뛰어도 안전).
    if (shouldSync(session.id)) {
      await Promise.all([
        syncDeadlineNotifications(session.id),
        syncApprovalNotifications(session.id),
      ]);
    }

    const items = await listActivity(session.id);
    const counts = countsFor(items);
    const mute = await getMuteState(session.id);

    return NextResponse.json({
      items,
      counts,
      mute,
      // 사이드바 배지 = 사람 안읽음만 (§B). 시스템은 숫자 없이 점으로만 알린다.
      // 임시 음소거 중에는 둘 다 죽여 완전히 조용하게 한다 — 항목은 그대로 남는다.
      unread: mute.allUntil ? 0 : counts.human,
      systemUnread: mute.allUntil ? 0 : counts.system,
    });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * 일괄 처리 (§C) — { ids, action } 또는 { all: true } / { id }.
 * action: read | unread | archive | unarchive. 실행취소를 위해 실제 바뀐 id를 돌려준다.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));

    // 전체 읽음 — types를 주면 "이 필터 모두 읽음"이 된다.
    if (payload.all === true) {
      const types: string[] | null = Array.isArray(payload.types) && payload.types.length
        ? payload.types.map(String) : null;
      const changed = types
        ? await query<{ id: number }>(
            `UPDATE notification SET read = true
              WHERE user_id = $1 AND read = false AND archived = false AND type = ANY($2::text[])
              RETURNING id`,
            [session.id, types]
          )
        : await query<{ id: number }>(
            `UPDATE notification SET read = true
              WHERE user_id = $1 AND read = false AND archived = false RETURNING id`,
            [session.id]
          );
      return NextResponse.json({ ok: true, changed: changed.map((r) => r.id) });
    }

    const ids: number[] = Array.isArray(payload.ids)
      ? payload.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : Number.isInteger(Number(payload.id)) ? [Number(payload.id)] : [];
    if (ids.length === 0) {
      return NextResponse.json({ error: "id 또는 ids가 필요합니다." }, { status: 400 });
    }

    const action = String(payload.action ?? "read");
    const SET: Record<string, string> = {
      read: "read = true",
      unread: "read = false",
      archive: "archived = true",
      unarchive: "archived = false",
    };
    if (!SET[action]) return NextResponse.json({ error: "알 수 없는 처리입니다." }, { status: 400 });

    const changed = await query<{ id: number }>(
      `UPDATE notification SET ${SET[action]} WHERE id = ANY($1::int[]) AND user_id = $2 RETURNING id`,
      [ids, session.id]
    );
    return NextResponse.json({ ok: true, changed: changed.map((r) => r.id) });
  } catch (error) {
    return jsonError(error);
  }
}
