// 영역 분류 — **이 목록은 팀 구조가 바뀌면 바뀐다. 영역을 추가할 때 여기를 같이 본다.**
//
// MD-P-2026-031 §C2 는 홈 목록을 「메인」과 「상시」로 나눈다.
// 화면이나 API 에서 영역 이름 문자열을 **다시 적지 않는다** — 한 군데서만 정한다.
// 컴포넌트 안에 박아 두면 영역이 하나 늘 때 조용히 틀린다. 틀려도 아무도 모른다.
//
// ── 메인/상시 판단 기준 (§C 회신 2-1) ──────────────────────────────
//
// 그 영역의 업무가 **팀의 목표를 달성하기 위해 스스로 계획된 것**이면 메인이다.
// **밖에서 들어온 요청을 받아 처리하는 것**이면 상시다.
//
// 판단이 갈리면 목표 트리를 본다 — 그 영역의 일이 월·분기 목표로 올라온 적이 있는가.
// **단 지금 목표에 연결돼 있는지로 판정하지 않는다.** 연결은 사람이 빠뜨릴 수 있고,
// 실제로 지금 R&D 업무는 목표 연결이 하나도 없다.
// 보는 것은 **연결 상태가 아니라 그 일의 성격**이다.
//
// 예: 교육자료는 메인이다 — 「EDUINO AI 커리큘럼 1차/2차 완성」이 월 목표로 올라와 있고,
//     플랫폼 업무 안에도 교육자료 제작·수정이 들어 있다. 제품의 일부지 부탁받은 일이 아니다.
//     디자인은 상시다 — 목표 트리에 디자인 목표가 없고, 요청을 받아 처리하는 지원 성격이다.
//
// DB 컬럼으로 옮기는 것은 지금 하지 않는다(스키마 변경 = 승인 필요).
// 백로그 **B-17 영역 분류를 데이터로** — 이 파일을 한 달 안에 두 번 이상 고치면 착수한다.

/** 메인 = 팀 목표를 위해 스스로 계획한 일. 홈에서 기본으로 펼친다. */
export const MAIN_AREAS = ["R&D", "플랫폼", "교육자료"] as const;

/** 상시 = 밖에서 들어온 요청을 받아 처리하는 일. 홈에서는 접힌 한 줄로 건수만 보인다. */
export const ROUTINE_AREAS = ["연구소", "현장실습교육", "디자인", "기타"] as const;

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
 * 이 영역이 두 목록 **어디에도 없는가.**
 * 기본값(메인)으로 떨어진 것이라 화면에 `미분류` 를 붙인다 —
 * 그래야 이 파일을 고칠 때가 됐다는 것을 사람이 안다. 기본값은 조용하면 안 된다.
 */
export function isUnclassifiedArea(areaName: string | null | undefined): boolean {
  if (!areaName) return false;
  return !(MAIN_AREAS as readonly string[]).includes(areaName)
    && !(ROUTINE_AREAS as readonly string[]).includes(areaName);
}

/**
 * 상시 영역이라도 **우선순위가 높으면 메인으로 끌어올린다** (§C2).
 * 상시라서 안 보이는 것과 급한데 안 보이는 것은 다르다.
 */
export function showsInMain(t: { areaName?: string | null; priority?: string | null }): boolean {
  return areaClass(t.areaName) === "main" || t.priority === "high";
}
