// 구성원 수정 (Phase 8) — lead 전용. 비활성화/재활성화·역할 변경·short_name 수정.
// 하드 삭제 없음. 가드 2개:
//   ① lead는 본인을 비활성화할 수 없다
//   ② 시스템에 활성 lead가 1명뿐이면 그 lead의 강등·비활성화 불가
import { NextResponse } from "next/server";
import { requireLead } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = ["lead", "member", "viewer"] as const;

async function activeLeadCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM account ac JOIN actor a ON a.id = ac.actor_id
     WHERE ac.role = 'lead' AND a.is_active = true`
  );
  return Number(row?.n ?? 0);
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireLead();
    const memberId = Number(params.id);
    const payload = await request.json();

    const member = await queryOne<{
      id: number;
      display_name: string;
      role: string;
      is_active: boolean;
    }>(
      `SELECT a.id, a.display_name, ac.role, a.is_active
       FROM actor a JOIN account ac ON ac.actor_id = a.id
       WHERE a.id = $1 AND a.type = 'human'`,
      [memberId]
    );
    if (!member) return NextResponse.json({ error: "구성원을 찾을 수 없습니다." }, { status: 404 });

    // ── 비활성화 ──
    if (payload.isActive === false) {
      if (member.id === session.id) {
        return NextResponse.json({ error: "본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
      }
      if (member.role === "lead" && (await activeLeadCount()) <= 1) {
        return NextResponse.json(
          { error: "활성 팀장이 1명뿐입니다. 다른 팀장을 지정한 뒤 비활성화하세요." },
          { status: 400 }
        );
      }
      await query("UPDATE actor SET is_active = false WHERE id = $1", [memberId]);
      // 부사수도 함께 비활성화 (담당자 없는 에이전트 방지). 과거 Task 담당 이력은 유지됨
      await query("UPDATE actor SET is_active = false WHERE type = 'agent' AND owner_actor_id = $1", [memberId]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 구성원 비활성화 — ${member.display_name}`,
        level: "warn",
      });
      return NextResponse.json({ ok: true });
    }

    // ── 재활성화 ──
    if (payload.isActive === true && !member.is_active) {
      await query("UPDATE actor SET is_active = true WHERE id = $1", [memberId]);
      await query("UPDATE actor SET is_active = true WHERE type = 'agent' AND owner_actor_id = $1", [memberId]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 구성원 재활성화 — ${member.display_name}`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 역할 변경 ──
    if (payload.role !== undefined) {
      if (!(ROLES as readonly string[]).includes(payload.role)) {
        return NextResponse.json({ error: "역할 값이 올바르지 않습니다." }, { status: 400 });
      }
      // 마지막 활성 lead를 강등하려는 경우 차단
      if (member.role === "lead" && payload.role !== "lead" && (await activeLeadCount()) <= 1) {
        return NextResponse.json(
          { error: "활성 팀장이 1명뿐입니다. 다른 팀장을 지정한 뒤 강등하세요." },
          { status: 400 }
        );
      }
      await query("UPDATE account SET role = $1 WHERE actor_id = $2", [payload.role, memberId]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 역할 변경 — ${member.display_name} → ${payload.role}`,
      });
    }

    // ── short_name 수정 ──
    if (typeof payload.shortName === "string") {
      await query("UPDATE actor SET short_name = $1 WHERE id = $2", [
        payload.shortName.trim().slice(0, 30) || null,
        memberId,
      ]);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
