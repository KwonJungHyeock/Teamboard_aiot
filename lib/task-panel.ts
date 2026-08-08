"use client";

// 업무 상세 슬라이드 패널 — 전역 열기/닫기 (URL ?task=id 반영 + 이벤트 브로드캐스트).
// 어느 화면에서든 openTaskPanel(id) 를 호출하면 AppShell에 마운트된 패널이 열린다.
export const TASK_PANEL_EVENT = "tb:open-task";
export const TASK_UPDATED_EVENT = "tb:task-updated"; // 목록 재동기화 신호

/**
 * 새 업무 등록 모달 (MD-P-2026-027 §C).
 *
 * 만드는 자리와 고치는 자리를 나눈다. 예전에는 오른쪽 상세 패널이 둘을 겸했는데,
 * 420px 안에 생성 폼을 욱여넣느라 설명이 4줄짜리 textarea 였다.
 * 만들기는 화면 한가운데서 한 번에 끝내고(모달), 패널은 **보고 고치는 용도로만** 남긴다 (§C4).
 */
export const NEW_TASK_MODAL_EVENT = "tb:new-task-modal";

/** 새 업무 초기값 (파트 4·6) — 영역/프로젝트/날짜 고정 후 빈 패널 열기용 */
export type NewTaskPrefill = {
  areaId?: number;
  projectId?: number;
  assigneeId?: number;
  workType?: string;
  startDate?: string;
  dueDate?: string;
  /** 제목 미리 채우기 — 메모의 선택 텍스트에서 업무를 만들 때 (MD-P-2026-025 §C) */
  title?: string;
  /** 공개 범위 기본값. 메모에서 나온 업무는 "개인"이다 (§C C-2) */
  visibility?: "team" | "private";
  /** 본문 미리 채우기 — 빠른 입력에서 ⌘Enter 로 모달을 확장할 때 (§C3) */
  description?: string;
  /** 상태 프리셋 — 보드 상태 컬럼에서 만들 때 */
  status?: string;
  /** 우선순위 프리셋 */
  priority?: string;
};

/** 현재 URL의 ?task 값. 정수 id | "new"(새 업무) | null */
export function currentTaskRef(): number | "new" | null {
  if (typeof window === "undefined") return null;
  const sp = new URLSearchParams(window.location.search);
  // MD-P-2026-006 §B — 통합 파라미터 ?panel=task:id 우선, 레거시 ?task= 호환
  const panel = sp.get("panel");
  if (panel) {
    const [kind, idStr] = panel.split(":");
    if (kind !== "task") return null;
    if (idStr === "new") return "new";
    const pid = Number(idStr);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  }
  const v = sp.get("task");
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
  url.searchParams.set("panel", `task:${id}`);
  url.searchParams.delete("task");
  url.searchParams.delete("signal");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(TASK_PANEL_EVENT, { detail: id }));
}

/**
 * 새 업무 등록 모달 열기 (§C).
 *
 * URL 에 `?panel=task:new` 를 그대로 유지한다 — 뒤로가기로 닫히고, 링크로 열린다.
 * 예전 `openNewTaskPanel` 호출부(빈 상태 CTA·영역 추가·메모에서 업무 만들기 등)를
 * 전부 이 함수로 보낸다. 진입점마다 다른 생성 화면이 뜨면 그게 곧 두 벌이다.
 */
export function openNewTaskModal(prefill: NewTaskPrefill = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("panel", "task:new");
  url.searchParams.delete("task");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(NEW_TASK_MODAL_EVENT, { detail: { prefill } }));
}

/** 예전 이름 — 호출부를 한꺼번에 고치지 않아도 되게 남긴다. 동작은 모달이다. */
export const openNewTaskPanel = openNewTaskModal;

/** 모달만 닫는다 (업무 상세 패널이 열려 있으면 건드리지 않는다) */
export function closeNewTaskModal() {
  const url = new URL(window.location.href);
  if (url.searchParams.get("panel") === "task:new") url.searchParams.delete("panel");
  url.searchParams.delete("task");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(NEW_TASK_MODAL_EVENT, { detail: null }));
}

export function closeTaskPanel() {
  const url = new URL(window.location.href);
  url.searchParams.delete("panel");
  url.searchParams.delete("task");
  window.history.pushState({}, "", url);
  window.dispatchEvent(new CustomEvent(TASK_PANEL_EVENT, { detail: null }));
}

/** 업무가 변경됐음을 열려 있는 목록에 알림 (재조회 트리거) */
export function notifyTaskUpdated() {
  window.dispatchEvent(new CustomEvent(TASK_UPDATED_EVENT));
}
