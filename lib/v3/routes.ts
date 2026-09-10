// v3 경로 — **순수한 값만.** DB 를 안 건드린다 (MD-P-2026-042 §B).
//
// ── 왜 스위치와 갈라 놓는가 ──────────────────────────────────────
//
// `lib/v3/switch.ts` 는 `config` 를 읽으므로 `pg` 를 끌고 온다. 그런데 레일 같은
// **클라이언트 부품도 경로 상수는 필요하다.** 한 파일에 두었더니 브라우저 번들이
// `pg` 를 따라가다 죽었다 — 「모듈을 찾을 수 없다」로.
//
// 그래서 **양쪽이 쓰는 것은 여기**, 서버만 쓰는 것은 저기로 가른다.

/** 새 화면이 사는 곳. 경로를 문자열로 흩뿌리지 않는다. */
export const V3_BASE = "/v3";

/**
 * 같은 자리를 가리키는 **옛 경로 ↔ v3 경로** 짝.
 *
 * 이 표가 있어야 하는 이유: 스위치를 켜면 「모든 내부 링크가 새 경로로」 가야
 * 하는데, 옛 화면 수십 곳의 `href` 를 고치는 것은 **기존 화면을 고치지 않는다**는
 * 이번 회차의 첫째 원칙을 정면으로 어긴다. 대신 옛 경로가 v3 로 **보내 준다**.
 * 고칠 자리가 하나면 스위치를 껐을 때 되돌아오는 것도 확실하다.
 *
 * 화면이 아직 없는 항목은 여기 넣지 않는다 — 넣는 순간 갈 곳 없는 이동이 된다.
 * §C 에서 화면 하나를 지을 때마다 한 줄씩 는다.
 */
export interface RoutePair {
  /** 옛 경로. 정확히 이 경로일 때만 보낸다(하위 경로는 각자 등록). */
  old: string;
  /** v3 경로. `V3_BASE` 로 시작한다. */
  v3: string;
  /** 무슨 화면인지 — 검사기와 사람이 읽는다. */
  what: string;
}

export const ROUTE_PAIRS: RoutePair[] = [
  // 화면이 생길 때마다 한 줄씩 는다. **짝이 되는 옛 경로가 실재하는지**
  // 검사기가 확인한다 — 없는 경로를 적으면 아무도 안 지나가는 규칙이 된다.
  { old: "/", v3: `${V3_BASE}`, what: "오늘 (옛 홈)" },
  { old: "/tasks", v3: `${V3_BASE}/tasks`, what: "업무 (옛 업무 목록)" },
];

/**
 * 업무 하나로 가는 곳. **한 곳에서 정한다.**
 *
 * C-1 을 내면서 행 링크를 `${V3_BASE}/tasks/{id}` 로 적었는데 **그 화면이 아직
 * 없다**(C-4 에서 생긴다). 보이면 눌리고, 눌렀는데 없으면 그건 없는 화면이
 * 아니라 고장이다(§G). 그래서 지금은 옛 상세 패널로 보낸다 —
 * 스위치가 켜져도 `/tasks` 는 짝이 없어 옛 화면 그대로다.
 *
 * C-4 가 생기면 **이 한 줄만** 바꾼다.
 */
export function taskHref(id: number): string {
  return `/tasks?panel=task:${id}`;
}

/**
 * 옛 주소가 v3 에서 어디로 가는가. 짝이 없으면 `null` — **보내지 않는다.**
 *
 * `full` 은 **쿼리까지 붙은 주소**다(`/tasks?panel=task:12`). 경로만 보면
 * 아래 예외를 못 가른다.
 *
 * ── 예외 하나: 상세를 여는 주소는 안 보낸다 ─────────────────────
 *
 * `/tasks` 를 짝에 넣는 순간 `taskHref()` 도 같이 삼켜졌다 — 상세 패널로 가던
 * 링크가 v3 목록으로 갔다. v3 에는 아직 상세 화면이 없다(C-4).
 *
 * 그러니 **상세를 여는 주소는 옛 화면에 남긴다.** 목록만 옮긴다.
 * C-4 가 생기면 `taskHref()` 가 v3 를 가리키게 되고 이 예외는 쓸 일이 없어진다.
 * 그때 지운다 — 남겨 두면 「왜 이게 여기 있지」가 된다.
 */
const DETAIL_PARAMS = ["panel", "task", "goal"];

export function v3Destination(full: string): string | null {
  const [path, search = ""] = full.split("?");
  const pair = ROUTE_PAIRS.find((p) => p.old === path);
  if (!pair) return null;
  const q = new URLSearchParams(search);
  if (DETAIL_PARAMS.some((k) => q.has(k))) return null;
  return pair.v3;
}
