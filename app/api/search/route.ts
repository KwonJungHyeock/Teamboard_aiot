// 통합 검색 (MD-P-2026-006 §A) — ⌘K 빠른 이동이 쓰는 단일 엔드포인트.
// 프로젝트 · 업무 · 사람 · 결정을 한 번에 훑는다. 질의가 비면 "최근 방문"을 대신할
// 최근 활동 기준 상위 항목을 돌려준다(팔레트가 첫 화면에서 바로 쓸 수 있게).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type SearchKind = "project" | "task" | "person" | "decision";
export interface SearchHit {
  kind: SearchKind;
  id: number;
  title: string;
  meta: string;
}

export async function GET(request: Request) {
  try {
    requireSession();
    const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
    const like = `%${q}%`;
    const lim = q ? 6 : 4;

    // 질의 없음 = 최근 항목(최근 방문 대체). 질의 있음 = ILIKE 부분일치.
    const [projects, tasks, people, decisions] = await Promise.all([
      query<{ id: number; name: string; status: string; area_name: string | null }>(
        q
          ? `SELECT p.id, p.name, p.status, a.name AS area_name FROM project p
             LEFT JOIN area a ON a.id = p.area_id
             WHERE p.is_active = true AND p.name ILIKE $1 ORDER BY p.name LIMIT ${lim}`
          : `SELECT p.id, p.name, p.status, a.name AS area_name FROM project p
             LEFT JOIN area a ON a.id = p.area_id
             WHERE p.is_active = true AND p.status <> 'archived' ORDER BY p.id DESC LIMIT ${lim}`,
        q ? [like] : []
      ),
      query<{ id: number; title: string; status: string; project_name: string | null; assignee: string | null }>(
        q
          ? `SELECT t.id, t.title, t.status, p.name AS project_name, ac.display_name AS assignee
             FROM task t LEFT JOIN project p ON p.id = t.project_id LEFT JOIN actor ac ON ac.id = t.assignee_id
             WHERE t.is_active = true AND t.title ILIKE $1 ORDER BY t.status <> 'done' DESC, t.id DESC LIMIT ${lim}`
          : `SELECT t.id, t.title, t.status, p.name AS project_name, ac.display_name AS assignee
             FROM task t LEFT JOIN project p ON p.id = t.project_id LEFT JOIN actor ac ON ac.id = t.assignee_id
             WHERE t.is_active = true AND t.status <> 'done' ORDER BY t.updated_at DESC LIMIT ${lim}`,
        q ? [like] : []
      ),
      query<{ id: number; display_name: string; type: string; role: string | null }>(
        q
          ? `SELECT a.id, a.display_name, a.type, ac.role FROM actor a
             LEFT JOIN account ac ON ac.actor_id = a.id
             WHERE a.is_active = true AND a.display_name ILIKE $1 ORDER BY a.type, a.id LIMIT ${lim}`
          : `SELECT a.id, a.display_name, a.type, ac.role FROM actor a
             LEFT JOIN account ac ON ac.actor_id = a.id
             WHERE a.is_active = true AND a.type = 'human' ORDER BY a.id LIMIT ${lim}`,
        q ? [like] : []
      ),
      query<{ id: number; title: string; status: string; decided_by_name: string }>(
        q
          ? `SELECT d.id, d.title, d.status, a.display_name AS decided_by_name FROM decision d
             JOIN actor a ON a.id = d.decided_by
             WHERE d.title ILIKE $1 OR d.rationale ILIKE $1 ORDER BY d.decided_at DESC LIMIT ${lim}`
          : `SELECT d.id, d.title, d.status, a.display_name AS decided_by_name FROM decision d
             JOIN actor a ON a.id = d.decided_by
             WHERE d.status = 'confirmed' ORDER BY d.decided_at DESC LIMIT ${lim}`,
        q ? [like] : []
      ),
    ]);

    const STATUS: Record<string, string> = {
      todo: "대기", doing: "진행", review: "리뷰", done: "완료",
      active: "진행", hold: "보류", archived: "보관",
      confirmed: "확정", superseded: "번복됨",
    };

    const hits: SearchHit[] = [
      ...projects.map((p) => ({
        kind: "project" as const, id: p.id, title: p.name,
        meta: [p.area_name, STATUS[p.status] ?? p.status].filter(Boolean).join(" · "),
      })),
      ...tasks.map((t) => ({
        kind: "task" as const, id: t.id, title: t.title,
        meta: [t.project_name, t.assignee, STATUS[t.status] ?? t.status].filter(Boolean).join(" · "),
      })),
      ...people.map((a) => ({
        kind: "person" as const, id: a.id, title: a.display_name,
        meta: a.type === "agent" ? "에이전트" : a.role === "lead" ? "팀장" : "팀원",
      })),
      ...decisions.map((d) => ({
        kind: "decision" as const, id: d.id, title: d.title,
        meta: [d.decided_by_name, STATUS[d.status] ?? d.status].filter(Boolean).join(" · "),
      })),
    ];

    return NextResponse.json({ hits, recent: !q });
  } catch (error) {
    return jsonError(error);
  }
}
