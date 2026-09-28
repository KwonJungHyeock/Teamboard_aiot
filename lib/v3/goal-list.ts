// v3 「목표」 — 펴고 · 거르고 · 적는 규칙 (MD-P-2026-067 §B). 순수 함수다.
//
// ── 무엇을 안 하는가 ────────────────────────────────────────────
//
// **진척을 계산하지 않는다**(§B-7). `/api/goals` 가 주는 `progress` 를 그대로
// 쓴다 — 그 값은 서버가 `lib/progress.ts` 로 센 것이고, 집계 화면도 같은 값을
// 본다. 여기서 한 번 더 세면 같은 목표가 화면마다 다른 숫자를 말한다.
//
// **업무를 따로 고르지 않는다**(§B-8). 목표 상세의 업무 목록은
// `lib/v3/list-query.ts` 의 `selectRows()` 를 지난다 — 업무 목록과 같은 함수다.
//
// ── 왜 거르개가 셋뿐인가 (§B-9) ────────────────────────────────
//
// 「업무 목록의 거르개를 통째로 옮기지 말 것 — 목표는 수가 적다(지금 7건).」
// 일곱 줄짜리 목록에 축 다섯을 달면 거르개가 목록보다 크다.

/** `/api/goals` 의 나무에서 **이 화면이 쓰는 칸만**. */
export interface GoalRow {
  id: number;
  title: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  /** 서버가 센 실효 진척. **null 은 「못 셌다」이지 0% 가 아니다** */
  progress: number | null;
  countedTasks: number;
  ownerActorId: number | null;
  ownerName: string | null;
  ended: boolean;
  children?: GoalRow[];
}

/** 나무를 편다. **깊이를 잃지 않는다** — 부모가 먼저 나온다. */
export function flatten(tree: readonly GoalRow[] | undefined): GoalRow[] {
  const out: GoalRow[] = [];
  const walk = (ns: readonly GoalRow[] | undefined) => {
    for (const g of ns ?? []) { out.push(g); walk(g.children); }
  };
  walk(tree);
  return out;
}

/* ══ 기간 ═════════════════════════════════════════════════════════ */

/** `2026-07-01` → `2026 Q3`. 분기는 **시작 달**로 정한다. */
export function quarterOf(dateStr: string): string {
  const y = dateStr.slice(0, 4);
  const m = Number(dateStr.slice(5, 7));
  return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
}

const TYPE_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월" };

/**
 * 줄에 적는 기간 한 조각 — 「분기 · 2026 Q3」.
 *
 * 월 목표도 **자기가 속한 분기**를 적는다. 분기로 거르는 화면이라
 * 줄마다 분기가 보여야 왜 걸렸는지 읽힌다.
 */
export function periodLabel(g: Pick<GoalRow, "periodType" | "periodStart">): string {
  return `${TYPE_LABEL[g.periodType] ?? g.periodType} · ${quarterOf(g.periodStart)}`;
}

/** 목록에 나오는 분기들. **데이터에 있는 것만** — 없는 분기를 고르게 하지 않는다. */
export function quarters(rows: readonly GoalRow[]): string[] {
  return Array.from(new Set(rows.map((g) => quarterOf(g.periodStart)))).sort().reverse();
}

/* ══ 거르개 셋 (§B-9) ═════════════════════════════════════════════ */

/** `all` 은 「진행중·끝난 것」 둘 다. 탭의 「전체」 자리가 아니라 **기본값**이다. */
export type GoalState = "all" | "open" | "ended";

export interface GoalQuery {
  /** ◉ 내 항목 — 내가 **담당인** 목표 */
  mine: boolean;
  state: GoalState;
  /** `2026 Q3` · 빈 문자열이면 전체 */
  quarter: string;
}

export const EMPTY_GOAL_QUERY: GoalQuery = { mine: false, state: "all", quarter: "" };

export function isEmptyGoalQuery(q: GoalQuery): boolean {
  return !q.mine && q.state === "all" && q.quarter === "";
}

/**
 * 셋을 **교집합**으로 건다 — 업무 목록과 같은 규칙이다(051 §B).
 *
 * `viewerId` 가 없으면 「내 항목」은 아무것도 안 고른다. **조용히 전체를 내지
 * 않는다** — 그러면 걸었는데 안 걸린 화면이 된다.
 */
export function selectGoals(
  rows: readonly GoalRow[], q: GoalQuery, viewerId: number,
): GoalRow[] {
  return rows.filter((g) =>
    (!q.mine || g.ownerActorId === viewerId)
    && (q.state === "all" || (q.state === "ended" ? g.ended : !g.ended))
    && (q.quarter === "" || quarterOf(g.periodStart) === q.quarter));
}

/** 걸린 조건을 사람이 읽는 말로. 빈 화면이 **왜** 비었는지 적는 데 쓴다(§B-10). */
export function goalChips(q: GoalQuery): string[] {
  const out: string[] = [];
  if (q.mine) out.push("내 항목");
  if (q.state === "open") out.push("진행중");
  if (q.state === "ended") out.push("끝난 것");
  if (q.quarter) out.push(`분기 · ${q.quarter}`);
  return out;
}

/**
 * 진척을 글자로. **못 센 것은 「—」다. 0% 가 아니다.**
 *
 * 대시보드가 같은 판단을 하고 있다(066 §D-34) — 두 화면이 같은 함수를 쓰게
 * 여기 둔다. 없는 값과 0은 다른 말이다.
 */
export function pctText(progress: number | null): string {
  return progress === null ? "—" : `${progress}%`;
}
