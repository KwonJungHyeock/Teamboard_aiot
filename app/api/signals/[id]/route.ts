// 시그널 상세·액션 (Phase 6) — GET: 상세+코멘트, PUT: 상태 전이·허들로 보내기·
// 결정으로 승격·Task 생성(signal.task_id 연결).
// scope='private'는 작성자 외 접근을 API 레벨에서 403 처리한다 (검수 포인트 3).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["open", "discussing", "resolved", "archived"] as const;

interface SignalRow {
  id: number;
  type: string;
  scope: string;
  title: string;
  body: string;
  status: string;
  author_id: number;
  project_id: number | null;
  task_id: number | null;
}

async function loadSignal(id: number): Promise<SignalRow | null> {
  return queryOne<SignalRow>(
    `SELECT id, type, scope, title, body, status, author_id, project_id, task_id
     FROM signal WHERE id = $1 AND is_active = true`,
    [id]
  );
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const signal = await loadSignal(Number(params.id));
    if (!signal) return NextResponse.json({ error: "시그널을 찾을 수 없습니다." }, { status: 404 });
    if (signal.scope === "private" && signal.author_id !== session.id) {
      return NextResponse.json({ error: "비공개 메모입니다." }, { status: 403 });
    }

    const meta = await queryOne<{
      author_name: string;
      author_type: string;
      project_name: string | null;
      task_title: string | null;
      created_at: string;
    }>(
      `SELECT a.display_name AS author_name, a.type AS author_type,
              p.name AS project_name, t.title AS task_title, s.created_at::text
       FROM signal s
       JOIN actor a ON a.id = s.author_id
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
        authorId: signal.author_id,
        authorName: meta?.author_name ?? "",
        agent: meta?.author_type === "agent",
        projectName: meta?.project_name ?? null,
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
    if (signal.scope === "private" && signal.author_id !== session.id) {
      return NextResponse.json({ error: "비공개 메모입니다." }, { status: 403 });
    }
    const payload = await request.json();
    const isLead = session.role === "lead";
    const isAuthor = signal.author_id === session.id;

    // ── 허들로 보내기: private → huddle (작성자만 — 본인 메모 공유) ──
    if (payload.action === "toHuddle") {
      if (signal.scope !== "private") {
        return NextResponse.json({ error: "비공개 메모만 허들로 보낼 수 있습니다." }, { status: 400 });
      }
      if (!isAuthor) return NextResponse.json({ error: "본인 메모만 공유할 수 있습니다." }, { status: 403 });
      await query(`UPDATE signal SET scope = 'huddle' WHERE id = $1`, [signal.id]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 메모를 허들로 공유 — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 결정으로 승격: memo → decision (작성자 또는 lead). 코멘트는 signal_id로 그대로 보존 ──
    if (payload.action === "promote") {
      if (signal.type !== "memo") {
        return NextResponse.json({ error: "메모만 결정으로 승격할 수 있습니다." }, { status: 400 });
      }
      if (!isAuthor && !isLead) {
        return NextResponse.json({ error: "작성자 또는 팀장만 승격할 수 있습니다." }, { status: 403 });
      }
      // decision은 팀 전체 공개 (SPEC 2.3) — 허들·비공개에서 승격 시 team으로
      await query(`UPDATE signal SET type = 'decision', scope = 'team', status = 'discussing' WHERE id = $1`, [
        signal.id,
      ]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 메모를 결정으로 승격 — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    // ── 결정 → Task 생성: signal.task_id 연결 + 반영됨(resolved) 종료 ──
    if (payload.action === "createTask") {
      if (signal.type !== "decision") {
        return NextResponse.json({ error: "결정 시그널만 Task로 반영할 수 있습니다." }, { status: 400 });
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

    // ── 상태 전이 (논의 시작 / 결정됨 / 기각) ──
    if (payload.status !== undefined) {
      if (!(STATUSES as readonly string[]).includes(payload.status)) {
        return NextResponse.json({ error: "상태 값이 올바르지 않습니다." }, { status: 400 });
      }
      const terminal = payload.status === "resolved" || payload.status === "archived";
      await query(
        `UPDATE signal SET status = $1, resolved_at = ${terminal ? "now()" : "NULL"} WHERE id = $2`,
        [payload.status, signal.id]
      );
      const label =
        payload.status === "discussing"
          ? "논의 시작"
          : payload.status === "resolved"
            ? "해결 처리"
            : payload.status === "archived"
              ? "기각 처리"
              : "재오픈";
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 시그널 ${label} — "${signal.title}"`,
      });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "지원하지 않는 요청입니다." }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
