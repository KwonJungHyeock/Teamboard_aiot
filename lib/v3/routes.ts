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
  { old: "/calendar", v3: `${V3_BASE}/calendar`, what: "캘린더 (옛 캘린더)" },
  // 「새 업무」에는 짝이 되는 **옛 경로가 없다** — 옛 화면에서 등록은 모달이라
  // 주소가 없다. 짝표에 안 적는다: 없는 경로를 적으면 아무도 안 지나가는 규칙이 된다.
];

/**
 * 업무 하나로 가는 곳. **한 곳에서 정한다.**
 *
 * C-1 을 낼 때 이 함수는 옛 상세 패널(`/tasks?panel=task:{id}`)을 가리켰다.
 * v3 에 상세가 없었기 때문이다 — 보이면 눌리고, 눌렀는데 없으면 그건 없는
 * 화면이 아니라 고장이다(§G).
 *
 * **C-4 가 섰으므로 이 한 줄이 바뀐다.** 오늘·업무·새 업무·캘린더가 전부
 * 이 함수를 부르므로, 네 화면의 목적지가 한꺼번에 새 상세로 옮겨 간다.
 */
export function taskHref(id: number): string {
  return `${V3_BASE}/tasks/${id}`;
}

/**
 * 옛 주소가 v3 에서 어디로 가는가. 짝이 없으면 `null` — **보내지 않는다.**
 *
 * `full` 은 **쿼리까지 붙은 주소**다(`/tasks?panel=task:12`).
 *
 * ── 없어진 예외 하나 ────────────────────────────────────────────
 *
 * 045 까지는 상세를 여는 주소(`panel` · `task` · `goal`)를 통째로 안 보냈다.
 * v3 에 상세가 없어서, 보내면 `taskHref()` 가 목록으로 삼켜졌기 때문이다.
 * C-4 가 섰으니 그 예외는 지웠다 — 남겨 두면 「왜 이게 여기 있지」가 된다.
 *
 * ── 지우되 **버리지는 않는다** ──────────────────────────────────
 *
 * 예외를 그냥 없애면 `/tasks?panel=task:12` 가 v3 **목록**으로 간다. 주소는
 * 맞는데 도착한 화면은 그 업무가 아니다 — 어느 업무였는지가 조용히 사라지는,
 * §G 가 말한 바로 그 모양이다. 그래서 **번호를 옮겨 준다**: 옛 상세 주소는 새
 * 상세로 간다. 옛 화면이 그 링크를 여러 곳에서 쓰고 있고(가오픈 기한 화면 등),
 * 그 파일들은 이번에도 안 고친다.
 *
 * `goal` 은 옮길 곳이 없다 — v3 에 목표 화면이 없다. `/tasks?panel=goal:…` 은
 * 실재하지 않는 조합이라 목록으로 보내도 잃는 것이 없다.
 */
const TASK_PANEL = /^task:(\d+)$/;

/** 옛 상세 주소에서 업무 번호를 읽는다. 없으면 `null`. */
export function taskIdFromLegacy(search: string): number | null {
  const q = new URLSearchParams(search);
  const panel = q.get("panel");
  const m = panel ? TASK_PANEL.exec(panel) : null;
  if (m) return Number(m[1]);
  // 레거시 파라미터. 옛 패널이 아직 `?task=12` 도 읽는다.
  const legacy = q.get("task");
  if (legacy && /^\d+$/.test(legacy)) return Number(legacy);
  return null;
}

export function v3Destination(full: string): string | null {
  const [path, search = ""] = full.split("?");
  const pair = ROUTE_PAIRS.find((p) => p.old === path);
  if (!pair) return null;
  if (path === "/tasks") {
    const id = taskIdFromLegacy(search);
    if (id !== null) return taskHref(id);
  }
  return pair.v3;
}
