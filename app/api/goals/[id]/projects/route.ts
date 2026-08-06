// 목표 ↔ 프로젝트 연결 (MD-P-2026-009 §B1)
// 프로젝트는 목표 하나에 속한다(project.goal_id). 목표 쪽에서는 다중 선택으로 붙인다.
// 이미 다른 목표에 연결된 프로젝트도 고를 수 있고, 그 경우 연결이 이 목표로 옮겨간다.
import { NextResponse } from "next/server";
import { applyInheritanceForProject } from "@/lib/goal-inherit";
import { requireSession } from "@/lib/auth";
import type { SessionUser } from "@/lib/types";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { recomputeGoalChain } from "@/lib/goals";
import { projectTasks, rollupProgress } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Row {
  id: number; name: string; color_key: string | null; status: string;
  goal_id: number | null; goal_title: string | null;
}

/**
 * 목표 접근 가드 (MD-P-2026-015 §C).
 * 예전엔 requireSession()만 걸려 있어서, 남의 개인 목표에 붙은 프로젝트를 읽고
 * 심지어 연결·해제까지 할 수 있었다. /api/goals/[id] 와 같은 규칙으로 맞춘다.
 *   개인 목표 — 읽기: 본인·팀장 / 쓰기: 본인만
 *   팀   목표 — 읽기: 전원   / 쓰기: 팀장만
 */
async function guardGoal(goalId: number, session: SessionUser, mode: "read" | "write") {
  const g = await queryOne<{ id: number; title: string; scope: string; owner_actor_id: number | null }>(
    `SELECT id, title, scope, owner_actor_id FROM goal WHERE id = $1 AND is_active = true`,
    [goalId]
  );
  if (!g) return { error: NextResponse.json({ error: "목표를 찾을 수 없습니다." }, { status: 404 }) };
  const isLead = session.role === "lead";
  const isOwner = g.owner_actor_id === session.id;
  if (g.scope === "personal") {
    const allowed = mode === "read" ? isOwner || isLead : isOwner;
    if (!allowed) {
      return { error: NextResponse.json({ error: "열람 권한이 없습니다." }, { status: 403 }) };
    }
  } else if (mode === "write" && !isLead) {
    return { error: NextResponse.json({ error: "팀 목표는 팀장만 수정할 수 있습니다." }, { status: 403 }) };
  }
  return { goal: g };
}

async function withProgress(rows: Row[]) {
  const out = [];
  for (const r of rows) {
    const tasks = await projectTasks(r.id);
    out.push({
      id: r.id, name: r.name, colorKey: r.color_key, status: r.status,
      progress: rollupProgress(tasks),   // null = 업무 0건 (0%가 아니다)
      taskCount: tasks.length,
      linkedGoalId: r.goal_id,
      linkedGoalTitle: r.goal_title,
    });
  }
  return out;
}

/** 연결된 프로젝트 + 연결 후보(전체). 후보에는 "다른 목표에 연결됨" 표시를 위한 정보가 붙는다. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const goalId = Number(params.id);
    if (!Number.isInteger(goalId)) return NextResponse.json({ error: "잘못된 목표입니다." }, { status: 400 });
    const gate = await guardGoal(goalId, session, "read");
    if (gate.error) return gate.error;

    const rows = await query<Row>(
      `SELECT p.id, p.name, p.color_key, p.status, p.goal_id, g.title AS goal_title
         FROM project p LEFT JOIN goal g ON g.id = p.goal_id
        WHERE p.is_active = true AND p.status <> 'archived'
        ORDER BY p.name`
    );
    const all = await withProgress(rows);
    return NextResponse.json({
      linked: all.filter((p) => p.linkedGoalId === goalId),
      candidates: all.filter((p) => p.linkedGoalId !== goalId),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** 연결 — { projectIds: number[] }. 기존 연결은 유지하고 지정한 것만 이 목표로 붙인다. */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const goalId = Number(params.id);
    const body = await request.json();
    const ids: number[] = Array.isArray(body.projectIds)
      ? body.projectIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0)
      : [];
    if (!Number.isInteger(goalId) || ids.length === 0) {
      return NextResponse.json({ error: "연결할 프로젝트를 고르세요." }, { status: 400 });
    }
    const gate = await guardGoal(goalId, session, "write");
    if (gate.error) return gate.error;
    const goal = gate.goal!;

    // 옮겨오기 전 목표들도 함께 재계산해야 진척이 정확해진다.
    const prev = await query<{ goal_id: number | null }>(
      `SELECT DISTINCT goal_id FROM project WHERE id = ANY($1::int[]) AND goal_id IS NOT NULL`, [ids]
    );
    const moved = await query<{ id: number; name: string }>(
      `UPDATE project SET goal_id = $1 WHERE id = ANY($2::int[]) AND is_active = true RETURNING id, name`,
      [goalId, ids]
    );

    const affected = new Set<number>([goalId]);
    for (const r of prev) if (r.goal_id) affected.add(r.goal_id);
    // 프로젝트가 다른 목표로 옮겨가면 inherited 업무도 따라가야 한다 (MD-P-2026-024 §4).
    // 이 경로는 project.goal_id 를 직접 바꾸므로 여기서도 상속을 다시 맞춘다.
    for (const m of moved) {
      for (const g of await applyInheritanceForProject(m.id)) affected.add(g);
    }
    for (const gid of Array.from(affected)) await recomputeGoalChain(gid);

    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 목표에 프로젝트 연결 — "${goal.title}" ← ${moved.map((m) => m.name).join(", ")}`,
      level: "success",
    });
    return NextResponse.json({ linked: moved.length });
  } catch (error) {
    return jsonError(error);
  }
}

/** 연결 해제 — ?projectId=N. 해제 즉시 진척을 재계산한다. */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const goalId = Number(params.id);
    const projectId = Number(new URL(request.url).searchParams.get("projectId"));
    if (!Number.isInteger(goalId) || !Number.isInteger(projectId)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const gate = await guardGoal(goalId, session, "write");
    if (gate.error) return gate.error;
    const rows = await query<{ id: number; name: string }>(
      `UPDATE project SET goal_id = NULL WHERE id = $1 AND goal_id = $2 RETURNING id, name`,
      [projectId, goalId]
    );
    if (rows.length === 0) return NextResponse.json({ error: "연결된 프로젝트가 아닙니다." }, { status: 404 });
    // 연결이 끊기면 inherited 업무의 목표 연결도 함께 풀린다 (MD-P-2026-024 §4).
    const affected = new Set<number>([goalId]);
    for (const g of await applyInheritanceForProject(projectId)) affected.add(g);
    for (const gid of Array.from(affected)) await recomputeGoalChain(gid);
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 목표-프로젝트 연결 해제 — ${rows[0].name}`,
      level: "info",
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
