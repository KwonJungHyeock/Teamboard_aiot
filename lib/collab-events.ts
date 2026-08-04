"use client";

// 협업 화면 갱신 신호 — 전역 패널에서 벌어진 변화를 좌측 목록이 따라잡게 한다.
// (패널이 목록 컴포넌트 바깥에 마운트되므로 콜백 대신 이벤트로 잇는다.)
export const SIGNAL_CHANGED_EVENT = "tb:signal-changed";
export const SAVED_CHANGED_EVENT = "tb:saved-changed";

export function notifySignalChanged() {
  window.dispatchEvent(new CustomEvent(SIGNAL_CHANGED_EVENT));
}
export function notifySavedChanged() {
  window.dispatchEvent(new CustomEvent(SAVED_CHANGED_EVENT));
}
