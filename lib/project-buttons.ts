// 등록 화면의 **프로젝트 버튼** — 규칙이 사는 한 곳 (MD-P-2026-032 §B · B-27).
//
// ── 왜 lib 에 두는가 ──────────────────────────────────────────────
//
// 등록 경로가 셋이다(모달 · 인라인 한 줄 · 빠른 만들기). 규칙을 화면에 두면
// 세 벌이 되고, 세 벌은 반드시 어긋난다. §C3 에서 게이트 하나가 네 곳으로
// 복제될 뻔한 것과 같은 자리다.
//
// **순수 함수다.** DB 도 fetch 도 없다 — 그래서 검사기가 조건을 만들어 부를 수 있다.
//
// ── 무엇을 세는지 이름에 넣는다 (B-27) ────────────────────────────
//
// 문턱의 목적은 「버튼 줄이 길어지면 못 읽는다」이므로 세야 할 것은 **그려지는
// 것**이지 DB 행 수가 아니다. `PROJECT_LIMIT` 이라고 쓰면 다음 사람이 행 수로
// 읽는다. 그래서 이름이 길다.
export const VISIBLE_PROJECT_BUTTON_LIMIT = 8;

/** 최근 쓴 것을 위로 올리는 개수 — 문턱을 넘었을 때만 쓴다. 028 §B1 과 같은 수. */
export const RECENT_PROJECT_LEAD = 3;

export interface ProjectOption {
  id: number;
  name: string;
  areaId: number;
  type: "goal" | "standing";
}

export interface AreaOption {
  id: number;
  name: string;
}

export interface ProjectButton {
  id: number;
  /** 화면에 그릴 글자. 상시는 영역 이름이 붙거나(여럿) 안 붙는다(하나). */
  label: string;
  areaId: number;
  kind: "goal" | "standing";
}

export interface ProjectButtonSet {
  buttons: ProjectButton[];
  /**
   * 문턱을 넘었는가. 넘으면 화면은 버튼 대신 검색형 콤보를 그리고
   * **최근 쓴 것 3개를 위로** 올린다(028 §B1 과 같은 패턴 — 새 설계가 아니다).
   */
  overflow: boolean;
  /** 아무것도 안 골랐을 때의 기본값. **1순위 영역의 상시.** 없으면 null. */
  defaultId: number | null;
  /**
   * **조용히 틀리지 않기 위한 출구.**
   *
   * 「영역당 상시 하나」는 `0032` 유니크 인덱스가 지킨다. 그래도 여기서 다시 세는
   * 이유는 인덱스가 없는 환경(되돌린 뒤·새 DB·테스트)이 있을 수 있고, 그때
   * **아무거나 고르고 아무 말도 안 하는 것**이 제일 나쁘기 때문이다.
   *
   * 호출부가 `console.error` 로 남긴다. 값을 비우지는 않는다 —
   * 등록을 막는 것보다 이상한 채로 등록되는 편이 낫고, 로그가 남으면 고칠 수 있다.
   */
  problems: string[];
}

/**
 * 내 소속 영역의 상시 프로젝트를 **소속 순서대로** 찾는다.
 *
 * 「담당자 영역」은 하나가 아니다 — `actor_area` 는 다대다이고 실측으로 사람마다
 * 둘이다. 그래서 **소속 순서(`actor_area.sort_order`)가 곧 우선순위**이고,
 * 첫 번째가 기본값이 된다. 서버가 그 순서로 `myAreaIds` 를 준다.
 */
