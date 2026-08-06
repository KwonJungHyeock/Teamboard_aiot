// DB 추상화 레이어 — Vercel Postgres가 아니어도 이 파일만 교체하면 됨 (PRD 10장)
import { Pool, type QueryResultRow } from "pg";
import { runMigrations } from "./migrate";

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

// 자동 마이그레이션 (파트 X) — 프로세스당 1회. 최초 DB 접근이 미적용 마이그레이션을 적용한다.
// 실패하면 캐시를 비워 다음 요청에서 재시도. TB_SKIP_MIGRATE=1 로 우회(시드 스크립트 등).
let migratePromise: Promise<unknown> | null = null;
function ensureMigrated(): Promise<unknown> {
  if (process.env.TB_SKIP_MIGRATE === "1") return Promise.resolve();
  if (!migratePromise) {
    migratePromise = runMigrations(getPool()).catch((err) => {
      migratePromise = null; // 다음 요청에서 재시도
      throw err;
    });
  }
  return migratePromise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  await ensureMigrated();
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

/**
 * 트랜잭션 (MD-P-2026-024 회신 8 지시 26-3).
 *
 * query() 는 매번 풀에서 아무 커넥션이나 빌려오므로 `SELECT … FOR UPDATE` 의
 * 행 잠금이 다음 호출까지 이어지지 않는다. 잠금으로 동시 요청을 막아야 하는
 * 곳에서는 이 헬퍼를 써서 **같은 커넥션** 위에서 실행한다.
 *
 * fn 은 이 트랜잭션 전용 q() 를 받는다. 예외가 나면 ROLLBACK 후 그대로 던진다.
 */
export async function withTx<T>(
  fn: (
    q: <R extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]) => Promise<R[]>
  ) => Promise<T>
): Promise<T> {
  await ensureMigrated();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const q = async <R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = []) =>
      (await client.query<R>(text, params as any[])).rows;
    const out = await fn(q);
    await client.query("COMMIT");
    return out;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ─── 신규 스키마 공통 헬퍼 (조회는 is_active=true 기본) ───

import type { Actor, Area, AreaWithProjects, Project } from "./types";

/** 활성 팀원(human) 목록 — 캘린더 레인·구성원 목록 등의 기준 */
export async function getActiveHumans(): Promise<Actor[]> {
  return query<Actor>(
    `SELECT * FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
  );
}

/** 활성 프로젝트 목록 — 사이드바 동적 렌더 등 */
export async function getActiveProjects(): Promise<Project[]> {
  // 사이드바 트리(MD-P-2026-005 §D) — 프로젝트별 미해결 논의 수를 함께 집계.
  // 보관(archived)도 포함해 내려보내고, 노출 여부는 사이드바 토글이 결정한다.
  return query<Project>(
    `SELECT p.*,
            (SELECT count(*)::int FROM signal s
             WHERE s.project_id = p.id AND s.is_active = true
               AND s.status IN ('open','discussing')) AS open_discussions
     FROM project p WHERE p.is_active = true ORDER BY p.id`
  );
}

/** 활성 업무 영역 목록 (sort_order) — 사이드바·필터·폼. workspace + link_only 모두 포함 */
export async function getActiveAreas(): Promise<Area[]> {
  return query<Area>(
    `SELECT id, name, color_key, sort_order, is_active, kind, notion_url FROM area
     WHERE is_active = true ORDER BY sort_order, id`
  );
}

/** 업무·목표 선택지용 영역 — workspace 만 (link_only·비활성 제외, 파트 0) */
export async function getSelectableAreas(): Promise<Area[]> {
  return query<Area>(
    `SELECT id, name, color_key, sort_order, is_active, kind, notion_url FROM area
     WHERE is_active = true AND kind = 'workspace' ORDER BY sort_order, id`
  );
}

/** 영역 + 소속 프로젝트 (사이드바 "업무 영역" 트리). link_only 는 프로젝트 없이 링크만 */
export async function getAreasWithProjects(): Promise<AreaWithProjects[]> {
  const [areas, projects] = await Promise.all([getActiveAreas(), getActiveProjects()]);
  return areas.map((a) => ({ ...a, projects: projects.filter((p) => p.area_id === a.id) }));
}

/** 승인 인박스 카운트 — 에이전트 제안 업무(proposed) + 승인 대기 초안(pending).
 *  lead 는 전체, 그 외는 본인(담당/소유) 기준. */
export async function getInboxCount(viewerId: number, isLead: boolean): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT (SELECT count(*) FROM task WHERE is_active = true AND status = 'proposed' AND ($2 OR assignee_id = $1))
          + (SELECT count(*) FROM drafts WHERE status = 'pending' AND ($2 OR user_id = $1)) AS n`,
    [viewerId, isLead]
  );
  return Number(row?.n ?? 0);
}

/** owner(human actor) 기준 에이전트 설정 조회 — 기존 AssistantSettings 형태 유지 */
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
