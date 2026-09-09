// 구성원 수정 (Phase 8) — lead 전용. 비활성화/재활성화·역할 변경·short_name 수정.
// 하드 삭제 없음. 가드 2개:
//   ① lead는 본인을 비활성화할 수 없다
//   ② 시스템에 활성 lead가 1명뿐이면 그 lead의 강등·비활성화 불가
import { NextResponse } from "next/server";
import { requireLiveAdmin, requireSession } from "@/lib/auth";
import { visibleTaskSql } from "@/lib/visibility";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { isAdmin, ROLES, hasLead, adminWhereSql } from "@/lib/types";

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


/** 멤버 프로필 (MD-P-2026-006 §B) — 전역 우측 패널이 읽는 공개 요약. 로그인만 요구한다. */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
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
         -- 구성원 상세 — 남의 개인 업무는 그 사람 프로필에서도 안 보인다 (§A3 ①)
         WHERE t.assignee_id = $1 AND t.is_active = true AND t.status <> 'done'
           AND ${visibleTaskSql("$2")}
         ORDER BY t.due_date NULLS LAST, t.id LIMIT 8`,
        [id, session.id]
      ),
      queryOne<{ open_n: string; done_week: string }>(
        `SELECT count(*) FILTER (WHERE status <> 'done') AS open_n,
                count(*) FILTER (WHERE status = 'done' AND updated_at >= now() - interval '7 days') AS done_week
         FROM task t WHERE assignee_id = $1 AND is_active = true
           AND ${visibleTaskSql("$2")}`,
        [id, session.id]
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

/**
 * 활성 관리자 수 — **`isAdmin` 과 같은 기준으로 센다** (MD-P-2026-039 §B-4).
 *
 * 예전엔 `role='admin'` 만 셌다. 그 사이 판정이 `admin_grant` 도 보게 됐으므로
 * 그대로 두면 **권한으로 관리자인 사람이 안 세어진다** — 판정은 통과시키는데
 * 집계는 「1명뿐」이라 막는다. 035 에서 `activeLeadCount` 가 admin 을 빠뜨려
 * 똑같은 일이 났다. 그래서 세는 식을 `adminWhereSql` 하나에서 낸다.
 */
async function activeAdminCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM account ac JOIN actor a ON a.id = ac.actor_id
     WHERE ${adminWhereSql("ac")} AND a.is_active = true`
  );
  return Number(row?.n ?? 0);
}

/**
 * 팀장 권한을 가진 활성 계정 수 — **관리자를 포함한다.**
 *
 * `role = 'lead'` 만 세면 관리자 1 + 팀장 1 인 상태에서 팀장을 내릴 때
 * 「팀장이 1명뿐」으로 막힌다. 실제로는 팀장 일을 할 수 있는 사람이 둘인데도.
 * 등급이 포함 관계이므로(`hasLead`) 세는 쪽도 포함해서 센다 —
 * **판정과 집계가 다른 기준을 쓰면 그 차이만큼 조용히 틀린다.**
 */
