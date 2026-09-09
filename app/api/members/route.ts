// 구성원 관리 API (Phase 8) — lead 전용. GET: 목록, POST: 계정 발급.
// 계정 발급 시 임시 비밀번호(must_change_pw=true) + 에이전트 actor(type='agent') 자동 생성.
// 하드 삭제 없음 — 비활성화는 [id] 라우트의 is_active=false.
import { NextResponse } from "next/server";
import { requireLiveAdmin } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { hashPassword, generateTempPassword } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { ROLES } from "@/lib/types";

/*
 * ⚠ **관리자 전용입니다.** 담당자 선택처럼 팀장·팀원이 멤버 이름을 봐야 하는
 *    자리에서는 이 API 를 쓰지 마십시오. 그런 자리는 `/api/meta/selectors` 의
 *    `actors` 를 씁니다(requireSession — 로그인만 하면 볼 수 있습니다).
 *
 *    확인해 둔 사용처 (MD-P-2026-036 §D)
 *      GET  /api/members        → MemberManager 하나뿐
 *      GET  /api/members/{id}   → SidePanel. **requireSession 이라 안 좁혔습니다**
 *      PUT  /api/members/{id}   → MemberManager. 관리자 전용
 *    업무 담당자·프로젝트 담당·리뷰 지정·언급(@) 전부 selectors 경로입니다.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function GET() {
  try {
    await requireLiveAdmin();
    const rows = await query<{
      id: number;
      display_name: string;
      short_name: string | null;
      email: string;
      role: string;
      must_change_pw: boolean;
      is_active: boolean;
      last_login_at: string | null;
      created_at: string | null;
      assistant_name: string | null;
      admin_grant: boolean;
    }>(
      `SELECT a.id, a.display_name, a.short_name, ac.email, ac.role, ac.must_change_pw,
              ac.admin_grant, a.is_active, ac.last_login_at::text, a.created_at::text,
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
        // 정체(role)와 **따로** 실어 보낸다. 화면이 둘을 합치지 않게 하려면
        // 값도 합쳐서 오면 안 된다 (039 §B-2).
        adminGrant: r.admin_grant,
        mustChangePw: r.must_change_pw,
        isActive: r.is_active,
        lastLoginAt: r.last_login_at,
        createdAt: r.created_at,
        assistantName: r.assistant_name,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireLiveAdmin();
    const payload = await request.json();
    const displayName = String(payload.displayName ?? "").trim().slice(0, 60);
    const email = String(payload.email ?? "").trim().toLowerCase();
    const shortName = String(payload.shortName ?? "").trim().slice(0, 30) || null;
    const role = (ROLES as readonly string[]).includes(payload.role) ? payload.role : "member";
    const assistantName = String(payload.assistantName ?? "").trim().slice(0, 60) || `${displayName}의 에이전트`;

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

    // 2. 에이전트 actor(type='agent') + agent_config 자동 생성
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
