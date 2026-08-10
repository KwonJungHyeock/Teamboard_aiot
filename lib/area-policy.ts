// 영역 분류 — **이 목록은 팀 구조가 바뀌면 바뀐다. 영역을 추가할 때 여기를 같이 본다.**
//
// MD-P-2026-031 §C2 는 홈 목록을 「메인」과 「상시」로 나눈다.
// 화면이나 API 에서 영역 이름 문자열을 **다시 적지 않는다** — 한 군데서만 정한다.
// 컴포넌트 안에 박아 두면 영역이 하나 늘 때 조용히 틀린다. 틀려도 아무도 모른다.
//
// DB 컬럼으로 옮기는 것은 지금 하지 않는다(스키마 변경 = 승인 필요).
// 백로그 **B-17 영역 분류를 데이터로** — 영역이 여섯 개를 넘으면 착수한다.

/** 메인 = 그 달의 성과를 만드는 영역. 홈에서 기본으로 펼친다. */
export const MAIN_AREAS = ["R&D", "플랫폼"] as const;

/** 상시 = 끊기지 않고 도는 일. 홈에서는 접힌 한 줄로 건수만 보인다. */
export const ROUTINE_AREAS = ["연구소", "기타", "현장실습교육"] as const;

export type AreaClass = "main" | "routine";

/**
 * 영역 이름 → 분류.
 *
 * **모르는 영역은 메인으로 본다.** 새 영역이 생겼을 때 조용히 접히는 것보다
 * 눈에 보이는 편이 낫다 — 안 보이면 없는 것이 되고, 그건 되돌리기 어렵다.
 */
export function areaClass(areaName: string | null | undefined): AreaClass {
  if (!areaName) return "main";
  return (ROUTINE_AREAS as readonly string[]).includes(areaName) ? "routine" : "main";
}

/**
 * 상시 영역이라도 **우선순위가 높으면 메인으로 끌어올린다** (§C2).
 * 상시라서 안 보이는 것과 급한데 안 보이는 것은 다르다.
 */
export function showsInMain(t: { areaName?: string | null; priority?: string | null }): boolean {
  return areaClass(t.areaName) === "main" || t.priority === "high";
}
