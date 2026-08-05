// 활동 분류 라벨 (MD-P-2026-007) — 서버·클라이언트가 함께 쓰는 순수 상수.
// 새 알림 타입을 만들지 않고, 기존 (type, ref_type) 조합을 이 7종으로 갈라 표시한다.

export type ActivityKind = "mention" | "assign" | "reply" | "approval" | "deadline" | "decision" | "share" | "system";
export type Channel = "human" | "system";

export const ACTIVITY_KINDS: ActivityKind[] = [
  "mention", "assign", "reply", "approval", "deadline", "decision", "share", "system",
];

/** 필터 레일에 노출되는 순서 (share는 "전체"에서만 보인다 — 전용 행 없음). */
export const RAIL_KINDS: ActivityKind[] = ["mention", "assign", "reply", "approval", "deadline", "decision"];

/**
 * 종류 → 채널. classify() 와 같은 규칙을 상수로 굳혀둔 것이다.
 * 레일은 이걸로 현재 채널의 종류만 그린다 — 예전엔 두 탭이 같은 목록을 보여줘서
 * 사람 탭에 "마감 9", 시스템 탭에 "멘션 1·승인 3" 처럼 그 탭에 있을 수 없는 숫자가 떴다
 * (MD-P-2026-018 §B).
 */
export const KIND_CHANNEL: Record<ActivityKind, Channel> = {
  mention: "human",
  assign: "human",
  reply: "human",
  approval: "human",
  decision: "human",
  share: "human",
  deadline: "system",
  system: "system",
};

export const KIND_LABEL: Record<ActivityKind, string> = {
  mention: "멘션",
  assign: "배정",
  reply: "답글",
  approval: "승인 요청",
  deadline: "마감",
  decision: "결정",
  share: "공유",
  system: "시스템",
};

/** 타입별 아이콘·색 (§G). 색은 기존 토큰만 쓴다. */
export const KIND_ICON: Record<ActivityKind, { icon: string; tone: string }> = {
  mention: { icon: "@", tone: "--purple" },
  assign: { icon: "◱", tone: "--teal" },
  reply: { icon: "↩", tone: "--blue" },
  approval: { icon: "!", tone: "--coral" },
  deadline: { icon: "⏱", tone: "--coral" },
  decision: { icon: "✓", tone: "--green" },
  share: { icon: "↗", tone: "--slate" },
  system: { icon: "⚙", tone: "--slate" },
};

export const CHANNEL_LABEL: Record<Channel, string> = { human: "사람", system: "시스템" };
