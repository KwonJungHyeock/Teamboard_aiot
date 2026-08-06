// 업무 API (Phase 5) — GET: 목록(필터) + 인박스(proposed), POST: 생성.
// status='proposed'는 에이전트 제안 상태 — 홈·캘린더·타임라인 집계에서 제외되고
// /tasks 인박스에서만 노출된다 (CHANGE-GUIDE Phase 5-1).
import { NextResponse } from "next/server";
import { recomputeGoalChain } from "@/lib/goals";
import { applyInheritance } from "@/lib/goal-inherit";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = ["proposed", "todo", "doing", "review", "done", "dropped"] as const;
const PRIORITIES = ["high", "mid", "low"] as const;
const WORK_TYPES = ["team", "personal", "routine"] as const;

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
  areaId: number;
  areaName: string;
  workType: string;
  startDate: string | null;
  dueDate: string | null;
  goalIds: number[];
  progress: number;
  createdByName: string | null;
  blocked: boolean;
  blockedReason: string | null;
}

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const area = url.searchParams.get("area");
    const project = url.searchParams.get("project");
    const assignee = url.searchParams.get("assignee");
    const status = url.searchParams.get("status");
    const due = url.searchParams.get("due"); // overdue | 7d | 30d | none
    const blocked = url.searchParams.get("blocked"); // "1" → 막힌 업무만

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
    if (area) add("t.area_id = ?", Number(area));
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
    if (blocked === "1") where.push("t.blocked = true");

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
      area_id: number;
      area_name: string;
      work_type: string;
      start_date: string | null;
      due_date: string | null;
      goal_ids: number[] | null;
      progress: number;
      created_by_name: string | null;
      blocked: boolean;
      blocked_reason: string | null;
      completed_at: string | null;
      created_at: string;
    }>(
      `SELECT t.id, t.title, t.description, t.status, t.priority, t.origin,
              t.project_id, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name,
              t.area_id, ar.name AS area_name, t.work_type,
              t.start_date::text, t.due_date::text,
              array_agg(gt.goal_id) FILTER (WHERE gt.goal_id IS NOT NULL) AS goal_ids,
              t.progress,
              c.display_name AS created_by_name,
              t.blocked, t.blocked_reason,
              t.completed_at::text, t.created_at::text
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       JOIN area ar ON ar.id = t.area_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       LEFT JOIN goal_task gt ON gt.task_id = t.id
       WHERE ${where.join(" AND ")}
       GROUP BY t.id, p.name, p.color_key, ar.name, a.display_name, c.display_name
       ORDER BY t.due_date ASC NULLS LAST, t.id DESC
       LIMIT 300`,
      params
    );

    // 인박스 — 에이전트 제안(proposed) 업무. 목록 필터와 무관하게 항상 함께 반환
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
      created_at: string;
    }>(
      `SELECT t.id, t.title, t.description, p.name AS project_name, p.color_key,
              t.assignee_id, a.display_name AS assignee_name, t.due_date::text,
              c.display_name AS created_by_name, t.created_at::text
       FROM task t
       LEFT JOIN project p ON p.id = t.project_id
       LEFT JOIN actor a ON a.id = t.assignee_id
       LEFT JOIN actor c ON c.id = t.created_by
       WHERE t.is_active = true AND t.status = 'proposed'
       ORDER BY t.created_at ASC`
    );

    // 룩업 데이터(담당·프로젝트·목표)는 GET /api/meta/selectors로 분리됨 (Phase 8 D-3).
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
      areaId: r.area_id,
      areaName: r.area_name,
      workType: r.work_type,
      startDate: r.start_date,
      dueDate: r.due_date,
      goalIds: r.goal_ids ?? [],
      progress: r.progress ?? 0,
      blocked: r.blocked ?? false,
      blockedReason: r.blocked_reason,
      createdByName: r.created_by_name,
      completedAt: r.completed_at,
      createdAt: r.created_at,
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
        createdAt: r.created_at,
      })),
      today,
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
    // 생성 가능한 상태만 허용(제안·중단 제외). 보드 상태 컬럼 "+추가" 프리셋 반영.
    const CREATABLE = ["todo", "doing", "review", "done"] as const;
    const status = (CREATABLE as readonly string[]).includes(payload.status)
      ? payload.status
      : "todo";
    const isDate = (v: unknown): v is string =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const dueDate = isDate(payload.dueDate) ? payload.dueDate : null;
    const startDate = isDate(payload.startDate) ? payload.startDate : null;
    if (startDate && dueDate && startDate > dueDate) {
      return NextResponse.json({ error: "시작일이 마감일보다 늦을 수 없습니다." }, { status: 400 });
    }
    let areaId = payload.areaId ? Number(payload.areaId) : null;
    if (!areaId) {
      // 빠른 생성(⌘K 제목만) — 본인 소속 영역 우선, 없으면 첫 활성 영역으로 기본 배치
      const fallback = await queryOne<{ id: number }>(
        `SELECT a.id FROM area a
         LEFT JOIN actor_area aa ON aa.area_id = a.id AND aa.actor_id = $1
         WHERE a.is_active = true
         ORDER BY (aa.actor_id IS NULL), a.sort_order, a.id
         LIMIT 1`,
        [session.id]
      );
      areaId = fallback?.id ?? null;
    }
    if (!areaId) return NextResponse.json({ error: "업무 영역을 선택하세요." }, { status: 400 });
    const workType = (WORK_TYPES as readonly string[]).includes(payload.workType) ? payload.workType : "team";

    const task = await queryOne<{ id: number }>(
      `INSERT INTO task (project_id, area_id, work_type, title, description, status, assignee_id, start_date, due_date, priority, origin, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'human',$11) RETURNING id`,
      [
        payload.projectId ? Number(payload.projectId) : null,
        areaId,
        workType,
        title,
        String(payload.description ?? "").slice(0, 4000),
        status,
        payload.assigneeId ? Number(payload.assigneeId) : session.id,
        startDate,
        dueDate,
        priority,
        session.id,
      ]
    );
    // 프로젝트만 골라도 그 프로젝트의 목표를 자동으로 따라간다 (§4 — goal_source 기본값 inherited).
    for (const gid of await applyInheritance(task!.id)) await recomputeGoalChain(gid);

    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 업무 생성 — "${title}"`,
    });
    return NextResponse.json({ id: task!.id });
  } catch (error) {
    return jsonError(error);
  }
}
