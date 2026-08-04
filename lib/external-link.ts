// 외부 리소스 연결 (MD-P-2026-012) — 서버 전용.
//
// 경계가 이 파일의 존재 이유다:
//   상태·일정·우선순위·진척·목표 = Mission Deck (시스템 오브 레코드)
//   리소스·장문 문서·상세 기록     = Notion 등 외부 (서브)
// 그래서 여기에는 "링크와 표시용 메타"만 저장한다. 상태·날짜를 가져와 덮어쓰지 않는다.
import { query, queryOne } from "./db";

export type EntityType = "task" | "project" | "goal" | "decision";
export type Provider = "notion" | "figma" | "github" | "other";

export interface ExternalLink {
  id: number;
  entityType: EntityType;
  entityId: number;
  provider: Provider;
  url: string;
  title: string | null;
  iconUrl: string | null;
  meta: Record<string, unknown>;
  lastSyncedAt: string | null;
  createdByName: string | null;
  createdAt: string;
  /** 마지막 조회가 실패했을 때의 사유 — 카드가 깨지지 않게 화면에 이유를 준다 */
  error?: string | null;
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  notion: "Notion", figma: "Figma", github: "GitHub", other: "링크",
};

/** URL → provider. 판별 못하면 'other'로 두고 링크 자체는 살린다. */
export function detectProvider(url: string): Provider {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.endsWith("notion.so") || h.endsWith("notion.site")) return "notion";
    if (h.endsWith("figma.com")) return "figma";
    if (h.endsWith("github.com")) return "github";
    return "other";
  } catch {
    return "other";
  }
}

/** Notion URL 끝의 32자리 hex → 페이지 id. 못 찾으면 null. */
export function notionPageId(url: string): string | null {
  const m = url.match(/([0-9a-f]{32})(?:[?#].*)?$/i)
    ?? url.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (!m) return null;
  const raw = m[1].replace(/-/g, "");
  if (raw.length !== 32) return null;
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

interface Row {
  id: number; entity_type: EntityType; entity_id: number; provider: Provider;
  url: string; title: string | null; icon_url: string | null; meta: Record<string, unknown>;
  last_synced_at: string | null; created_by_name: string | null; created_at: string;
}

const toLink = (r: Row): ExternalLink => ({
  id: r.id, entityType: r.entity_type, entityId: r.entity_id, provider: r.provider,
  url: r.url, title: r.title, iconUrl: r.icon_url, meta: r.meta ?? {},
  lastSyncedAt: r.last_synced_at, createdByName: r.created_by_name, createdAt: r.created_at,
});

const SELECT = `
  SELECT l.id, l.entity_type, l.entity_id, l.provider, l.url, l.title, l.icon_url, l.meta,
         l.last_synced_at::text, l.created_at::text, a.display_name AS created_by_name
    FROM external_link l LEFT JOIN actor a ON a.id = l.created_by`;

export async function listLinks(entityType: EntityType, entityId: number): Promise<ExternalLink[]> {
  const rows = await query<Row>(
    `${SELECT} WHERE l.entity_type = $1 AND l.entity_id = $2 ORDER BY l.created_at`,
    [entityType, entityId]
  );
  return rows.map(toLink);
}

/** 엔티티별 연결 수 — 프로젝트 개요 탭의 카운트 (§E). */
export async function countLinks(entityType: EntityType, entityId: number): Promise<number> {
  const r = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM external_link WHERE entity_type = $1 AND entity_id = $2`,
    [entityType, entityId]
  );
  return Number(r?.n ?? 0);
}

export async function addLink(input: {
  entityType: EntityType; entityId: number; url: string; userId: number;
  title?: string | null; iconUrl?: string | null; meta?: Record<string, unknown>;
}): Promise<ExternalLink | null> {
  const provider = detectProvider(input.url);
  const rows = await query<{ id: number }>(
    `INSERT INTO external_link (entity_type, entity_id, provider, url, title, icon_url, meta, created_by, last_synced_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8, CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)
     ON CONFLICT (entity_type, entity_id, url) DO NOTHING
     RETURNING id`,
    [input.entityType, input.entityId, provider, input.url,
      input.title ?? null, input.iconUrl ?? null, JSON.stringify(input.meta ?? {}), input.userId]
  );
  const id = rows[0]?.id;
  if (!id) {
    // 이미 있는 링크 — 중복 추가는 조용히 기존 것을 돌려준다
    const existing = await queryOne<Row>(
      `${SELECT} WHERE l.entity_type = $1 AND l.entity_id = $2 AND l.url = $3`,
      [input.entityType, input.entityId, input.url]
    );
    return existing ? toLink(existing) : null;
  }
  const created = await queryOne<Row>(`${SELECT} WHERE l.id = $1`, [id]);
  return created ? toLink(created) : null;
}

/** 연결 해제 — 외부 원본은 건드리지 않는다. 연결만 끊는다 (§E). */
export async function removeLink(id: number, entityType: EntityType, entityId: number): Promise<boolean> {
  const rows = await query<{ id: number }>(
    `DELETE FROM external_link WHERE id = $1 AND entity_type = $2 AND entity_id = $3 RETURNING id`,
    [id, entityType, entityId]
  );
  return rows.length > 0;
}

export async function getLink(id: number): Promise<ExternalLink | null> {
  const r = await queryOne<Row>(`${SELECT} WHERE l.id = $1`, [id]);
  return r ? toLink(r) : null;
}

/** 메타 갱신 저장. 실패해도 기존 title은 지우지 않는다(마지막 성공값 유지, §C). */
export async function saveMeta(id: number, meta: {
  title?: string | null; iconUrl?: string | null; extra?: Record<string, unknown>;
}): Promise<void> {
  await query(
    `UPDATE external_link
        SET title = COALESCE($2, title),
            icon_url = COALESCE($3, icon_url),
            meta = COALESCE($4::jsonb, meta),
            last_synced_at = now()
      WHERE id = $1`,
    [id, meta.title ?? null, meta.iconUrl ?? null, meta.extra ? JSON.stringify(meta.extra) : null]
  );
}

/** 조회 실패를 메타에만 기록 — 제목·아이콘은 그대로 두고 사유만 남긴다. */
export async function saveFetchError(id: number, error: string): Promise<void> {
  await query(
    `UPDATE external_link
        SET meta = meta || jsonb_build_object('lastError', $2::text, 'lastErrorAt', now()::text),
            last_synced_at = now()
      WHERE id = $1`,
    [id, error]
  );
}

/** 15분 캐시 (§C) — 이 안에 다시 조회하지 않는다. Notion rate limit(초당 3)을 아끼기 위함. */
export const META_TTL_MS = 15 * 60 * 1000;

export function isFresh(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return false;
  let s = lastSyncedAt.replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  const t = Date.parse(s);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < META_TTL_MS;
}
