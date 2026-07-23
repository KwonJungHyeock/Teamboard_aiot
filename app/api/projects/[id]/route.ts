// 프로젝트 상세 API (Phase 5) — GET: 개요·목표·업무·자료, PUT: 수정(lead).
// 목표 진척은 lib/goals.ts 계산 결과를 그대로 사용한다 (단일 소스).
import { NextResponse } from "next/server";
import { requireLead, requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { getGoalTree, type GoalNode } from "@/lib/goals";
import { kstToday } from "@/lib/home";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROJECT_STATUSES = ["active", "done", "hold"] as const;

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const projectId = Number(params.id);
    const project = await queryOne<{
      id: number;
      name: string;
      status: string;
      color_key: string | null;
      start_date: string | null;
      end_date: string | null;
      notion_url: string | null;
    }>(
      `SELECT id, name, status, color_key, start_date::text, end_date::text, notion_url
       FROM project WHERE id = $1 AND is_active = true`,
      [projectId]
    );
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    // 목표 탭 — 트리 전체에서 이 프로젝트에 속한 노드만 평면 추출 (진척은 트리 계산값)
    const tree = await getGoalTree();
    const goals: { id: number; title: string; periodType: string; periodStart: string; progress: number | null }[] = [];
    const walk = (nodes: GoalNode[]) => {
      for (const node of nodes) {
        if (node.projectId === projectId) {
          goals.push({
            id: node.id,
            title: node.title,
            periodType: node.periodType,
            periodStart: node.periodStart,
            progress: node.progress,
          });
        }
        walk(node.children);
      }
    };
    walk(tree);

    // 업무 탭 — proposed 제외 (인박스 전용 상태)
    const tasks = await query<{
      id: number;
      title: string;
      status: string;
      priority: string;
      assignee_name: string | null;
      due_date: string | null;
    }>(
      `SELECT t.id, t.title, t.status, t.priority, a.display_name AS assignee_name, t.due_date::text
       FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
       WHERE t.project_id = $1 AND t.is_active = true AND t.status <> 'proposed'
       ORDER BY t.due_date ASC NULLS LAST, t.id DESC`,
      [projectId]
    );

    // 자료 탭 — {kind, title, url} 링크 카드 데이터만. 본문은 가져오지 않는다 (Phase 5-5)
    const artifacts = await query<{
      id: number;
      kind: string;
      title: string;
      url: string;
      created_at: string;
    }>(
      `SELECT id, kind, title, url, created_at::text
       FROM artifact WHERE project_id = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [projectId]
    );

    return NextResponse.json({
      project: {
        id: project.id,
        name: project.name,
        status: project.status,
        colorKey: project.color_key,
        startDate: project.start_date,
        endDate: project.end_date,
        notionUrl: project.notion_url,
      },
      goals,
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        priority: t.priority,
        assigneeName: t.assignee_name,
        dueDate: t.due_date,
      })),
      artifacts,
      today: kstToday(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireLead(); // 프로젝트 속성 변경은 lead
    const projectId = Number(params.id);
    const payload = await request.json();

    const project = await queryOne<{ id: number; name: string }>(
      "SELECT id, name FROM project WHERE id = $1 AND is_active = true",
      [projectId]
    );
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };

    if (typeof payload.name === "string" && payload.name.trim()) set("name", payload.name.trim().slice(0, 100));
    if ((PROJECT_STATUSES as readonly string[]).includes(payload.status)) set("status", payload.status);
    if (payload.notionUrl !== undefined) {
      set("notion_url", payload.notionUrl ? String(payload.notionUrl).slice(0, 500) : null);
    }

    if (sets.length > 0) {
      values.push(projectId);
      await query(`UPDATE project SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 프로젝트 수정 — "${project.name}"`,
      });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