async function activeLeadCount(): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM account ac JOIN actor a ON a.id = ac.actor_id
     WHERE ac.role IN ('admin', 'lead') AND a.is_active = true`
  );
  return Number(row?.n ?? 0);
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireLiveAdmin();
    const memberId = Number(params.id);
    const payload = await request.json();

    const member = await queryOne<{
      id: number;
      display_name: string;
      role: string;
      is_active: boolean;
      admin_grant: boolean;
    }>(
      `SELECT a.id, a.display_name, ac.role, a.is_active, ac.admin_grant
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
      if (hasLead(member.role) && (await activeLeadCount()) <= 1) {
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

    /*
     * ── 역할(정체)과 관리자 권한 — **한자리에서 본다** (MD-P-2026-039 §B) ──
     *
     * 두 값을 따로따로 막으면 **한 요청에 둘 다 담겼을 때 둘 다 통과한다.**
     * 역할만 보면 "권한이 남으니 괜찮다", 권한만 보면 "역할이 남으니 괜찮다"가
     * 되고, 실제로는 마지막 관리자가 사라진다. 그래서 바뀐 뒤 상태를 먼저
     * 만들고, 그 상태를 하나의 판정에 넣는다.
     */
    const roleChanged = payload.role !== undefined;
    const grantChanged = payload.adminGrant !== undefined;

    if (roleChanged && !(ROLES as readonly string[]).includes(payload.role)) {
      return NextResponse.json({ error: "역할 값이 올바르지 않습니다." }, { status: 400 });
    }
    if (grantChanged && typeof payload.adminGrant !== "boolean") {
      return NextResponse.json({ error: "관리자 권한 값이 올바르지 않습니다." }, { status: 400 });
    }
    /*
     * `role='admin'` 인 사람의 권한은 켤 수도 끌 수도 없다 — 이미 권한이 있고,
     * 꺼도 없어지지 않는다. 화면에는 칸을 아예 안 그리고 이유를 적는다.
     * 화면이 안 그린다고 API 가 열려 있으면 안 된다 — **막은 것을 여기서도 막는다.**
     */
    if (grantChanged && member.role === "admin") {
      return NextResponse.json(
        { error: "역할이 관리자라 항상 권한이 있습니다. 권한을 따로 켜고 끌 수 없습니다." },
        { status: 400 }
      );
    }

    if (roleChanged || grantChanged) {
      const before = { role: member.role, adminGrant: member.admin_grant };
      const after = {
        role: roleChanged ? payload.role : member.role,
        adminGrant: grantChanged ? payload.adminGrant : member.admin_grant,
      };
      /*
       * ── 마지막 한 명을 내리지 못하게 막는다 (035 §B-4 · 039 §B-4) ──
       *
       * 관리자가 0 명이 되면 **아무도 계정을 발급할 수 없는데 아무도 그 사실을
       * 모른다.** 멤버 관리 화면 자체가 관리자 전용이라 들어가 볼 수도 없다.
       *
       * 자기 자신의 권한을 끄는 것은 **막지 않는다** — 팀장이 나중에 손수
       * 내릴 자리다. 다만 그게 마지막 한 명이면 여기 걸린다. 남이 끄든 자기가
       * 끄든 관리자가 0명이 되는 것은 똑같기 때문이다.
       *
       * 관리자 먼저 본다 — 관리자를 팀장으로 내리는 경우 두 조건에 다 걸릴 수
       * 있는데, 그때 알려야 할 것은 「관리자가 없어진다」다.
       *
       * 이건 **규칙**이므로 400 이다. 권한(관리자가 아님)은 requireLiveAdmin 이
       * 위에서 이미 403 으로 걸렀다 — 규칙을 권한보다 먼저 평가한다.
       */
      if (isAdmin(before) && !isAdmin(after) && (await activeAdminCount()) <= 1) {
        return NextResponse.json(
          { error: "활성 관리자가 1명뿐입니다. 다른 관리자를 지정한 뒤 내리세요." },
          { status: 400 }
        );
      }
      // 마지막 활성 팀장(관리자 포함)을 강등하려는 경우 차단 — 기존 규칙 그대로.
      // 팀장 판정은 정체(role)만 본다 — 039 에서 `hasLead` 는 건드리지 않았다.
      if (hasLead(before.role) && !hasLead(after.role) && (await activeLeadCount()) <= 1) {
        return NextResponse.json(
          { error: "활성 팀장이 1명뿐입니다. 다른 팀장을 지정한 뒤 강등하세요." },
          { status: 400 }
        );
      }

      if (roleChanged) {
        await query("UPDATE account SET role = $1 WHERE actor_id = $2", [payload.role, memberId]);
        await logActivity({
          userId: session.id,
          message: `${session.name}이(가) 역할 변경 — ${member.display_name} → ${payload.role}`,
        });
      }
      if (grantChanged) {
        await query("UPDATE account SET admin_grant = $1 WHERE actor_id = $2", [payload.adminGrant, memberId]);
        await logActivity({
          userId: session.id,
          message: `${session.name}이(가) 관리자 권한 ${payload.adminGrant ? "부여" : "회수"} — ${member.display_name}`,
          level: "warn",
        });
      }
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
