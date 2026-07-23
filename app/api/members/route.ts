// 구성원 관리 API (Phase 8) — lead 전용. GET: 목록, POST: 계정 발급.
// 계정 발급 시 임시 비밀번호(must_change_pw=true) + 부사수 actor(type='agent') 자동 생성.
// 하드 삭제 없음 — 비활성화는 [id] 라우트의 is_active=false.
import { NextResponse } from "next/server";
import { requireLiveLead } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { hashPassword, generateTempPassword } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ROLES = ["lead", "member", "viewer"] as const;

export async function GET() {
  try {
    await requireLiveLead();
    const rows = await query<{
      id: number;
      display_name: string;
      short_name: string | null;
      email: string;
      role: string;
      must_change_pw: boolean;
      is_active: boolean;
      last_login_at: string | null;
      assistant_name: string | null;
    }>(
      `SELECT a.id, a.display_name, a.short_name, ac.email, ac.role, ac.must_change_pw,
              a.is_active, ac.last_login_at::text,
              ag.display_name AS assistant_name
       FROM actor a
       JOIN account ac ON ac.actor_id = a.id
       LEFT JOIN actor ag ON ag.type = 'agent' AND ag.owner_actor_id = a.id AND ag.is_active = true
       WHERE a.type = 'human'
       ORDER BY a.is_active DESC, a.id`
    );
    return NextResponse.json({
      members: rows.map((r) => ({
        id: r.id,
        displayName: r.display_name,
        shortName: r.short_name,
        email: r.email,
        role: r.role,
        mustChangePw: r.must_change_pw,
        isActive: r.is_active,
        lastLoginAt: r.last_login_at,
        assistantName: r.assistant_name,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireLiveLead();
    const payload = await request.json();
    const displayName = String(payload.displayName ?? "").trim().slice(0, 60);
    const email = String(payload.email ?? "").trim().toLowerCase();
    const shortName = String(payload.shortName ?? "").trim().slice(0, 30) || null;
    const role = (ROLES as readonly string[]).includes(payload.role) ? payload.role : "member";
    const assistantName = String(payload.assistantName ?? "").trim().slice(0, 60) || `${displayName}의 부사수`;

    if (!displayName) return NextResponse.json({ error: "이름을 입력하세요." }, { status: 400 });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return NextResponse.json({ error: "올바른 이메일을 입력하세요." }, { status: 400 });
    }
    const existing = await queryOne("SELECT actor_id FROM account WHERE email = $1", [email]);
    if (existing) return NextResponse.json({ error: "이미 등록된 이메일입니다." }, { status: 409 });

    // 1. human actor + account (임시 비밀번호, 변경 강제)
    const tempPw = generateTempPassword();
    const human = await queryOne<{ id: number }>(
      `INSERT INTO actor (type, display_name, short_name) VALUES ('human', $1, $2) RETURNING id`,
      [displayName, shortName]
    );
    await query(
      `INSERT INTO account (actor_id, email, password_hash, role, must_change_pw, notion_user_id)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [human!.id, email, hashPassword(tempPw), role, payload.notionUserId ? String(payload.notionUserId) : null]
    );

    // 2. 부사수 actor(type='agent') + agent_config 자동 생성
    const workAreas = Array.isArray(payload.workAreas) ? payload.workAreas.map(String) : [];
    const agent = await queryOne<{ id: number }>(
      `INSERT INTO actor (type, display_name, owner_actor_id) VALUES ('agent', $1, $2) RETURNING id`,
      [assistantName, human!.id]
    );
    await query(`INSERT INTO agent_config (actor_id, work_areas) VALUES ($1, $2)`, [
      agent!.id,
      JSON.stringify(workAreas),
    ]);

    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 구성원 계정 발급 — ${displayName} (${email}, ${role})`,
      level: "success",
    });
    // 임시 비밀번호는 응답으로 1회 전달 (전달 후 서버에 평문 미보관)
    return NextResponse.json({ id: human!.id, tempPassword: tempPw });
  } catch (error) {
    return jsonError(error);
  }
}
