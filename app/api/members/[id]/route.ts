// 구성원 수정 (Phase 8) — lead 전용. 비활성화/재활성화·역할 변경·short_name 수정.
// 하드 삭제 없음. 가드 2개:
//   ① lead는 본인을 비활성화할 수 없다
//   ② 시스템에 활성 lead가 1명뿐이면 그 lead의 강등·비활성화 불가
import { NextResponse } from "next/server";
import { requireLiveLead, requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = ["lead", "member", "viewer"] as const;

/** 멤버 프로필 (MD-P-2026-006 §B) — 전역 우측 패널이 읽는 공개 요약. 로그인만 요구한다. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "잘못된 구성원입니다." }, { status: 400 });
    }
    const member = await queryOne<{
      id: number; display_name: string; short_name: string | null; type: string;
      is_active: boolean; role: string | null; assistant_name: string | null;
    }>(
      `SELECT a.id, a.display_name, a.short_name, a.type, a.is_active, ac.role,
              ag.display_name AS assistant_name
       FROM actor a
       LEFT JOIN account ac ON ac.actor_id = a.id
       LEFT JOIN actor ag ON ag.type = 'agent' AND ag.owner_actor_id = a.id AND ag.is_active = true
       WHERE a.id = $1`,
      [id]
    );
    if (!member) return NextResponse.json({ error: "구성원을 찾을 수 없습니다." }, { status: 404 });

    const [tasks, stats, decisions] = await Promise.all([
      query<{ id: number; title: string; status: string; progress: number; due_date: string | null; project_name: string | null }>(
        `SELECT t.id, t.title, t.status, t.progress, t.due_date::text, p.name AS project_name
         FROM task t LEFT JOIN project p ON p.id = t.project_id
         WHERE t.assignee_id = $1 AND t.is_active = true AND t.status <> 'done'
         ORDER BY t.due_date NULLS LAST, t.id LIMIT 8`,
        [id]
      ),
      queryOne<{ open_n: string; done_week: string }>(
        `SELECT count(*) FILTER (WHERE status <> 'done') AS open_n,
                count(*) FILTER (WHERE status = 'done' AND updated_at >= now() - interval '7 days') AS done_week
         FROM task WHERE assignee_id = $1 AND is_active = true`,
        [id]
      ),
      query<{ id: number; title: string; decided_at: string }>(
        `SELECT id, title, decided_at::text FROM decision
         WHERE decided_by = $1 ORDER BY decided_at DESC LIMIT 3`,
        [id]
      ),
    ]);

    return NextResponse.json({
      member: {
        id: member.id,
        name: member.display_name,
        shortName: member.short_name,
        isAgent: member.type === "agent",
        isActive: member.is_active,
        role: member.role,
        assistantName: member.assistant_name,
      },
      openCount: Number(stats?.open_n ?? 0),
      doneThisWeek: Number(stats?.done_week ?? 0),
      tasks: tasks.map((t) => ({
        id: t.id, title: t.title, status: t.status, progress: t.progress,
        dueDate: t.due_date, projectName: t.project_name,
      })),
      decisions: decisions.map((d) => ({ id: d.id, title: d.title, decidedAt: d.decided_at })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

async function activeLeadCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM account ac JOIN actor a ON a.id = ac.actor_id
     WHERE ac.role = 'lead' AND a.is_active = true`
  );
  return Number(row?.n ?? 0);
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireLiveLead();
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
      // 에이전트도 함께 비활성화 (담당자 없는 에이전트 방지). 과거 Task 담당 이력은 유지됨
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
