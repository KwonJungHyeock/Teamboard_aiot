// 음소거 (MD-P-2026-007 §F) — 임시 전체 음소거 + 프로젝트별 알림 끄기.
// 프로젝트 음소거는 생성 시점에 걸러 알림을 아예 만들지 않는다(lib/activity-inbox).
// 임시 음소거는 항목을 지우지 않고 배지만 죽인다 — 조용해질 뿐 놓치지 않게.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getMuteState, projectOf } from "@/lib/activity-inbox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    return NextResponse.json(await getMuteState(session.id));
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * POST — { scope: 'all', preset: '1h' | 'tomorrow' | 'off' }
 *      | { scope: 'project', projectId, on }
 *      | { scope: 'project', refType, refId, on }   ← 항목에서 바로 끄기
 */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const scope = String(body.scope ?? "");

    if (scope === "all") {
      const preset = String(body.preset ?? "off");
      if (preset === "off") {
        await query(`DELETE FROM notification_mute WHERE user_id = $1 AND scope = 'all'`, [session.id]);
        return NextResponse.json({ ...(await getMuteState(session.id)) });
      }
      // 1시간 / 내일 오전 9시(KST)까지
      const untilSql = preset === "1h"
        ? `now() + interval '1 hour'`
        : `((date_trunc('day', (now() AT TIME ZONE 'Asia/Seoul')) + interval '1 day' + interval '9 hours') AT TIME ZONE 'Asia/Seoul')`;
      await query(
        `INSERT INTO notification_mute (user_id, scope, until) VALUES ($1, 'all', ${untilSql})
         ON CONFLICT (user_id, scope) DO UPDATE SET until = EXCLUDED.until`,
        [session.id]
      );
      return NextResponse.json({ ...(await getMuteState(session.id)) });
    }

    if (scope === "project") {
      let projectId = Number(body.projectId);
      if (!Number.isInteger(projectId) || projectId <= 0) {
        const p = await projectOf(String(body.refType ?? ""), Number(body.refId) || null);
        if (!p) return NextResponse.json({ error: "이 항목에는 연결된 프로젝트가 없어요." }, { status: 400 });
        projectId = p.id;
      }
      const on = body.on !== false; // 기본은 "끄기"
      if (on) {
        await query(
          `INSERT INTO notification_mute (user_id, scope) VALUES ($1, $2)
           ON CONFLICT (user_id, scope) DO NOTHING`,
          [session.id, `project:${projectId}`]
        );
      } else {
        await query(`DELETE FROM notification_mute WHERE user_id = $1 AND scope = $2`,
          [session.id, `project:${projectId}`]);
      }
      return NextResponse.json({ projectId, ...(await getMuteState(session.id)) });
    }

    return NextResponse.json({ error: "scope는 all 또는 project입니다." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
