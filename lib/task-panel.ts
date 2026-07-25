"use client";

// 업무 상세 슬라이드 패널 — 전역 열기/닫기 (URL ?task=id 반영 + 이벤트 브로드캐스트).
// 어느 화면에서든 openTaskPanel(id) 를 호출하면 AppShell에 마운트된 패널이 열린다.
export const TASK_PANEL_EVENT = "tb:open-task";
export const TASK_UPDATED_EVENT = "tb:task-updated"; // 목록 재동기화 신호

/** 새 업무 초기값 (파트 4·6) — 영역/프로젝트/날짜 고정 후 빈 패널 열기용 */
export type NewTaskPrefill = {
  areaId?: number;
  projectId?: number;
  assigneeId?: number;
  workType?: string;
  startDate?: string;
  dueDate?: string;
};

/** 현재 URL의 ?task 값. 정수 id | "new"(새 업무) | null */
export function currentTaskRef(): number | "new" | null {
  if (typeof window === "undefined") return null;
  const v = new URLSearchParams(window.location.search).get("task");
  if (v === "new") return "new";
  const n = v ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 이전 API 호환 — 정수 id 만 (new는 null 취급) */
export function currentTaskParam(): number | null {
  const r = currentTaskRef();
  return typeof r === "number" ? r : null;
}

/** 업무 클릭 → 패널 열기 (기존 업무 상세) */
export function openTaskPanel(id: number) {
  const url = new URL(window.location.href);
  url.searchParams.set("task", String(id));
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(TASK_PANEL_EVENT, { detail: id }));
}

/** 빈 상태(새 업무) 패널 열기 — 파트 4 "+ 새로 만들기 > 업무", 파트 6 영역 고정 추가 */
export function openNewTaskPanel(prefill: NewTaskPrefill = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("task", "new");
  window.history.pushState({}, "", url);
  window.dispatchEvent(
    new CustomEvent(TASK_PANEL_EVENT, { detail: { mode: "new", prefill } })
  );
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
