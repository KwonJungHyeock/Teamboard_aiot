// 프로젝트 버튼 규칙 검사 (MD-P-2026-032 §B 배치 ①).
//
// `lib/project-buttons.ts` 는 **순수 함수**다 — DB 도 fetch 도 없다. 그래서
// 검사기가 **조건을 만들어** 부를 수 있다. 화면을 띄우고 클릭해서 알아내야 하는
// 것과 다르다. 화면 검사(배치 ②)는 그리기가 맞는지만 보면 된다.
//
// 진짜 `lib/project-buttons.ts` 를 tsc 로 컴파일해 부른다 — 규칙을 .mjs 로 다시
// 쓰면 다시 쓴 것이 맞다는 증거밖에 안 된다.
//
//   node scripts/project-buttons-walk.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const REPO = process.cwd();
const OUT = path.join(REPO, ".pb-walk-out");

let pass = 0;
let fail = 0;
const L = (s) => console.log(s);
const ok = (name, cond, detail = "") => {
  if (cond) { pass++; L(`OK   ${name}${detail ? ` — ${detail}` : ""}`); }
  else { fail++; L(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

// 로컬 실측을 본뜬 재료 (2026-08-27).
//   영역 1 R&D · 2 플랫폼 · 4 디자인
//   권정혁의 actor_area = {1, 2}  ← 소속이 **둘**이다. 하나가 아니다.
const AREAS = [
  { id: 1, name: "R&D" },
  { id: 2, name: "플랫폼" },
  { id: 4, name: "디자인" },
];
const P = (id, name, areaId, type) => ({ id, name, areaId, type });
const GOALS = [P(1, "EDUINO AI", 1, "goal"), P(2, "Playino", 2, "goal"), P(3, "AI 학습추론모델", 1, "goal")];
const STANDING = [P(7, "상시 · R&D", 1, "standing"), P(8, "상시 · 플랫폼", 2, "standing"), P(9, "상시 · 디자인", 4, "standing")];

try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "project-buttons.ts"), "--outDir", OUT,
     "--module", "commonjs", "--moduleResolution", "node", "--target", "es2022",
     "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
  const req = createRequire(path.join(OUT, "noop.cjs"));
  const { projectButtons, withRecentFirst, VISIBLE_PROJECT_BUTTON_LIMIT } =
    req(path.join(OUT, "project-buttons.js"));

  const all = [...GOALS, ...STANDING];

  // ── ① 소속이 둘이면 상시 버튼도 둘, 라벨에 영역이 붙는다 ────────
  const two = projectButtons(all, [1, 2], AREAS);
  const twoStanding = two.buttons.filter((b) => b.kind === "standing");
  ok("① 소속 영역이 둘이면 상시 버튼이 둘이다", twoStanding.length === 2,
     `[${twoStanding.map((b) => b.label).join(" | ")}]`);
  ok("① 라벨에 영역 이름이 붙는다 (둘 이상일 때)",
     twoStanding[0]?.label === "상시 · R&D" && twoStanding[1]?.label === "상시 · 플랫폼",
     `[${twoStanding.map((b) => b.label).join(" | ")}]`);
  ok("① 소속 순서가 버튼 순서다 (actor_area.sort_order)",
     twoStanding[0]?.areaId === 1 && twoStanding[1]?.areaId === 2,
     `areaId [${twoStanding.map((b) => b.areaId).join(", ")}]`);

  // ── ② 소속이 하나면 영역 이름을 안 붙인다 ────────────────────────
  // 짝이 되는 단언. ①만 보면 「언제나 영역을 붙인다」와 구분이 안 된다.
  const one = projectButtons(all, [2], AREAS);
  const oneStanding = one.buttons.filter((b) => b.kind === "standing");
  ok("② 소속 영역이 하나면 라벨이 그냥 `상시` 다",
     oneStanding.length === 1 && oneStanding[0].label === "상시",
     `[${oneStanding.map((b) => b.label).join(" | ")}]`);

  // ── ③ 기본값 = 1순위 영역의 상시 ────────────────────────────────
  ok("③ 기본값은 1순위 영역의 상시다", two.defaultId === 7, `defaultId ${two.defaultId}`);
  const flipped = projectButtons(all, [2, 1], AREAS);
  ok("③ 소속 순서를 뒤집으면 기본값도 바뀐다", flipped.defaultId === 8,
     `defaultId ${flipped.defaultId} (소속 [2,1])`);

  // ── ④ 1순위 영역에 상시가 없으면 **남의 영역으로 흘러가지 않는다** ─
  const noneFirst = projectButtons(all, [99, 1], [...AREAS, { id: 99, name: "새 영역" }]);
  ok("④ 1순위 영역에 상시가 없으면 defaultId 는 null 이다 (2순위로 미끄러지지 않는다)",
     noneFirst.defaultId === null, `defaultId ${noneFirst.defaultId}`);
  ok("④ 그래도 2순위 영역의 버튼은 그린다",
     noneFirst.buttons.some((b) => b.kind === "standing" && b.areaId === 1),
     `상시 버튼 [${noneFirst.buttons.filter((b) => b.kind === "standing").map((b) => b.label).join(" | ")}]`);

  // ── ⑤ 상시가 0건인 영역 — 버튼을 안 그리고 **말한다** ────────────
  ok("⑤ 상시가 없는 영역은 버튼을 그리지 않는다",
     !noneFirst.buttons.some((b) => b.areaId === 99),
     `버튼 [${noneFirst.buttons.map((b) => b.label).join(" | ")}]`);
  ok("⑤ 그리고 조용히 넘어가지 않는다 (problems 에 남는다)",
     noneFirst.problems.some((m) => m.includes("상시 프로젝트가 없다")),
     `problems ${JSON.stringify(noneFirst.problems)}`);

  // ── ⑥ 상시가 2건인 영역 — id 최소 + 말한다 ──────────────────────
  // 0032 유니크 인덱스가 막지만, 인덱스가 없는 환경이 있을 수 있다.
  const dup = projectButtons([...all, P(20, "상시 · R&D (중복)", 1, "standing")], [1], AREAS);
  const dupBtn = dup.buttons.find((b) => b.kind === "standing");
  ok("⑥ 상시가 둘이면 id 최소값을 쓴다", dupBtn?.id === 7, `id ${dupBtn?.id}`);
  ok("⑥ 그리고 무엇을 골랐는지·왜 둘인지를 남긴다",
     dup.problems.some((m) => m.includes("2개") && m.includes("#7") && m.includes("0032")),
     `problems ${JSON.stringify(dup.problems)}`);

  // ── ⑦ 정상일 때는 problems 가 비어 있다 ─────────────────────────
  // 짝이 되는 단언. ⑤⑥만 보면 「언제나 뭔가 불평한다」와 구분이 안 된다.
  ok("⑦ 정상이면 problems 가 비어 있다", two.problems.length === 0,
     `problems ${JSON.stringify(two.problems)}`);

  // ── ⑧ 문턱은 **화면 버튼 수**를 센다 (B-27) ─────────────────────
  ok("⑧ 문턱은 8 이다", VISIBLE_PROJECT_BUTTON_LIMIT === 8, `${VISIBLE_PROJECT_BUTTON_LIMIT}`);
  // goal 6 + 상시 2 = 8 → 안 넘는다 (경계)
  const six = Array.from({ length: 6 }, (_, i) => P(100 + i, `goal ${i}`, 1, "goal"));
  const edge = projectButtons([...six, ...STANDING], [1, 2], AREAS);
  ok("⑧ 버튼 8개는 문턱을 안 넘는다 (경계)",
     edge.buttons.length === 8 && edge.overflow === false,
     `버튼 ${edge.buttons.length} · overflow ${edge.overflow}`);
  const over = projectButtons([...six, P(200, "goal 7", 1, "goal"), ...STANDING], [1, 2], AREAS);
  ok("⑧ 9개는 넘는다", over.buttons.length === 9 && over.overflow === true,
     `버튼 ${over.buttons.length} · overflow ${over.overflow}`);
  // 지금 로컬 형태 — goal 3 + 상시 2 = 5. B-27 이 「4」라고 본 것보다 하나 많다.
  ok("⑧ 지금 형태(goal 3 · 소속 2)는 버튼 5개로 문턱 안이다",
     two.buttons.length === 5 && !two.overflow,
     `버튼 ${two.buttons.length} — B-27 은 「상시 1개」로 보고 4를 셌다. 소속이 둘이라 5다`);

  // ── ⑨ 최근 쓴 것은 **순서만** 바꾼다. 자르지 않는다 ─────────────
  const sorted = withRecentFirst(over.buttons, [200, 8]);
  ok("⑨ 최근 쓴 것이 앞으로 온다",
     sorted[0]?.id === 200 && sorted[1]?.id === 8,
     `앞 두 개 [${sorted.slice(0, 2).map((b) => `${b.id} ${b.label}`).join(" | ")}]`);
  ok("⑨ 개수가 변하지 않는다 (목록을 자르지 않는다)",
     sorted.length === over.buttons.length,
     `${sorted.length} / ${over.buttons.length}`);
  const idsBefore = [...over.buttons.map((b) => b.id)].sort((a, b) => a - b).join(",");
  const idsAfter = [...sorted.map((b) => b.id)].sort((a, b) => a - b).join(",");
  ok("⑨ 같은 것들이 그대로 있다 (뒤섞였을 뿐 사라지지 않았다)", idsBefore === idsAfter,
     idsBefore === idsAfter ? `${sorted.length}개 동일` : `before ${idsBefore} / after ${idsAfter}`);

  L("");
  L(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(OUT, { recursive: true, force: true });
}
