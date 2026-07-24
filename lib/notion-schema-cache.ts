// Notion 스키마 동적 캐시 (Phase 9 구조 개선) — 팀장이 Notion 속성값·타입을 직접 바꿔도
// 재배포 없이 반영되도록, 실제 타입+선택지를 Notion에서 조회해 config에 캐시한다.
//   - TTL 24시간. 만료 시 Notion 재조회 후 갱신.
//   - Notion 조회 실패 시 마지막 캐시 사용, 캐시도 없으면 lib/notion-schema.ts 폴백.
//   - "업무 구분"은 폴백에서 type:"unknown" — 토큰 조회로만 select/multi_select가 확정된다.
//   - 캐시/실측 타입·선택지가 폴백과 다르면 drift로 보고(/settings 경고용).
import { query, queryOne } from "./db";
import { getDataSourceSchema } from "./notion";
import { NOTION_TIMELINE_SCHEMA, type NotionPropertySpec } from "./notion-schema";

const CACHE_KEY = "notion_schema_cache";
const TTL_MS = 24 * 60 * 60 * 1000;

/** 속성 하나의 해석 결과 — Notion property 이름 기준 */
export interface ResolvedProp {
  type: string; // select | multi_select | status | ... | unknown
  options: string[];
}
/** property 이름 → {type, options} */
export type ResolvedSchema = Record<string, ResolvedProp>;

export interface DriftItem {
  property: string;
  typeChange?: { from: string; to: string };
  added: string[]; // Notion에는 있으나 폴백에 없음
  removed: string[]; // 폴백에는 있으나 Notion에 없음
}

export interface SchemaResult {
  schema: ResolvedSchema; // property 이름 기준 전체 (createTimelinePage가 타입 분기에 사용)
  options: { workArea: string[]; workType: string[]; status: string[]; priority: string[] }; // 드롭다운용
  source: "notion" | "cache" | "fallback";
  updatedAt: string | null;
  drift: DriftItem[];
}

/** 폴백(하드코딩) 스키마 — property 이름 기준 */
function fallbackSchema(): ResolvedSchema {
  const out: ResolvedSchema = {};
  for (const spec of Object.values(NOTION_TIMELINE_SCHEMA) as NotionPropertySpec[]) {
    out[spec.property] = { type: spec.type, options: spec.options ? [...spec.options] : [] };
  }
  return out;
}

/** 4개 드롭다운용 옵션만 추출 */
function toOptions(schema: ResolvedSchema): SchemaResult["options"] {
  const P = NOTION_TIMELINE_SCHEMA;
  const get = (prop: string, fb: readonly string[]) =>
    schema[prop]?.options?.length ? schema[prop].options : [...fb];
  return {
    workArea: get(P.workArea.property, P.workArea.options),
    workType: get(P.workType.property, P.workType.options),
    status: get(P.status.property, P.status.options),
    priority: get(P.priority.property, P.priority.options),
  };
}

/** 해석 스키마와 폴백의 차이 (타입·선택지) */
function computeDrift(schema: ResolvedSchema): DriftItem[] {
  const fb = fallbackSchema();
  const drift: DriftItem[] = [];
  for (const [prop, fbProp] of Object.entries(fb)) {
    const cur = schema[prop];
    if (!cur) continue;
    const item: DriftItem = { property: prop, added: [], removed: [] };
    // 타입 변화 — 단, 폴백의 unknown은 "미확정"이므로 확정된 타입과의 차이는 drift로 보지 않음
    if (fbProp.type !== "unknown" && cur.type && cur.type !== fbProp.type) {
      item.typeChange = { from: fbProp.type, to: cur.type };
    }
    item.added = cur.options.filter((o) => !fbProp.options.includes(o));
    item.removed = fbProp.options.filter((o) => !cur.options.includes(o));
    if (item.typeChange || item.added.length || item.removed.length) drift.push(item);
  }
  return drift;
}

async function readCache(): Promise<{ schema: ResolvedSchema; updatedAt: string } | null> {
  const row = await queryOne<{ value: { schema?: ResolvedSchema }; updated_at: string }>(
    `SELECT value, updated_at::text FROM config WHERE key = $1`,
    [CACHE_KEY]
  );
  if (!row?.value?.schema) return null;
  return { schema: row.value.schema, updatedAt: row.updated_at };
}

async function writeCache(schema: ResolvedSchema): Promise<void> {
  await query(
    `INSERT INTO config (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [CACHE_KEY, JSON.stringify({ schema })]
  );
}

function result(schema: ResolvedSchema, source: SchemaResult["source"], updatedAt: string | null): SchemaResult {
  return { schema, options: toOptions(schema), source, updatedAt, drift: computeDrift(schema) };
}

/**
 * 스키마 해석. forceRefresh=true면 TTL 무시하고 Notion 재조회.
 * NOTION_TOKEN 없거나 조회 실패 시 캐시→폴백 순으로 강등한다.
 * 폴백은 "업무 구분" 타입을 unknown으로 두므로, 확정 전 승인 시도는 명확한 안내로 막힌다.
 */
export async function getResolvedSchema(opts?: { forceRefresh?: boolean }): Promise<SchemaResult> {
  const cache = await readCache();
  const fresh =
    cache && !opts?.forceRefresh && Date.now() - new Date(cache.updatedAt).getTime() < TTL_MS;
  if (fresh) return result(cache!.schema, "cache", cache!.updatedAt);

  if (!process.env.NOTION_TOKEN) {
    if (cache) return result(cache.schema, "cache", cache.updatedAt);
    return result(fallbackSchema(), "fallback", null);
  }

  try {
    const raw = await getDataSourceSchema(); // {propName: {type, options}}
    const schema: ResolvedSchema = {};
    for (const [name, spec] of Object.entries(raw)) schema[name] = { type: spec.type, options: spec.options };
    await writeCache(schema);
    return result(schema, "notion", new Date().toISOString());
  } catch {
    if (cache) return result(cache.schema, "cache", cache.updatedAt);
    return result(fallbackSchema(), "fallback", null);
  }
}
