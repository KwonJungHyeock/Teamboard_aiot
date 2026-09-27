// 영역·프로젝트 조합을 **서버에서** 확인한다 (MD-P-2026-066 §E-44).
//
// 규칙과 문구는 `lib/area-project.ts` 에 있다. 이 파일은 **DB 를 읽는 몫**만
// 맡는다 — 순수 파일에 `pg` 를 끌어들이면 화면 부품이 그걸 따라가다 죽는다
// (`lib/v3/routes.ts` 가 스위치와 갈라진 것과 같은 이유다).
//
// 만들기(POST)와 고치기(PATCH) **둘이 이 함수 하나를 부른다.** 각자 검사하면
// 한쪽만 고쳐지고, 그때부터 「등록은 되는데 수정은 안 되는」 조합이 생긴다.
import { queryOne } from "./db";
import { AREA_PROJECT_MISMATCH } from "./area-project";

/**
 * 안 맞으면 **사람 말로 된 사유**를 돌려준다. 맞으면 `null`.
 *
 * 부르는 쪽은 사유가 오면 그대로 400 으로 내보낸다 — 500 이 아니다.
 * 트리거까지 내려가면 사람이 받는 것은 영문 예외 문구다.
 *
 * @param areaId     저장될 **최종** 영역 (지금 값과 보낸 값을 합친 것)
 * @param projectId  저장될 **최종** 프로젝트. `null` 이면 볼 것이 없다
 */
export async function areaProjectError(
  areaId: number | null, projectId: number | null,
): Promise<string | null> {
  if (projectId === null) return null;          // 프로젝트 없는 업무는 정상이다
  if (areaId === null) return AREA_PROJECT_MISMATCH;
  const row = await queryOne<{ area_id: number }>(
    `SELECT area_id FROM project WHERE id = $1 AND is_active = true`, [projectId]);
  // 없는(또는 내린) 프로젝트도 **같은 문구**로 거절한다. 「그런 프로젝트는 없습니다」를
  // 따로 만들면, 있는지 없는지를 번호로 훑어볼 수 있는 자리가 된다.
  if (!row) return AREA_PROJECT_MISMATCH;
  return row.area_id === areaId ? null : AREA_PROJECT_MISMATCH;
}
