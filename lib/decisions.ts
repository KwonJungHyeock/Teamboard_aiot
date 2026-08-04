// 결정 로그 (MD-P-2026-004) — 서버 조회·생성 헬퍼.
// 결정은 삭제하지 않는다. 번복(supersede)만 가능하며 원본은 status='superseded'로 남는다.
import { query, queryOne } from "./db";

export type DecisionStatus = "confirmed" | "superseded";

export interface DecisionRow {
  id: number;
  projectId: number | null;
  projectName: string | null;
  projectColorKey: string | null;
  areaName: string | null;
  discussionId: number;
  discussionTitle: string | null;
  title: string;
  rationale: string;
  decidedBy: number;
  decidedByName: string;
  decidedAt: string;
  status: DecisionStatus;
  supersededBy: number | null;
  linkedTaskIds: number[];
}

const SELECT_DECISION = `
  SELECT d.id, d.project_id, p.name AS project_name, p.color_key AS project_color_key,
         ar.name AS area_name,
         d.discussion_id, s.title AS discussion_title,
         d.title, d.rationale, d.decided_by, a.display_name AS decided_by_name,
         d.decided_at::text, d.status, d.superseded_by, d.linked_task_ids
  FROM decision d
  JOIN actor a ON a.id = d.decided_by
  LEFT JOIN signal s ON s.id = d.discussion_id
  LEFT JOIN project p ON p.id = d.project_id
  LEFT JOIN area ar ON ar.id = p.area_id
`;

interface RawDecision {
  id: number;
  project_id: number | null;
  project_name: string | null;
  project_color_key: string | null;
  area_name: string | null;
  discussion_id: number;
  discussion_title: string | null;
  title: string;
  rationale: string;
  decided_by: number;
  decided_by_name: string;
  decided_at: string;
  status: DecisionStatus;
  superseded_by: number | null;
  linked_task_ids: number[] | null;
}

function toRow(r: RawDecision): DecisionRow {
  return {
    id: r.id,
    projectId: r.project_id,
    projectName: r.project_name,
    projectColorKey: r.project_color_key,
    areaName: r.area_name,
    discussionId: r.discussion_id,
    discussionTitle: r.discussion_title,
    title: r.title,
    rationale: r.rationale,
    decidedBy: r.decided_by,
    decidedByName: r.decided_by_name,
    decidedAt: r.decided_at,
    status: r.status,
    supersededBy: r.superseded_by,
    linkedTaskIds: r.linked_task_ids ?? [],
  };
}

export interface DecisionFilter {
  projectId?: number;
  decidedBy?: number;
  status?: DecisionStatus;
  from?: string; // YYYY-MM-DD
  to?: string;
  q?: string;    // 결정 내용 + 근거 본문 검색
  limit?: number;
}

/** 결정 목록 — 최신순. 필터·검색 지원. */
export async function listDecisions(f: DecisionFilter = {}): Promise<DecisionRow[]> {
  const where: string[] = [];
  const vals: unknown[] = [];
  /** 값 1개를 바인딩하고 $n 자리표시자를 돌려준다. */
  const bind = (v: unknown) => { vals.push(v); return `$${vals.length}`; };

  if (f.projectId) where.push(`d.project_id = ${bind(f.projectId)}`);
  if (f.decidedBy) where.push(`d.decided_by = ${bind(f.decidedBy)}`);
  if (f.status) where.push(`d.status = ${bind(f.status)}`);
  if (f.from) where.push(`d.decided_at >= ${bind(f.from)}::date`);
  if (f.to) where.push(`d.decided_at < (${bind(f.to)}::date + 1)`);
  if (f.q) {
    // 결정 내용 + 근거 본문을 같은 파라미터로 검색
    const p = bind(`%${f.q}%`);
    where.push(`(d.title ILIKE ${p} OR d.rationale ILIKE ${p})`);
  }

  let sql = SELECT_DECISION;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  sql += ` ORDER BY d.decided_at DESC LIMIT ${Math.min(Number(f.limit) || 100, 200)}`;

  const rows = await query<RawDecision>(sql, vals);
  return rows.map(toRow);
}

/** 특정 논의에 연결된 결정 (스레드 하단 고정 카드용). 최신순. */
export async function decisionsForDiscussion(discussionId: number): Promise<DecisionRow[]> {
  const rows = await query<RawDecision>(
    `${SELECT_DECISION} WHERE d.discussion_id = $1 ORDER BY d.decided_at DESC`,
    [discussionId]
  );
  return rows.map(toRow);
}

/** 특정 업무에 연결된 결정 (업무 상세 "관련 결정"). */
export async function decisionsForTask(taskId: number): Promise<DecisionRow[]> {
  const rows = await query<RawDecision>(
    `${SELECT_DECISION} WHERE $1 = ANY(d.linked_task_ids) ORDER BY d.decided_at DESC`,
    [taskId]
  );
  return rows.map(toRow);
}

export async function getDecision(id: number): Promise<DecisionRow | null> {
  const r = await queryOne<RawDecision>(`${SELECT_DECISION} WHERE d.id = $1`, [id]);
  return r ? toRow(r) : null;
}

/** 이번 주(월요일 기준) 확정된 결정 수 — 홈 요약 줄. */
export async function decisionsThisWeek(weekStart: string): Promise<number> {
  const r = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM decision
     WHERE status = 'confirmed' AND decided_at >= $1::date`,
    [weekStart]
  );
  return Number(r?.n ?? 0);
}
