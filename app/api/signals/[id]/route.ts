// 시그널 상세·액션 (Phase 6, A 수정 반영).
// 생명주기: open → discussing → decided(결정됨·Task 미생성) → resolved(반영됨·Task 생성)
//           또는 archived(기각). review는 대상 확인 시 resolved.
// 권한: decision의 decided/resolved/archived 전환은 작성자·lead / review 종결은 대상·lead /
//       그 외 타입 전이는 member 전권. private·review 가시성은 API 레벨 차단.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["open", "discussing", "decided", "resolved", "archived"] as const;

interface SignalRow {
  id: number;
  type: string;
  scope: string;
  title: string;
  body: string;
  status: string;
  author_id: number;
  target_actor_id: number | null;
  project_id: number | null;
  task_id: number | null;
}

async function loadSignal(id: number): Promise<SignalRow | null> {
  return queryOne<SignalRow>(
    `SELECT id, type, scope, title, body, status, author_id, target_actor_id, project_id, task_id
     FROM signal WHERE id = $1 AND is_active = true`,
    [id]
  );
}

/** 가시성 — private=작성자 / review=작성자+대상+lead / 그 외 공개 */
function canView(signal: SignalRow, userId: number, isLead: boolean): boolean {
  if (signal.scope === "private") return signal.author_id === userId;
  if (signal.type === "review") {
    return signal.author_id === userId || signal.target_actor_id === userId || isLead;
  }
  return true;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const signal = await loadSignal(Number(params.id));
    if (!signal) return NextResponse.json({ error: "시그널을 찾을 수 없습니다." }, { status: 404 });
    if (!canView(signal, session.id, session.role === "lead")) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }

    const meta = await queryOne<{
      author_name: string;
      author_type: string;
      target_name: string | null;
      project_name: string | null;
      task_title: string | null;
      huddle_at: string | null;
      created_at: string;
    }>(
      `SELECT a.display_name AS author_name, a.type AS author_type,
              ta.display_name AS target_name,
              p.name AS project_name, t.title AS task_title,
              s.huddle_at::text, s.created_at::text
       FROM signal s
       JOIN actor a ON a.id = s.author_id
       LEFT JOIN actor ta ON ta.id = s.target_actor_id
       LEFT JOIN project p ON p.id = s.project_id
       LEFT JOIN task t ON t.id = s.task_id
       WHERE s.id = $1`,
      [signal.id]
    );
    const comments = await query<{
      id: number;
      body: string;
      author_name: string;
      author_type: string;
      created_at: string;
    }>(
      `SELECT c.id, c.body, a.display_name AS author_name, a.type AS author_type, c.created_at::text
       FROM comment c JOIN actor a ON a.id = c.author_id
       WHERE c.signal_id = $1 ORDER BY c.created_at ASC`,
      [signal.id]
    );
    return NextResponse.json({
      signal: {
        id: signal.id,
        type: signal.type,
        scope: signal.scope,
        title: signal.title,
        body: signal.body,
        status: signal.status,
        taskId: signal.task_id,
        taskTitle: meta?.task_title ?? null,
        targetActorId: signal.target_actor_id,
        targetName: meta?.target_name ?? null,
        authorId: signal.author_id,
        authorName: meta?.author_name ?? "",
        agent: meta?.author_type === "agent",
        projectName: meta?.project_name ?? null,
        huddledAt: meta?.huddle_at ?? null,
      },
      comments: comments.map((c) => ({
        id: c.id,
        body: c.body,
        authorName: c.author_name,
        agent: c.author_type === "agent",
        createdAt: c.created_at,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const signal = await loadSignal(Number(params.id));
    if (!signal) return NextResponse.json({ error: "시그널을 찾을 수 없습니다." }, { status: 404 });
    const isLead = session.role === "lead";
    if (!canView(signal, session.id, isLead)) {
      return NextResponse.json({ error: "접근 권한이 없습니다." }, { status: 403 });
    }
    const payload = await request.json();
    const isAuthor = signal.author_id === session.id;
    const isTarget = signal.target_actor_id === session.id;

    // ── 허들로 보내기: huddle_at 기록 + scope=huddle (작성자만). 이후 삭제 안 함 ──
    if (payload.action === "toHuddle") {
      if (!isAuthor) return NextResponse.json({ error: "본인 시그널만 공유할 수 있습니다." }, { status: 403 });
      await query(
        `UPDATE signal SET scope = 'huddle', huddle_at = COALESCE(huddle_at, now()) WHERE id = $1`,
        [signal.id]
      );
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 시그널을 허들로 공유 — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 결정으로 승격: memo → decision (작성자 또는 lead). 코멘트는 signal_id로 보존 ──
    if (payload.action === "promote") {
      if (signal.type !== "memo") {
        return NextResponse.json({ error: "메모만 결정으로 승격할 수 있습니다." }, { status: 400 });
      }
      if (!isAuthor && !isLead) {
        return NextResponse.json({ error: "작성자 또는 팀장만 승격할 수 있습니다." }, { status: 403 });
      }
      // 결정은 팀 전체 공개. 허들 이력(huddle_at)은 유지해 피드에 계속 노출
      await query(
        `UPDATE signal SET type = 'decision', scope = 'team', status = 'discussing' WHERE id = $1`,
        [signal.id]
      );
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 메모를 결정으로 승격 — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 결정 → Task 생성: decided/discussing → resolved, signal.task_id 연결 ──
    if (payload.action === "createTask") {
      if (signal.type !== "decision") {
        return NextResponse.json({ error: "결정 시그널만 Task로 반영할 수 있습니다." }, { status: 400 });
      }
      if (!isAuthor && !isLead) {
        return NextResponse.json({ error: "작성자 또는 팀장만 반영할 수 있습니다." }, { status: 403 });
      }
      if (signal.task_id) {
        return NextResponse.json({ error: "이미 연결된 Task가 있습니다." }, { status: 409 });
      }
      const title = String(payload.title ?? "").trim().slice(0, 200) || signal.title;
      const task = await queryOne<{ id: number }>(
        `INSERT INTO task (project_id, title, description, status, assignee_id, due_date, origin, created_by)
         VALUES ($1,$2,$3,'todo',$4,$5,'human',$6) RETURNING id`,
        [
          signal.project_id,
          title,
          `결정 시그널 #${signal.id} "${signal.title}"에서 생성`,
          payload.assigneeId ? Number(payload.assigneeId) : session.id,
          typeof payload.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
            ? payload.dueDate
            : null,
          session.id,
        ]
      );
      // createTask 성공 시에만 resolved 전환 (A-1)
      await query(
        `UPDATE signal SET task_id = $1, status = 'resolved', resolved_at = now() WHERE id = $2`,
        [task!.id, signal.id]
      );
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 결정을 업무로 반영 — "${signal.title}" → Task "${title}"`,
        level: "success",
      });
      return NextResponse.json({ ok: true, taskId: task!.id });
    }

    // ── 상태 전이 ──
    if (payload.status !== undefined) {
      const next = payload.status as string;
      if (!(STATUSES as readonly string[]).includes(next)) {
        return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
      }
      // decision의 resolved(반영됨)는 Task 생성 전용 — 직접 지정 금지 (createTask 경유)
      // review의 resolved는 confirmReview 전용. risk/memo는 직접 resolved(처리 완료) 허용
      if (next === "resolved" && (signal.type === "decision" || signal.type === "review")) {
        return NextResponse.json(
          {
            error:
              signal.type === "decision"
                ? "결정의 반영은 'Task로 반영'을 통해서만 가능합니다."
                : "확인 요청은 '확인 완료'를 통해서만 종결됩니다.",
          },
          { status: 400 }
        );
      }
      // 권한: decision 종결(decided/archived)은 작성자·lead, review 종결은 대상·lead
      const terminalForDecision = next === "decided" || next === "archived";
      if (signal.type === "decision" && terminalForDecision && !isAuthor && !isLead) {
        return NextResponse.json(
          { error: "결정의 종결은 작성자 또는 팀장만 할 수 있습니다." },
          { status: 403 }
        );
      }
      if (signal.type === "review" && (next === "resolved" || next === "archived" || next === "decided")) {
        if (!isTarget && !isLead) {
          return NextResponse.json(
            { error: "확인 요청의 종결은 대상자 또는 팀장만 할 수 있습니다." },
            { status: 403 }
          );
        }
      }

      const sets = ["status = $1"];
      if (next === "decided") sets.push("decided_at = now()");
      if (next === "resolved" || next === "archived") sets.push("resolved_at = now()");
      // 재오픈(open/discussing)이면 종결 시각 해제
      if (next === "open" || next === "discussing") sets.push("decided_at = NULL", "resolved_at = NULL");
      await query(`UPDATE signal SET ${sets.join(", ")} WHERE id = $2`, [next, signal.id]);

      const label =
        next === "discussing"
          ? "논의 시작"
          : next === "decided"
            ? "결정 확정"
            : next === "resolved"
              ? "처리 완료"
              : next === "archived"
                ? "기각 처리"
                : "재오픈";
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 시그널 ${label} — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 확인 요청 완료 (대상자가 확인) → resolved ──
    if (payload.action === "confirmReview") {
      if (signal.type !== "review") {
        return NextResponse.json({ error: "확인 요청만 확인 완료할 수 있습니다." }, { status: 400 });
      }
      if (!isTarget && !isLead) {
        return NextResponse.json({ error: "대상자 또는 팀장만 확인할 수 있습니다." }, { status: 403 });
      }
      await query(`UPDATE signal SET status = 'resolved', resolved_at = now() WHERE id = $1`, [signal.id]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 확인 요청 완료 — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
