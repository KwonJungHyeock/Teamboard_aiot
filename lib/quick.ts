"use client";

// 빠른 생성 팝오버 + 토스트 — 전역 이벤트 헬퍼. 4개 진입점이 같은 팝오버를 공유한다.
export const QUICK_CREATE_EVENT = "tb:quick-create";
export const TOAST_EVENT = "tb:toast";

export interface QuickPrefill {
  dueDate?: string;
  startDate?: string; // 캘린더 일자 클릭 — 시작일 프리셋
  assigneeId?: number;
  areaId?: number;
  status?: string; // 보드 상태 컬럼 "+추가" — 그 컬럼 상태로 프리셋
}
export interface QuickAnchor { x: number; y: number }

/** 빠른 생성 팝오버 열기 — anchor(클릭 위치)에 붙여 띄운다. */
export function openQuickCreate(anchor: QuickAnchor, prefill: QuickPrefill = {}) {
  window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT, { detail: { anchor, prefill } }));
}

/** 미세 피드백 토스트. tone: ok | err
 *  action을 주면 토스트 안에 버튼이 붙는다 — 일괄 처리 실행취소에 쓴다 (MD-P-2026-007 §C). */
export function toast(
  message: string,
  tone: "ok" | "err" = "ok",
  action?: { label: string; onClick: () => void }
) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { message, tone, action } }));
}
