// 저장된 뷰 (MD-P-2026-027 §B3) — 화면 조건을 이름 붙여 저장한다.
//
// **표도 하나, 경로도 하나다.** 활동 화면에만 있던 것을 업무·목표까지 받도록 넓혔다.
// 같은 개념이 두 곳에 따로 있으면 반드시 갈라진다 — 지시서가 "흡수해 통일" 이라고 한 이유다.
//
// **저장된 뷰는 항상 개인이다.** 공유 옵션을 만들지 않는다.
// 그래서 조건은 `owner_actor_id = viewer` 하나뿐이고, 이 파일 밖에서 다른 조건을 붙이지 않는다.
// (lib/visibility.ts 가 업무에 대해 하는 역할을 여기서는 이 한 줄이 한다)
export const VIEW_TARGETS = ["tasks", "goals", "activity"] as const;
export type ViewTarget = (typeof VIEW_TARGETS)[number];

export function isViewTarget(v: unknown): v is ViewTarget {
  return typeof v === "string" && (VIEW_TARGETS as readonly string[]).includes(v);
}

export interface SavedView {
  id: number;
  name: string;
  target: ViewTarget;
  /** 화면이 그대로 URL 쿼리로 복원할 수 있는 모양. 해석은 화면이 한다. */
  filters: Record<string, string>;
  sortOrder: number;
  isPinned: boolean;
}

/** 이름 길이 상한 — 사이드바 핀에 들어가야 한다. 잘리는 이름은 이름이 아니다. */
export const VIEW_NAME_MAX = 40;

/**
 * 저장할 필터를 정규화한다.
 * 빈 값은 **버린다** — `?area=&status=` 같은 껍데기를 저장해두면
 * 나중에 "이 뷰는 무슨 조건이었지"를 알 수 없다.
 */
export function normalizeFilters(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s === "") continue;
    out[k] = s;
  }
  return out;
}

/** 저장된 뷰를 URL 쿼리로 되돌린다. 화면은 이 문자열을 그대로 주소에 넣으면 된다. */
export function filtersToQuery(filters: Record<string, string>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) qs.set(k, v);
  return qs.toString();
}

/** 저장된 뷰가 가리키는 경로. 화면이 늘면 여기만 고친다. */
export function viewHref(v: SavedView): string {
  const base = v.target === "activity" ? "/activity" : v.target === "goals" ? "/goals" : "/tasks";
  const qs = filtersToQuery(v.filters);
  return qs ? `${base}?${qs}` : base;
}
