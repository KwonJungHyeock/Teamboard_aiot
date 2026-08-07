// 저장된 뷰가 바뀌었다는 신호 (MD-P-2026-027 §B3).
//
// 뷰를 저장하는 곳(업무·활동 화면)과 보여주는 곳(사이드바)이 다르다.
// 폴링으로 맞추면 저장하고 나서 몇 초 뒤에야 핀이 생긴다 — 저장한 것 같지가 않다.
// 이벤트 하나로 즉시 맞춘다.
export const SAVED_VIEWS_EVENT = "tb:saved-views-changed";

export function notifySavedViewsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVED_VIEWS_EVENT));
}
