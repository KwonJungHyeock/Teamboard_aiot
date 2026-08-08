"use client";

// 목표 트리 연쇄 신호 (MD-P-2026-027 §H4-②).
//
// "내가 한 일이 위로 올라간다" — 업무 진척을 바꾸면 그 값이 월 → 분기 → 연간으로
// 차례로 올라가는 것을 보여준다. 이 제품의 서사다.
//
// **사용자가 직접 값을 바꿨을 때만 재생한다.** 화면 재진입·폴링 갱신·필터 변경에서는
// 재생하지 않는다. 남이 바꾼 값이 내 화면에서 혼자 굴러가면 무슨 일이 일어났는지 알 수 없고,
// 아무 때나 튀면 그 순간 서사가 아니라 장식이 된다.
//
// 그래서 "데이터가 바뀌었다"(TASK_UPDATED)와 **다른 신호**를 쓴다.
// TASK_UPDATED 는 폴링·재조회에서도 뜨지만, 이 신호는 사람이 값을 움직인 자리에서만 쏜다.
export const GOAL_CHAIN_EVENT = "tb:goal-chain";

/**
 * 연쇄를 한 번 예약한다. 유효 시간을 함께 실어 보낸다 —
 * 신호가 온 뒤 목록이 재조회돼 값이 실제로 바뀌기까지 시차가 있고,
 * 그 시차를 넘겨 도착한 변화는 "방금 내가 한 일"이 아니다.
 */
export const CHAIN_WINDOW_MS = 4000;

let generation = 0;

export function notifyGoalChain() {
  if (typeof window === "undefined") return;
  generation += 1;
  window.dispatchEvent(new CustomEvent(GOAL_CHAIN_EVENT, { detail: { gen: generation } }));
}

/** 지금 예약된 연쇄 세대. 새 세대가 오면 진행 중인 연쇄는 끊고 최신 값으로 다시 시작한다. */
export function chainGeneration(): number {
  return generation;
}
