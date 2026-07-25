// 영역별 기본 업무유형 — config 테이블 저장 (코드 하드코딩 금지, 파트 6).
// key='area_default_work_type', value = { "<areaId>": "team"|"personal"|"routine" }.
// 미설정 영역은 전역 기본값 'team' 으로 폴백한다.
import { queryOne, query } from "@/lib/db";

const KEY = "area_default_work_type";
const VALID = ["team", "personal", "routine"] as const;
type WorkType = (typeof VALID)[number];

function coerce(v: unknown): WorkType {
  return (VALID as readonly string[]).includes(v as string) ? (v as WorkType) : "team";
}

async function readMap(): Promise<Record<string, string>> {
  const row = await queryOne<{ value: Record<string, string> }>(
    `SELECT value FROM config WHERE key = $1`,
    [KEY]
  );
  return row?.value ?? {};
}

/** 영역 기본 업무유형 (미설정 시 'team') */
export async function getAreaDefaultWorkType(areaId: number): Promise<WorkType> {
  const map = await readMap();
  return coerce(map[String(areaId)]);
}

/** 영역 기본 업무유형 저장 (설정 UI/스크립트에서 사용) */
export async function setAreaDefaultWorkType(
  areaId: number,
  workType: string,
  updatedBy?: number
): Promise<void> {
  const map = await readMap();
  map[String(areaId)] = coerce(workType);
  await query(
    `INSERT INTO config (key, value, updated_by, updated_at)
     VALUES ($1, $2::jsonb, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [KEY, JSON.stringify(map), updatedBy ?? null]
  );
}
