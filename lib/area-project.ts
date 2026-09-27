// 영역과 프로젝트의 관계 — **한 곳에서 온다** (MD-P-2026-066 §E-3).
//
// ── 왜 한 곳인가 ────────────────────────────────────────────────
//
// 지시서 §E-45: 「이 규칙을 상세와 새 업무가 따로 갖지 않는다. 한 곳에서 온다.
// 같은 판단을 두 화면이 각자 가지면 언젠가 갈린다.」
//
// 갈리는 모양이 이미 정해져 있다. DB 에 트리거가 있다 —
//
//     task_area_matches_project():
//       RAISE EXCEPTION 'task.area_id(%) must match project.area_id for project %'
//
// 화면이 안 맞는 조합을 보낼 수 있으면 사람이 받는 것은 **500 과 영문 예외**다.
// 그래서 셋을 한 파일에서 낸다:
//   ① 고를 수 있는 프로젝트 목록 (§E-42 — 안 맞는 것은 **내놓지 않는다**)
//   ② 영역을 바꿨을 때의 한 줄 안내 (§E-43 — 조용히 비우지 않는다)
//   ③ 서버가 거절할 때의 문구 (§E-44 — **제약 이름을 안 내보낸다**)
//
// ── 막는 자리가 아니라 **내놓는 자리**에서 정한다 (§E-42) ────────
//
// 「고를 수 있게 내놓고 저장에서 막지 않는다.」 못 고르게 하는 것이 먼저고,
// 서버의 400 은 주소·스크립트로 들어온 것을 위한 마지막 그물이다.
//
// **이 파일은 순수하다.** `pg` 를 끌고 오지 않는다 — 화면 부품이 그대로 부른다
// (`lib/v3/routes.ts` 가 같은 이유로 스위치와 갈라져 있다). DB 를 읽어야 하는
// 쪽은 `lib/area-project-server.ts` 다.

/** 고르개가 쓰는 프로젝트 한 줄. 이름 말고 **영역 번호**로 판단한다. */
export interface ProjectPick {
  id: number;
  name: string;
  areaId: number;
  /** `goal` · `standing`. 화면이 상시 프로젝트를 다르게 그린다 (032 §B). */
  type?: string;
}

/**
 * 그 영역에서 고를 수 있는 프로젝트. **영역을 안 골랐으면 빈 목록이다.**
 *
 * 영역 없이 전부 내놓으면 「고르고 나서 영역을 고르면 안 맞는 조합」이 만들어진다.
 * 순서는 받은 순서를 지킨다 — 여기서 다시 정렬하면 화면마다 순서가 달라진다.
 */
export function projectsForArea(projects: readonly ProjectPick[], areaId: number | null): ProjectPick[] {
  if (areaId === null) return [];
  return projects.filter((p) => p.areaId === areaId);
}

/**
 * 이 조합이 맞는가. `projectId` 가 없으면 **맞는 것이다** — 프로젝트 없는 업무는
 * 정상이다(`task.project_id` 는 NULL 을 받는다).
 *
 * 모르는 프로젝트 번호는 **안 맞는 것으로 본다.** 목록에 없는 번호를 통과시키면
 * 트리거까지 내려가서 500 이 된다.
 */
export function fits(
  projects: readonly ProjectPick[], areaId: number | null, projectId: number | null,
): boolean {
  if (projectId === null) return true;
  if (areaId === null) return false;
  const p = projects.find((x) => x.id === projectId);
  return p !== undefined && p.areaId === areaId;
}

/**
 * 영역을 바꿨을 때 프로젝트를 비워야 하는가 (§E-43).
 *
 * 비울 때는 **한 줄 안내**를 함께 낸다 — 조용히 비우면 사람은 자기가 고른 것이
 * 저장됐다고 믿고, 나중에 프로젝트 없는 업무를 보고서야 안다.
 */
export function clearsProject(
  projects: readonly ProjectPick[], nextAreaId: number | null, projectId: number | null,
): boolean {
  return projectId !== null && !fits(projects, nextAreaId, projectId);
}

/** 비웠다고 알리는 한 줄. **무엇이 왜 비었는지**를 적는다. */
export const PROJECT_CLEARED = "영역을 바꿨으니 프로젝트를 다시 고르세요. 앞의 프로젝트는 그 영역의 것이 아닙니다.";

/** 영역을 안 골랐을 때 프로젝트 자리에 서는 한 줄. */
export const PICK_AREA_FIRST = "영역을 먼저 고르면 그 영역의 프로젝트가 나옵니다.";

/**
 * 서버가 거절할 때의 문구 (§E-44).
 *
 * **제약 이름도 컬럼 이름도 없다.** `trg_task_area_match` 나 `task.area_id` 를
 * 내보내면 읽는 사람이 할 수 있는 일이 없고, 우리 안쪽 구조만 새어 나간다.
 */
export const AREA_PROJECT_MISMATCH =
  "고른 프로젝트가 그 영역의 프로젝트가 아닙니다. 영역을 바꾸거나 프로젝트를 다시 고르세요.";
