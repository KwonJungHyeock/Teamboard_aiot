// 검사기의 캡처 — **기본은 안 찍는다** (MD-P-2026-057 §0).
//
// 확인이 리포를 바꾸면 그건 확인이 아니다. 검사기를 한 번 돌릴 때마다 캡처가
// 다시 써지면 `git status` 가 더러워지고, 회차와 상관없는 커밋이 붙는다.
// 실제로 058 확인 실행에서 그 커밋이 하나 붙었다.
//
// 찍고 싶을 때만 `SHOT=1` 을 붙인다. 리포 관례대로 대상 폴더는 `OUT` 이 정한다.
//
//     node scripts/v3-charts-walk.mjs           # 재기만 한다 — 파일 안 건드림
//     SHOT=1 node scripts/v3-charts-walk.mjs    # 캡처까지
//
// 캡처가 일인 도구(`capture-empty-states` · `measure-screens` · `motion-frames` ·
// `shots-cmid` · `sweep-visual` · `goal-patch-fail-probe`)는 이 문을 지나지 않는다.
// 그것들은 찍으라고 부르는 것이라 안 찍으면 할 일이 없다.
export const SHOOTING = process.env.SHOT === "1";

/**
 * `target.screenshot(opts)` 자리에 그대로 들어간다.
 * 안 찍을 때는 아무 일도 안 하고 `null` 을 돌려준다 — 부르는 쪽은 반환값을
 * 쓰지 않으므로 흐름이 같다.
 */
export async function shot(target, opts) {
  if (!SHOOTING) return null;
  return target.screenshot(opts);
}
