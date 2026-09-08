// 플랫폼 설정 두 값 — **읽고 쓰는 곳이 여기 하나다** (MD-P-2026-033).
//
// ── 왜 config 인가 ───────────────────────────────────────────────
//
// 가오픈일은 **이미 한 번 밀렸다** (10.01 → 11.02). 코드에 상수로 박으면 다음에
// 또 밀릴 때 커밋·빌드·배포가 필요하다. 날짜 하나 때문에 배포를 하면, 급할 때
// 배포를 못 하는 상황이 그대로 「날짜를 못 고친다」가 된다.
//
// `config` 표에 두고 **팀장이 화면에서 바꾼다.** 마이그레이션도 안 만든다 —
// 행이 없으면 아래 기본값을 쓴다. 방금 마이그레이션 하나로 전면 장애를 겪었고,
// 설정값 하나를 넣자고 그 위험을 다시 질 이유가 없다.
//
// ── 진척 편집자를 왜 이름이 아니라 id 로 두는가 ──────────────────
//
// 지시는 「권정혁만 바꿀 수 있게」다. 그대로 코드에 `권정혁` 이나 `actor.id === 1`
// 을 박으면 세 가지가 깨진다.
//
//   · 사람이 바뀌면 **배포**가 필요하다
//   · 그 사람이 비활성되면 **아무도 못 바꾸는데 아무도 모른다**
//   · 이름은 사람이 바꿀 수 있다 (「이름으로 종류를 판정하지 않는다」 §G)
//
// 그래서 **actor id 하나를 `config` 에 둔다.** 지금 값은 권정혁이고, 규칙은
// 「이 한 사람만」이다 — 지시 그대로다. 다만 그 한 사람이 **누구인지는 데이터**다.
import { query, queryOne } from "./db";

export const OPEN_AT_KEY = "platform_open_at";
export const PROGRESS_EDITOR_KEY = "progress_editor_actor_id";

/**
 * 가오픈 목표 시각 — `config` 에 없을 때 쓰는 값.
 *
 * 자료 「가오픈 오픈 조건」(2026-09-08 작성) 기준 **2026-11-02(월) KST 00:00**.
 * 기존 10.01(목) 에서 4주 4일 뒤로 옮겼다.
 */
export const DEFAULT_OPEN_AT = "2026-11-02T00:00:00+09:00";

export interface PlatformOpen {
  /** ISO 문자열. 화면은 이것만 받고 남은 시간은 자기가 센다. */
  openAt: string;
  /** `config` 에서 왔는가, 기본값인가. **화면이 「아직 안 정했다」를 말할 수 있어야 한다.** */
  source: "config" | "default";
}

export async function getPlatformOpen(): Promise<PlatformOpen> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM config WHERE key = $1`, [OPEN_AT_KEY]
  );
  const raw = typeof row?.value === "string" ? row.value : null;
  // 저장값이 깨져 있으면 기본값으로 내려간다. **조용히는 아니다** —
  // 깨진 채로 화면에 `NaN` 이 뜨는 것보다 로그가 남는 편이 낫다.
  if (raw !== null) {
    if (Number.isFinite(Date.parse(raw))) return { openAt: raw, source: "config" };
    console.error(`[platform-config] ${OPEN_AT_KEY} 값을 날짜로 못 읽는다: ${JSON.stringify(raw)} — 기본값을 쓴다`);
  }
  return { openAt: DEFAULT_OPEN_AT, source: "default" };
}

export async function setPlatformOpen(iso: string): Promise<void> {
  if (!Number.isFinite(Date.parse(iso))) throw new Error("날짜를 읽을 수 없습니다.");
  await query(
    `INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::text))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [OPEN_AT_KEY, iso]
  );
}

/**
 * 진척을 수동으로 바꿀 수 있는 **단 한 사람**의 actor id.
 *
 * 아무도 지정되지 않았으면 `null` 이고, 그때는 **아무도 못 바꾼다.**
 * 「지정 안 했으니 전부 허용」으로 열지 않는다 — 권한은 닫힌 쪽이 기본이다.
 */
export async function getProgressEditorId(): Promise<number | null> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM config WHERE key = $1`, [PROGRESS_EDITOR_KEY]
  );
  const n = Number(row?.value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function setProgressEditorId(actorId: number | null): Promise<void> {
  await query(
    `INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::int))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [PROGRESS_EDITOR_KEY, actorId]
  );
}

/**
 * 지정된 사람이 **아직 쓸 수 있는 계정인가.**
 *
 * 비활성된 사람을 가리키고 있으면 진척을 아무도 못 바꾸는데 화면은 멀쩡해 보인다.
 * 그 상태를 설정 화면이 말할 수 있게 이름과 활성 여부를 함께 낸다.
 */
export async function getProgressEditor(): Promise<
  { id: number; name: string; isActive: boolean } | null
> {
  const id = await getProgressEditorId();
  if (id === null) return null;
  const row = await queryOne<{ id: number; display_name: string; is_active: boolean }>(
    `SELECT id, display_name, is_active FROM actor WHERE id = $1`, [id]
  );
  // 지정된 id 의 actor 가 아예 없을 수도 있다(지워졌거나 잘못 넣었거나).
  // `null` 로 접지 않고 그 사실이 보이게 이름 자리에 적는다.
  if (!row) return { id, name: `알 수 없는 계정 #${id}`, isActive: false };
  return { id: row.id, name: row.display_name, isActive: row.is_active };
}