export function projectButtons(
  projects: ProjectOption[],
  myAreaIds: number[],
  areas: AreaOption[],
  /**
   * **지금 고른 영역** (061 §A-1). 주면 그 영역의 프로젝트만 내놓는다.
   *
   * 안 주면 예전 그대로다 — 이 함수를 부르는 다른 자리(기본값만 필요한 곳)가
   * 영역을 모를 수 있기 때문이다.
   */
  selectedAreaId?: number | null
): ProjectButtonSet {
  const problems: string[] = [];
  const areaName = new Map(areas.map((a) => [a.id, a.name]));

  /*
   * ── 061 §A-1 · 고를 수 없는 것은 내놓지 않는다 ──────────────────
   *
   * 032 §B 는 goal 프로젝트를 **영역으로 안 걸렀다**: 「프로젝트는 팀 단위이고
   * 남의 영역 프로젝트에 일감이 생길 수 있다. 거르면 그 경우 등록 화면에서
   * 길이 사라진다.」
   *
   * 그런데 DB 에 `trg_task_area_match` 가 있다 — 업무의 영역과 프로젝트의
   * 영역이 다르면 저장이 거부된다. 그래서 **고를 수는 있는데 저장은 안 되는**
   * 조합이 생겼고, 사람은 세 동작이면 500 을 만났다.
   *
   * 고를 수 없는 것을 내놓지 않는다. 남의 영역 프로젝트로 가는 길은
   * **사라진 것이 아니라 영역을 먼저 바꾸는 것**으로 바뀌었다 — 그쪽이
   * 실제로 일어나는 일(그 영역의 업무를 만든다)과도 맞다.
   *
   * 버린 두 안과 이유 (061 §A):
   *   ㉠ 프로젝트를 고르면 영역이 따라간다 — 고르지 않은 값이 조용히 바뀐다.
   *      화면에 R&D 라 적어 놓고 플랫폼으로 저장하는 것과 같다.
   *   ㉡ 서버가 프로젝트의 영역을 쓴다 — 같은 문제가 서버로 옮겨간 것뿐이고
   *      화면은 계속 거짓말을 한다.
   */
  const inArea = (p: ProjectOption) =>
    selectedAreaId === undefined || selectedAreaId === null || p.areaId === selectedAreaId;

  const goalButtons: ProjectButton[] = projects
    .filter((p) => p.type === "goal" && inArea(p))
    .map((p) => ({ id: p.id, label: p.name, areaId: p.areaId, kind: "goal" as const }));

  /*
   * ── 상시 — 내 소속 영역만, 소속 순서대로 ──
   *
   * 061 §A-1 — **영역을 골랐으면 그 영역 하나만 본다. 내 영역인지는 안 따진다.**
   *
   * 처음엔 `myAreaIds.filter(...)` 로 적었다가 화면이 거짓말을 했다: 연구소·
   * 교육자료·현장실습교육·기타에는 상시 프로젝트가 **실재하는데** 내 소속이
   * 아니라서 버튼이 0개가 되고, 화면이 「이 영역에는 프로젝트가 없습니다」라고
   * 적었다. 그 영역을 고른 업무라면 그 상시 프로젝트는 제약을 통과한다 —
   * 고를 수 있는 것을 안 내놓고 없다고 말한 것이다. §A 가 없애려는 것의 거울상이다.
   *
   * 소속 제한은 **아무 영역도 안 골랐을 때**의 뜻이다 — 그때는 「내 일」의
   * 기본값을 고르는 자리이고, 순서(`sort_order`)가 곧 우선순위다.
   */
  const areaLoop = (selectedAreaId === undefined || selectedAreaId === null)
    ? myAreaIds
    : [selectedAreaId];
  const many = myAreaIds.length > 1;
  const standingButtons: ProjectButton[] = [];
  for (const areaId of areaLoop) {
    const found = projects.filter((p) => p.type === "standing" && p.areaId === areaId);

    if (found.length === 0) {
      // **버튼을 그리지 않는다.** 없는 것을 누르게 하지 않는다.
      //
      // 061 §A-1 — 다만 **영역을 골라서 보는 중이면 이것은 사고가 아니다.**
      // 그 영역에 프로젝트가 없는 것은 있을 수 있는 일이고, 화면이 그때
      // 「이 영역에는 프로젝트가 없습니다」를 적는다. 고를 때마다
      // `console.error` 가 찍히면 진짜 사고가 그 밑에 묻힌다.
      if (selectedAreaId === undefined || selectedAreaId === null) {
        problems.push(
          `영역 ${areaName.get(areaId) ?? areaId}(id ${areaId}) 에 상시 프로젝트가 없다 — 버튼을 그리지 않는다`
        );
      }
      continue;
    }
    if (found.length > 1) {
      // 0032 유니크 인덱스가 막지만, 인덱스가 없는 환경일 수 있다.
      // **조용히 하나 고르지 않는다.** 무엇을 골랐는지와 왜 둘인지를 남긴다.
      problems.push(
        `영역 ${areaName.get(areaId) ?? areaId}(id ${areaId}) 에 상시 프로젝트가 ${found.length}개다 ` +
        `(${found.map((p) => `#${p.id}`).join(" ")}) — id 최소값 #${Math.min(...found.map((p) => p.id))} 를 쓴다. ` +
        `0032 유니크 인덱스가 걸려 있는지 확인할 것`
      );
    }
    const pick = found.reduce((a, b) => (a.id <= b.id ? a : b));
    standingButtons.push({
      id: pick.id,
      // 소속 영역이 하나뿐이면 영역 이름이 군더더기다 — 어차피 그 영역뿐이다.
      label: many ? `상시 · ${areaName.get(areaId) ?? `영역 ${areaId}`}` : "상시",
      areaId,
      kind: "standing",
    });
  }

  const buttons = [...goalButtons, ...standingButtons];

  return {
    buttons,
    overflow: buttons.length > VISIBLE_PROJECT_BUTTON_LIMIT,
    // 1순위 영역의 상시. 그 영역에 상시가 없으면 아래로 내려가지 않고 **null 이다** —
    // 「내 영역의 상시」가 기본값의 뜻이므로, 남의 영역으로 흘러가면 뜻이 달라진다.
    defaultId: standingButtons.find((b) => b.areaId === myAreaIds[0])?.id ?? null,
    problems,
  };
}

/**
 * 문턱을 넘었을 때 **최근 쓴 것을 위로** 올린 순서.
 *
 * 목록을 자르지 않는다 — 자르면 안 쓰던 프로젝트로 옮길 길이 사라지고,
 * **그 이동을 쉽게 만드는 것이 §B 의 목적**이라 정반대가 된다.
 * **순서만 바꾼다.**
 */
export function withRecentFirst(
  buttons: ProjectButton[],
  recentIds: number[]
): ProjectButton[] {
  const rank = new Map(recentIds.slice(0, RECENT_PROJECT_LEAD).map((id, i) => [id, i]));
  const lead = buttons
    .filter((b) => rank.has(b.id))
    .sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
  const rest = buttons.filter((b) => !rank.has(b.id));
  return [...lead, ...rest];
}
