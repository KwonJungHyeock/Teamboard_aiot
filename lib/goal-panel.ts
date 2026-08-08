"use client";

// 목표 상세 슬라이드 패널 전역 열기/닫기 (파트 C) — 업무 상세 패널과 동일 패턴.
export const GOAL_PANEL_EVENT = "tb:open-goal";
export const GOAL_UPDATED_EVENT = "tb:goal-updated";

/**
 * URL 형식 (MD-P-2026-029 §C2).
 *   패널  ?panel=goal:14
 *   모달  ?panel=goal:14&full=1
 * 업무 패널이 이미 `?panel=task:14` 를 쓰는데 목표만 `?goal=14` 였다.
 * 같은 것을 두 형식으로 적으면 링크를 만들 때마다 어느 쪽인지 봐야 한다.
 * **옛 `?goal=` 도 계속 읽는다** — 이미 돌아다니는 링크가 죽지 않게.
 */
export function currentGoalRef(): { id: number; full: boolean } | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  const p = sp.get("panel") ?? "";
  const m = /^goal:(\d+)$/.exec(p);
  const legacy = sp.get("goal");
  const raw = m ? m[1] : legacy;
  const n = raw ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n <= 0) return null;
  return { id: n, full: sp.get("full") === "1" };
}

/** 예전 이름 — 호출부를 한꺼번에 고치지 않아도 되게 남긴다. */
export function currentGoalParam(): number | null {
  return currentGoalRef()?.id ?? null;
}

function writeUrl(id: number | null, full: boolean) {
  const url = new URL(window.location.href);
  url.searchParams.delete("goal");                 // 옛 형식은 쓰지 않는다
  if (id === null) { url.searchParams.delete("panel"); url.searchParams.delete("full"); }
  else {
    url.searchParams.set("panel", `goal:${id}`);
    if (full) url.searchParams.set("full", "1"); else url.searchParams.delete("full");
  }
  window.history.pushState({}, "", url);
}

export function openGoalPanel(id: number) {
  writeUrl(id, false);
  window.dispatchEvent(new CustomEvent(GOAL_PANEL_EVENT, { detail: { id, full: false } }));
}

/** §C2 확대 — 같은 컴포넌트가 880px 모달로 열린다. 내용을 복제하지 않는다. */
export function openGoalFull(id: number) {
  writeUrl(id, true);
  window.dispatchEvent(new CustomEvent(GOAL_PANEL_EVENT, { detail: { id, full: true } }));
}

/** 모달을 닫으면 패널로 돌아가지 않고 **그대로 닫힌다** (§C2). */
export function closeGoalPanel() {
  writeUrl(null, false);
  window.dispatchEvent(new CustomEvent(GOAL_PANEL_EVENT, { detail: null }));
}

export function notifyGoalUpdated() {
  window.dispatchEvent(new CustomEvent(GOAL_UPDATED_EVENT));
}
