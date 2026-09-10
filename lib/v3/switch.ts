// v3 스위치 — **켜고 끄는 곳이 여기 하나다** (MD-P-2026-042 §B).
//
// ── 무엇이 스위치인가 ────────────────────────────────────────────
//
// `config` 표의 한 행이다. 마이그레이션을 만들지 않는다 — 행이 없으면 **꺼짐**
// 이다. 설정값 하나 때문에 자동 러너에 실패할 자리를 하나 더 만들지 않는다
// (033 에서 세운 판단, 0031 전면 장애 뒤).
//
// ── 계정별이 아니라 **서비스 전체**다 ───────────────────────────
//
// 지시: 켠 사람만 바뀌는 것이 아니다. 두 화면이 동시에 돌면 링크가 엇갈린다 —
// A 가 새 화면에서 보낸 링크를 B 가 옛 화면에서 열면 서로 다른 것을 본다.
// 그래서 **한 값**이고, 그 값을 서버가 읽어 모두에게 같은 화면을 준다.
//
// ── 되돌리기는 스위치를 끄는 것이다 ─────────────────────────────
//
// 배포도 롤백도 필요 없어야 한다. 그러니 이 값을 읽는 자리는 전부 **요청마다**
// 읽어야 한다(`dynamic = "force-dynamic"`). 빌드 때 굳으면 끄는 데 배포가 든다.
import { query, queryOne } from "../db";

export const UI_V3_KEY = "ui_v3_enabled";

// 경로 상수·짝표는 `./routes` 에 있다 — 클라이언트 부품도 그걸 쓰기 때문이다.
// 여기서 재수출하지 않는다: 재수출하면 그 부품이 이 파일을 import 하게 되고,
// 그 순간 `pg` 가 브라우저 번들로 딸려 간다. **한 번 겪었다.**

export async function getUiV3(): Promise<boolean> {
  const row = await queryOne<{ value: unknown }>(
    `SELECT value FROM config WHERE key = $1`, [UI_V3_KEY]
  );
  if (row === null || row === undefined) return false;
  if (typeof row.value === "boolean") return row.value;
  console.error(
    `[v3] ${UI_V3_KEY} 값이 참/거짓이 아니다: ${JSON.stringify(row.value)} — 꺼짐으로 본다`
  );
  return false;
}

export async function setUiV3(on: boolean): Promise<void> {
  await query(
    `INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [UI_V3_KEY, on]
  );
}

