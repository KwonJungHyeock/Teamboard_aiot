"use client";

// 목표 상세 슬라이드 패널 전역 열기/닫기 (파트 C) — 업무 상세 패널과 동일 패턴.
export const GOAL_PANEL_EVENT = "tb:open-goal";
export const GOAL_UPDATED_EVENT = "tb:goal-updated";

export function currentGoalParam(): number | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("goal");
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function openGoalPanel(id: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("goal", String(id));
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(GOAL_PANEL_EVENT, { detail: id }));
}

export function closeGoalPanel() {
  const url = new URL(window.location.href);
  url.searchParams.delete("goal");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(GOAL_PANEL_EVENT, { detail: null }));
}

export function notifyGoalUpdated() {
  window.dispatchEvent(new CustomEvent(GOAL_UPDATED_EVENT));
}
