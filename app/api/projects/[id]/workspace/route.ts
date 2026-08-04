// 프로젝트 워크스페이스 데이터 (MD-P-2026-005) — 헤더 + 5개 탭을 한 번에.
// 개요 롤업·업무·논의·결정·멤버·연결 목표. 탭 전환은 클라이언트에서(리로드 없음).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";
import { projectTasks, rollupProgress } from "@/lib/projects";
import { listDecisions } from "@/lib/decisions";
import { signalVisibilityClause } from "@/lib/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const projectId = Number(params.id);
    if (!Number.isInteger(projectId)) {
      return NextResponse.json({ error: "잘못된 프로젝트입니다." }, { status: 400 });
    }

    const project = await queryOne<{
      id: number; name: string; status: string; color_key: string | null;
      start_date: string | null; end_date: string | null; notion_url: string | null;
      area_id: number | null; area_name: string | null; area_color: string | null;
      goal_id: number | null; goal_title: string | null; goal_period_type: string | null;
      goal_period_start: string | null; goal_progress: string | null; goal_mode: string | null;
      archived_at: string | null; owner_id: number | null; owner_name: string | null;
      member_ids: number[] | null;
    }>(
      `SELECT p.id, p.name, p.status, p.color_key, p.start_date::text, p.end_date::text, p.notion_url,
              p.area_id, ar.name AS area_name, ar.color_key AS area_color,
              p.goal_id, g.title AS goal_title, g.period_type AS goal_period_type,
              g.period_start::text AS goal_period_start, g.progress::text AS goal_progress,
              g.progress_mode AS goal_mode,
              p.archived_at::text, p.owner_id, o.display_name AS owner_name, p.member_ids
       FROM project p
       LEFT JOIN area ar ON ar.id = p.area_id
       LEFT JOIN goal g ON g.id = p.goal_id
       LEFT JOIN actor o ON o.id = p.owner_id
       WHERE p.id = $1 AND p.is_active = true`,
      [projectId]
    );
    if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 });

    const today = kstToday();
    const tasks = await projectTasks(projectId);
    const progress = rollupProgress(tasks);

    // 멤버 — member_ids + owner (중복 제거)
    const memberIds = Array.from(new Set([...(project.member_ids ?? []), ...(project.owner_id ? [project.owner_id] : [])]));
    const members = memberIds.length
      ? await query<{ id: number; display_name: string; avatar_url: string | null }>(
          `SELECT id, display_name, avatar_url FROM actor WHERE id = ANY($1::int[]) ORDER BY id`,
          [memberIds]
        )
      : [];

    // 논의 — 이 프로젝트에 연결된 시그널. 미해결 상단 + age
    const signals = await query<{
      id: number; type: string; title: string; status: string; author_name: string;
      age_days: string; comment_count: string;
    }>(
      `SELECT s.id, s.type, s.title, s.status, a.display_name AS author_name,
              floor(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400) AS age_days,
              (SELECT count(*) FROM comment c WHERE c.signal_id = s.id) AS comment_count
       FROM signal s JOIN actor a ON a.id = s.author_id
       WHERE s.is_active = true AND s.project_id = $1 AND ${signalVisibilityClause("$2")}
       ORDER BY (s.status IN ('open','discussing')) DESC, s.created_at ASC`,
      [projectId, session.id]
    );
    const discussions = signals.map((s) => ({
      id: s.id, type: s.type, title: s.title, status: s.status, authorName: s.author_name,
      ageDays: Number(s.age_days), commentCount: Number(s.comment_count),
      open: s.status === "open" || s.status === "discussing",
    }));
    const openDiscussions = discussions.filter((d) => d.open).length;

    // 결정 로그 (MD-P-2026-004 결과물)
    const decisions = await listDecisions({ projectId, limit: 50 });

    // 개요 — 다가오는 마감 3건 + 최근 활동 5건
    const upcoming = tasks
      .filter((t) => t.dueDate && t.dueDate >= today && t.status !== "done")
      .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
      .slice(0, 3);
    const activity = await query<{ id: number; message: string; level: string; created_at: string; user_name: string | null }>(
      `SELECT al.id, al.message, al.level, al.created_at::text, u.display_name AS user_name
       FROM activity_log al
       LEFT JOIN actor u ON u.id = al.user_id
       LEFT JOIN task t ON t.id = al.task_id
       WHERE t.project_id = $1
       ORDER BY al.created_at DESC LIMIT 5`,
      [projectId]
    );

    // 자료(기존 탭 데이터 유지)
    const artifacts = await query<{ id: number; kind: string; title: string; url: string; created_at: string }>(
      `SELECT id, kind, title, url, created_at::text FROM artifact
       WHERE project_id = $1 AND is_active = true ORDER BY created_at DESC`,
      [projectId]
    ).catch(() => []);

    return NextResponse.json({
      project: {
        id: project.id, name: project.name, status: project.status, colorKey: project.color_key,
        startDate: project.start_date, endDate: project.end_date, notionUrl: project.notion_url,
        areaId: project.area_id, areaName: project.area_name, areaColor: project.area_color,
        archivedAt: project.archived_at, ownerId: project.owner_id, ownerName: project.owner_name,
        progress,
        goal: project.goal_id ? {
          id: project.goal_id, title: project.goal_title,
          periodType: project.goal_period_type, periodStart: project.goal_period_start,
          progress: project.goal_progress === null ? null : Math.round(Number(project.goal_progress)),
          manual: project.goal_mode === "manual",
        } : null,
      },
      members: members.map((m) => ({ id: m.id, name: m.display_name, avatarUrl: m.avatar_url })),
      tasks, discussions, openDiscussions, decisions, upcoming, activity, artifacts,
      today,
      canEdit: session.role === "lead" || project.owner_id === session.id,
    });
  } catch (error) {
    return jsonError(error);
  }
}
