// Notion 스키마 동적 캐시 (Phase 9 구조 개선) — 팀장이 Notion 속성값을 직접 바꿔도
// 재배포 없이 반영되도록, 실제 선택지를 Notion에서 조회해 config에 캐시한다.
//   - TTL 24시간. 만료 시 Notion 재조회 후 갱신.
//   - Notion 조회 실패 시 마지막 캐시 사용, 캐시도 없으면 lib/notion-schema.ts 하드코딩 폴백.
//   - 캐시/실측 선택지와 폴백 상수가 다르면 drift로 보고(/settings 경고용).
import { query, queryOne } from "./db";
import { getDataSourceSchema } from "./notion";
import { NP, NOTION_TIMELINE_SCHEMA } from "./notion-schema";

const CACHE_KEY = "notion_schema_cache";
const TTL_MS = 24 * 60 * 60 * 1000;

/** 승인 모달이 쓰는 4개 선택형 속성의 선택지 */
export interface SchemaOptions {
  workArea: string[];
  workType: string[];
  status: string[];
  priority: string[];
}

export interface DriftItem {
  property: string;
  added: string[]; // Notion에는 있으나 폴백 상수에 없음
  removed: string[]; // 폴백 상수에는 있으나 Notion에 없음
}

export interface SchemaResult {
  options: SchemaOptions;
  source: "notion" | "cache" | "fallback";
  updatedAt: string | null;
  drift: DriftItem[];
}

/** 하드코딩 폴백 선택지 (lib/notion-schema.ts) */
export function fallbackOptions(): SchemaOptions {
  return {
    workArea: [...NOTION_TIMELINE_SCHEMA.workArea.options],
    workType: [...NOTION_TIMELINE_SCHEMA.workType.options],
    status: [...NOTION_TIMELINE_SCHEMA.status.options],
    priority: [...NOTION_TIMELINE_SCHEMA.priority.options],
  };
}

/** 실측/캐시 선택지와 폴백 상수의 차이 계산 */
function computeDrift(options: SchemaOptions): DriftItem[] {
  const fb = fallbackOptions();
  const keys: (keyof SchemaOptions)[] = ["workArea", "workType", "status", "priority"];
  const propName: Record<keyof SchemaOptions, string> = {
    workArea: NP.workArea,
    workType: NP.workType,
    status: NP.status,
    priority: NP.priority,
  };
  const drift: DriftItem[] = [];
  for (const k of keys) {
    const added = options[k].filter((o) => !fb[k].includes(o));
    const removed = fb[k].filter((o) => !options[k].includes(o));
    if (added.length || removed.length) drift.push({ property: propName[k], added, removed });
  }
  return drift;
}

/** Notion data source 스키마 응답을 4개 선택지로 매핑 */
function mapSchema(schema: Record<string, { type: string; options: string[] }>): SchemaOptions {
  const pick = (prop: string, fb: readonly string[]) =>
    schema[prop]?.options?.length ? schema[prop].options : [...fb];
  return {
    workArea: pick(NP.workArea, NOTION_TIMELINE_SCHEMA.workArea.options),
    workType: pick(NP.workType, NOTION_TIMELINE_SCHEMA.workType.options),
    status: pick(NP.status, NOTION_TIMELINE_SCHEMA.status.options),
    priority: pick(NP.priority, NOTION_TIMELINE_SCHEMA.priority.options),
  };
}

async function readCache(): Promise<{ options: SchemaOptions; updatedAt: string } | null> {
  const row = await queryOne<{ value: { options?: SchemaOptions }; updated_at: string }>(
    `SELECT value, updated_at::text FROM config WHERE key = $1`,
    [CACHE_KEY]
  );
  if (!row?.value?.options) return null;
  return { options: row.value.options, updatedAt: row.updated_at };
}

async function writeCache(options: SchemaOptions): Promise<void> {
  await query(
    `INSERT INTO config (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [CACHE_KEY, JSON.stringify({ options })]
  );
}

/**
 * 승인 모달용 선택지 해석. forceRefresh=true면 TTL 무시하고 Notion 재조회.
 * NOTION_TOKEN이 없거나 조회 실패 시 캐시→폴백 순으로 우아하게 강등한다.
 */
export async function getSchemaOptions(opts?: { forceRefresh?: boolean }): Promise<SchemaResult> {
  const cache = await readCache();
  const fresh =
    cache &&
    !opts?.forceRefresh &&
    Date.now() - new Date(cache.updatedAt).getTime() < TTL_MS;
  if (fresh) {
    return { options: cache!.options, source: "cache", updatedAt: cache!.updatedAt, drift: computeDrift(cache!.options) };
  }

  // 토큰 없으면 Notion 조회 불가 — 캐시 또는 폴백
  if (!process.env.NOTION_TOKEN) {
    if (cache) return { options: cache.options, source: "cache", updatedAt: cache.updatedAt, drift: computeDrift(cache.options) };
    const fb = fallbackOptions();
    return { options: fb, source: "fallback", updatedAt: null, drift: [] };
  }

  try {
    const schema = await getDataSourceSchema();
    const options = mapSchema(schema);
    await writeCache(options);
    return { options, source: "notion", updatedAt: new Date().toISOString(), drift: computeDrift(options) };
  } catch {
    if (cache) return { options: cache.options, source: "cache", updatedAt: cache.updatedAt, drift: computeDrift(cache.options) };
    const fb = fallbackOptions();
    return { options: fb, source: "fallback", updatedAt: null, drift: [] };
  }
}
