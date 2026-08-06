// 개인 업무 경계 (MD-P-2026-025 §A2·§A3) — 조건을 여기 하나만 둔다.
//
// 지시서 §A3: "클라이언트 필터링으로 처리하지 말 것. 목록 쿼리 자체에서 제외한다."
// 과거에 남의 개인 목표에 붙은 프로젝트를 읽을 수 있던 사고가 있었다.
//
// 조건이 화면마다 흩어지면 한 곳을 빠뜨리는 순간 새어 나간다.
// 024 에서 진척 계산기를 하나로 모은 것과 같은 이유로, 가시성 조건도 하나만 둔다.
//
//   team    — 팀 전체가 본다
//   private — **만든 사람만** 본다. 팀장도 못 본다.
//
// 개인 업무의 주인은 created_by 다. 담당(assignee_id)은 바뀔 수 있지만
// "이건 내 것"의 기준은 바뀌면 안 된다. 0025 마이그레이션이 private 업무를
// 남에게 배정하는 것 자체를 막는다.

/** 공개 범위 두 값. 세 번째 값을 만들지 않는다 — 경계는 단순해야 지켜진다. */
export const VISIBILITIES = ["team", "private"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export function isVisibility(v: unknown): v is Visibility {
  return typeof v === "string" && (VISIBILITIES as readonly string[]).includes(v);
}

/**
 * 이 뷰어가 볼 수 있는 업무인가 — WHERE 에 그대로 붙이는 조건.
 *
 * @param viewerParam  뷰어 actor id 가 들어갈 **파라미터 자리표시자** (예: "$1").
 *                     문자열 보간으로 id 를 직접 박지 않는다.
 * @param t            task 테이블 별칭
 *
 *   query(`SELECT … FROM task t WHERE ${visibleTaskSql("$1")}`, [session.id])
 *
 * 팀장 예외는 **두지 않는다.** 지시서 열람 범위표에서 개인 업무는 팀장도 "안 보임"이다.
 */
export function visibleTaskSql(viewerParam: string, t = "t"): string {
  return `(${t}.visibility = 'team' OR ${t}.created_by = ${viewerParam})`;
}

/**
 * 집계용 — 남의 개인 업무를 **세지도** 않는다.
 * 진척 분모에 남의 개인 업무가 들어가면 숫자로 존재가 새어 나간다.
 */
export const visibleTaskCountSql = visibleTaskSql;

/** 화면에 붙이는 라벨. 아이콘만으로는 무슨 뜻인지 배워야 한다 (§B2). */
export function visibilityLabel(v: Visibility): string | null {
  return v === "private" ? "개인" : null;
}
