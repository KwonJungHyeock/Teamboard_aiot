// 활동 분류 라벨 (MD-P-2026-007) — 서버·클라이언트가 함께 쓰는 순수 상수.
// 새 알림 타입을 만들지 않고, 기존 (type, ref_type) 조합을 이 7종으로 갈라 표시한다.

export type ActivityKind = "mention" | "assign" | "reply" | "approval" | "deadline" | "decision" | "share";
export type Channel = "human" | "system";

export const ACTIVITY_KINDS: ActivityKind[] = [
  "mention", "assign", "reply", "approval", "deadline", "decision", "share",
];

/** 필터 레일에 노출되는 순서 (share는 "전체"에서만 보인다 — 전용 행 없음). */
export const RAIL_KINDS: ActivityKind[] = ["mention", "assign", "reply", "approval", "deadline", "decision"];

export const KIND_LABEL: Record<ActivityKind, string> = {
  mention: "멘션",
  assign: "배정",
  reply: "답글",
  approval: "승인 요청",
  deadline: "마감",
  decision: "결정",
  share: "공유",
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
};

export const CHANNEL_LABEL: Record<Channel, string> = { human: "사람", system: "시스템" };
