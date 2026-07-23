// 업무 API (Phase 5) — GET: 목록(필터) + 인박스(proposed), POST: 생성.
// status='proposed'는 부사수 제안 상태 — 홈·캘린더·타임라인 집계에서 제외되고
// /tasks 인박스에서만 노출된다 (CHANGE-GUIDE Phase 5-1).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["proposed", "todo", "doing", "review", "done", "dropped"] as const;
const PRIORITIES = ["high", "mid", "low"] as const;

export interface TaskListRow {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  origin: string;
  projectId: number | null;
  projectName: string | null;
  colorKey: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  goalIds: number[];
  createdByName: string | null;
}

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const project = url.searchParams.get("project");
    const assignee = url.searchParams.get("assignee");
    const status = url.searchParams.get("status");
    const due = url.searchParams.get("due"); // overdue | 7d | 30d | none

    const where: string[] = ["t.is_active = true"];
    const params: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      params.push(value);
      where.push(clause.replace("?", `$${params.length}`));
    };

    if (status && (STATUSES as readonly string[]).includes(status)) {
      add("t.status = ?", status);
    } else {
      // 기본 목록은 proposed 제외 — 인박스는 status=proposed로 명시 조회
      where.push("t.status <> 'proposed'");
    }
    if (project) add("t.project_id = ?", Number(project));
    if (assignee) add("t.assignee_id = ?", Number(assignee));

    const today = kstToday();
    if (due === "overdue") {
      add("t.due_date < ?::date", today);
      where.push("t.status NOT IN ('done','dropped')");
    } else if (due === "7d" || due === "30d") {
      add("t.due_date >= ?::date", today);
      const end = new Date(`${today}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + (due === "7d" ? 7 : 30));
      add("t.due_date <= ?::date", end.toISOString().slice(0, 10));
    } else if (due === "none") {
      where.push("t.due_date IS NULL");
    }

    const rows = await query<{
      id: number;
      title: string;
      description: string;
      status: string;
      priority: string;
      origin: string;
      project_id: number | null;
      project_name: string | null;
      color_key: string | null;
      assignee_id: number | null;
      assignee_name: string | null;
      due_date: string | null;
      goal_ids: number[] | null;
      created_by_name: string | null;
    }>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.origin,
              t.project_id, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name, t.due_date::text,
              array_agg(gt.goal_id) FILTER (WHERE gt.goal_id IS NOT NULL) AS goal_ids,
              c.display_name AS created_by_name
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       LEFT JOIN goal_task gt ON gt.task_id = t.id
       WHERE ${where.join(" AND ")}
       GROUP BY t.id, p.name, p.color_key, a.display_name, c.display_name
       ORDER BY t.due_date ASC NULLS LAST, t.id DESC
       LIMIT 300`,
      params
    );

    // 인박스 — 부사수 제안(proposed) 업무. 목록 필터와 무관하게 항상 함께 반환
    const inboxRows = await query<{
      id: number;
      title: string;
      description: string;
      project_name: string | null;
      color_key: string | null;
      assignee_id: number | null;
      assignee_name: string | null;
      due_date: string | null;
      created_by_name: string | null;
    }>(
      `SELECT t.id, t.title, t.description, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name, t.due_date::text,
              c.display_name AS created_by_name
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       WHERE t.is_active = true AND t.status = 'proposed'
       ORDER BY t.created_at ASC`
    );

    // 화면 셀렉트용 부가 데이터 — 담당(활성 human)·프로젝트·연결 가능한 월 목표
    const actors = await query<{ id: number; display_name: string }>(
      `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
    );
    const projects = await query<{ id: number; name: string; color_key: string | null }>(
      `SELECT id, name, color_key FROM project WHERE is_active = true ORDER BY id`
    );
    const monthGoals = await query<{ id: number; title: string; period_start: string }>(
      `SELECT id, title, period_start::text FROM goal
       WHERE is_active = true AND period_type = 'month'
       ORDER BY period_start DESC, id LIMIT 100`
    );

    const tasks: TaskListRow[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      status: r.status,
      priority: r.priority,
      origin: r.origin,
      projectId: r.project_id,
      projectName: r.project_name,
      colorKey: r.color_key,
      assigneeId: r.assignee_id,
      assigneeName: r.assignee_name,
      dueDate: r.due_date,
      goalIds: r.goal_ids ?? [],
      createdByName: r.created_by_name,
    }));
    return NextResponse.json({
      tasks,
      inbox: inboxRows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        projectName: r.project_name,
        colorKey: r.color_key,
        assigneeId: r.assignee_id,
        assigneeName: r.assignee_name,
        dueDate: r.due_date,
        createdByName: r.created_by_name,
      })),
      today,
      actors: actors.map((a) => ({ id: a.id, name: a.display_name })),
      projects: projects.map((p) => ({ id: p.id, name: p.name, colorKey: p.color_key })),
      monthGoals: monthGoals.map((g) => ({
        id: g.id,
        title: g.title,
        month: g.period_start.slice(0, 7),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(); // Task 생성은 전원 (SPEC 6장 member 전권)
    const payload = await request.json();

    const title = String(payload.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });
    const priority = (PRIORITIES as readonly string[]).includes(payload.priority)
      ? payload.priority
      : "mid";
    const dueDate =
      typeof payload.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.dueDate)
        ? payload.dueDate
        : null;

    const task = await queryOne<{ id: number }>(
      `INSERT INTO task (project_id, title, description, status, assignee_id, due_date, priority, origin, created_by)
       VALUES ($1,$2,$3,'todo',$4,$5,$6,'human',$7) RETURNING id`,
      [
        payload.projectId ? Number(payload.projectId) : null,
        title,
        String(payload.description ?? "").slice(0, 4000),
        payload.assigneeId ? Number(payload.assigneeId) : session.id,
        dueDate,
        priority,
        session.id,
      ]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 업무 생성 — "${title}"`,
    });
    return NextResponse.json({ id: task!.id });
  } catch (error) {
    return jsonError(error);
  }
}
