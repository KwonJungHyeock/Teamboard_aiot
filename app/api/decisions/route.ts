// 결정 로그 API (MD-P-2026-004) — GET: 목록(필터·검색), POST: 논의 해결 → 결정 확정.
// 결정은 삭제하지 않는다(감사 추적). 번복은 POST에 supersedesId를 넘겨 새 결정으로 대체한다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { notify } from "@/lib/notify";
import { listDecisions, getDecision, type DecisionStatus } from "@/lib/decisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const num = (k: string) => {
      const v = Number(url.searchParams.get(k));
      return Number.isInteger(v) && v > 0 ? v : undefined;
    };
    const statusParam = url.searchParams.get("status");
    const status = statusParam === "confirmed" || statusParam === "superseded" ? (statusParam as DecisionStatus) : undefined;
    const decisions = await listDecisions({
      projectId: num("project"),
      decidedBy: num("decidedBy"),
      status,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      q: url.searchParams.get("q")?.trim() || undefined,
    });
    return NextResponse.json({ decisions });
  } catch (error) {
    return jsonError(error);
  }
}

/** 논의 타입별 종결 상태 — SignalThread의 "해결로 표시" 규칙과 동일. */
function terminalStatusFor(type: string): string {
  return type === "decision" ? "decided" : "resolved";
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();
    const discussionId = Number(payload.discussionId);
    if (!Number.isInteger(discussionId)) {
      return NextResponse.json({ error: "논의를 지정하세요." }, { status: 400 });
    }
    const title = String(payload.title ?? "").trim().slice(0, 300);
    if (!title) return NextResponse.json({ error: "결정 내용을 입력하세요." }, { status: 400 });

    const signal = await queryOne<{
      id: number; type: string; scope: string; title: string; status: string;
      author_id: number; target_actor_id: number | null; project_id: number | null;
    }>(
      `SELECT id, type, scope, title, status, author_id, target_actor_id, project_id
       FROM signal WHERE id = $1 AND is_active = true`,
      [discussionId]
    );
    if (!signal) return NextResponse.json({ error: "논의를 찾을 수 없습니다." }, { status: 404 });

    const isLead = session.role === "lead";
    const isAuthor = signal.author_id === session.id;
    const isTarget = signal.target_actor_id === session.id;
    // 가시성 — private은 작성자만, review는 작성자·대상·lead
    const visible = signal.scope === "private" ? isAuthor
      : signal.type === "review" ? isAuthor || isTarget || isLead : true;
    if (!visible) return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    // 확정 권한 — decision은 작성자·lead, review는 대상·lead, 그 외 전원
    if (signal.type === "decision" && !isAuthor && !isLead) {
      return NextResponse.json({ error: "결정 확정은 작성자 또는 팀장만 할 수 있습니다." }, { status: 403 });
    }
    if (signal.type === "review" && !isTarget && !isLead) {
      return NextResponse.json({ error: "확인 요청의 종결은 대상자 또는 팀장만 할 수 있습니다." }, { status: 403 });
    }

    // 번복 대상 검증 (있으면)
    const supersedesId = Number(payload.supersedesId);
    let supersedes = null;
    if (Number.isInteger(supersedesId)) {
      supersedes = await getDecision(supersedesId);
      if (!supersedes) return NextResponse.json({ error: "번복할 결정을 찾을 수 없습니다." }, { status: 404 });
      if (supersedes.status === "superseded") {
        return NextResponse.json({ error: "이미 번복된 결정입니다." }, { status: 400 });
      }
    }

    const rationale = String(payload.rationale ?? "").trim().slice(0, 4000);
    const linkedTaskIds: number[] = Array.isArray(payload.linkedTaskIds)
      ? payload.linkedTaskIds.map(Number).filter((n: number) => Number.isInteger(n) && n > 0).slice(0, 50)
      : [];
    // 프로젝트 — 명시값 우선, 없으면 논의의 프로젝트, 그것도 없으면 연결 업무의 프로젝트
    let projectId: number | null = payload.projectId ? Number(payload.projectId) : signal.project_id;
    if (!projectId && linkedTaskIds.length) {
      const t = await queryOne<{ project_id: number | null }>(
        `SELECT project_id FROM task WHERE id = $1`, [linkedTaskIds[0]]
      );
      projectId = t?.project_id ?? null;
    }

    const decision = await queryOne<{ id: number }>(
      `INSERT INTO decision (project_id, discussion_id, title, rationale, decided_by, status, linked_task_ids)
       VALUES ($1,$2,$3,$4,$5,'confirmed',$6) RETURNING id`,
      [projectId, discussionId, title, rationale, session.id, linkedTaskIds]
    );

    // 번복 처리 — 기존 결정을 superseded로 두고 새 결정에 연결(삭제 금지)
    if (supersedes) {
      await query(
        `UPDATE decision SET status = 'superseded', superseded_by = $1 WHERE id = $2`,
        [decision!.id, supersedes.id]
      );
    }

    // 논의 종결 — 타입별 규칙
    const nextStatus = terminalStatusFor(signal.type);
    if (signal.status !== nextStatus) {
      const sets = ["status = $1"];
      if (nextStatus === "decided") sets.push("decided_at = now()");
      else sets.push("resolved_at = now()");
      await query(`UPDATE signal SET ${sets.join(", ")} WHERE id = $2`, [nextStatus, discussionId]);
    }

    // 참여자 알림 — 논의 작성자 + 답글 작성자 (본인 제외는 notify가 처리)
    const participants = await query<{ actor_id: number }>(
      `SELECT DISTINCT author_id AS actor_id FROM comment WHERE signal_id = $1
       UNION SELECT author_id FROM signal WHERE id = $1`,
      [discussionId]
    );
    const snippet = supersedes
      ? `결정이 번복됐어요 — "${title}"`
      : `"${signal.title}" 논의가 결정으로 확정됨`;
    for (const p of participants) {
      await notify({
        userId: p.actor_id, type: "approval", refType: "signal", refId: discussionId,
        snippet, actorId: session.id,
      });
    }

    await logActivity({
      userId: session.id,
      message: supersedes
        ? `${session.name}이(가) 결정 번복 — "${supersedes.title}" → "${title}"`
        : `${session.name}이(가) 결정 확정 — "${title}"`,
      level: "success",
    });

    return NextResponse.json({ decision: await getDecision(decision!.id) });
  } catch (error) {
    return jsonError(error);
  }
}
