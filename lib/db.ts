// DB 추상화 레이어 — Vercel Postgres가 아니어도 이 파일만 교체하면 됨 (PRD 10장)
import { Pool, type QueryResultRow } from "pg";

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL 환경변수가 설정되지 않았습니다.");
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await getPool().query<T>(text, params as any[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

// ─── 신규 스키마 공통 헬퍼 (조회는 is_active=true 기본) ───

import type { Actor, Project } from "./types";

/** 활성 팀원(human) 목록 — 캘린더 레인·구성원 목록 등의 기준 */
export async function getActiveHumans(): Promise<Actor[]> {
  return query<Actor>(
    `SELECT * FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
  );
}

/** 활성 프로젝트 목록 — 사이드바 동적 렌더 등 */
export async function getActiveProjects(): Promise<Project[]> {
  return query<Project>(`SELECT * FROM project WHERE is_active = true ORDER BY id`);
}

/** owner(human actor) 기준 부사수 설정 조회 — 기존 AssistantSettings 형태 유지 */
export async function getAssistantByOwner(ownerActorId: number) {
  return queryOne<{
    id: number;
    user_id: number;
    name: string;
    report_style: "brief" | "detailed";
    work_areas: unknown;
    auto_scope: string;
    system_prompt_extra: string;
  }>(
    `SELECT a.id, a.owner_actor_id AS user_id, a.display_name AS name,
            c.report_style, c.work_areas, c.auto_scope, c.system_prompt_extra
     FROM actor a JOIN agent_config c ON c.actor_id = a.id
     WHERE a.type = 'agent' AND a.is_active = true AND a.owner_actor_id = $1`,
    [ownerActorId]
  );
}
