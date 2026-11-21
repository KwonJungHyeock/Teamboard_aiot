// 운영 전략(0051) 낱말: 축 · 단계 · 상태 · 승인 상태. 화면과 서버는 모두 여기서 가져다 쓴다.
// 값(key)은 DB CHECK 와 같다(db/migrations/0051_strategy.sql). 하나를 늘리면 그 CHECK 도 함께 고친다.

export const STRATEGY_AXES = [
  { key: "inflow", label: "유입·마케팅" },
  { key: "sales", label: "판매·이용권·CS" },
  { key: "content", label: "콘텐츠 확장" },
  { key: "metric", label: "지표·데이터" },
] as const;
export type StrategyAxis = (typeof STRATEGY_AXES)[number]["key"];

export const STRATEGY_PHASES = [
  { key: 1, label: "1단계", sub: "정착기 12~2월" },
  { key: 2, label: "2단계", sub: "연간 운영" },
] as const;
export type StrategyPhase = (typeof STRATEGY_PHASES)[number]["key"];

/** 폐기는 지우기가 아니다(소프트삭제). 상태만 바뀌고, 거르개로 다시 보고 되살린다 */
export const STRATEGY_STATUSES = [
  { key: "live", label: "운영 중" },
  { key: "review", label: "검토 중" },
  { key: "dropped", label: "폐기" },
] as const;
export type StrategyStatus = (typeof STRATEGY_STATUSES)[number]["key"];

/** 변경 이력의 승인 상태: 잠긴 항목을 팀원이 고치면 승인 대기, 그 밖에는 바로 반영 */
export const STRATEGY_APPROVALS = [
  { key: "direct", label: "바로 반영" },
  { key: "pending", label: "승인 대기" },
  { key: "approved", label: "승인" },
  { key: "rejected", label: "반려" },
] as const;
export type StrategyApproval = (typeof STRATEGY_APPROVALS)[number]["key"];

/** 지표 축: 숫자 칸 없이 집계 화면 링크 칸만 둔다(수치는 집계 화면이 낸다) */
export const STRATEGY_LINK_AXIS: StrategyAxis = "metric";

const pick = <T extends { key: string | number; label: string }>(xs: readonly T[]) =>
  (k: unknown): string => xs.find((x) => x.key === k)?.label ?? String(k ?? "");
export const axisLabel = pick(STRATEGY_AXES);
export const phaseLabel = pick(STRATEGY_PHASES);
export const statusLabel = pick(STRATEGY_STATUSES);
export const approvalLabel = pick(STRATEGY_APPROVALS);

export const isAxis = (v: unknown): v is StrategyAxis => STRATEGY_AXES.some((x) => x.key === v);
export const isPhase = (v: unknown): v is StrategyPhase => STRATEGY_PHASES.some((x) => x.key === v);
export const isStatus = (v: unknown): v is StrategyStatus => STRATEGY_STATUSES.some((x) => x.key === v);
