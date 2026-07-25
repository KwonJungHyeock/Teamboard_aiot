"use client";

// 업무 상세 슬라이드 패널 — 전역 열기/닫기 (URL ?task=id 반영 + 이벤트 브로드캐스트).
// 어느 화면에서든 openTaskPanel(id) 를 호출하면 AppShell에 마운트된 패널이 열린다.
export const TASK_PANEL_EVENT = "tb:open-task";
export const TASK_UPDATED_EVENT = "tb:task-updated"; // 목록 재동기화 신호

/** 현재 URL의 ?task 값 (없거나 유효하지 않으면 null) */
export function currentTaskParam(): number | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("task");
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 업무 클릭 → 패널 열기. id=null 이면 빈 상태(새 업무 후 채움/파트 4용). */
export function openTaskPanel(id: number | "new") {
  const url = new URL(window.location.href);
  url.searchParams.set("task", String(id));
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(TASK_PANEL_EVENT, { detail: id }));
}

export function closeTaskPanel() {
  const url = new URL(window.location.href);
  url.searchParams.delete("task");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(TASK_PANEL_EVENT, { detail: null }));
}

/** 업무가 변경됐음을 열려 있는 목록에 알림 (재조회 트리거) */
export function notifyTaskUpdated() {
  window.dispatchEvent(new CustomEvent(TASK_UPDATED_EVENT));
}
