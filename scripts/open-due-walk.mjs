// 가오픈 기준 기한 표시·집계 검사 (MD-P-2026-037 §B).
//
// `lib/open-due.ts` 는 **순수 함수**다 — `now` 도 `openAt` 도 인자로 받는다.
// 그래서 경계(가오픈 하루 전·당일·하루 뒤)를 시스템 시계 없이 만들 수 있다.
//
//   ① 대문 카운트다운과 **같은 숫자**를 낸다 (계산이 한 곳에서 온다)
//   ② 세 갈래 — 이전 · 이후 · **기한 없음**
//   ③ 경계 — 가오픈 당일은 `before` 다 (`after` 가 아니다)
//   ④ 완료는 세 갈래 모두에서 빠지고, **뺀 수를 따로 낸다**
//   ⑤ 짝 — 완료를 빼도 총합이 맞는다 (before+after+none+excludedDone = 전체)
//
//   node scripts/open-due-walk.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const REPO = process.cwd();
const OUT = path.join(REPO, ".od-walk-out");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "open-due.ts"), path.join(REPO, "lib", "countdown.ts"),
     "--outDir", OUT, "--module", "commonjs", "--moduleResolution", "node",
     "--target", "es2022", "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
  const req = createRequire(path.join(OUT, "noop.cjs"));
  const { openDueMark, tallyOpenDue } = req(path.join(OUT, "open-due.js"));
  const { dDay } = req(path.join(OUT, "countdown.js"));

  const OPEN = Date.parse("2026-11-02T00:00:00+09:00");

  // ── ① 대문과 같은 숫자 ─────────────────────────────────────────
  // 자료 기준일 09-08 → D-55. 기한이 09-08 인 업무도 「가오픈 D-55」여야 한다.
  const m0908 = openDueMark("2026-09-08", OPEN);
  const cd = dDay(OPEN, Date.parse("2026-09-08T09:00:00+09:00"));
  ok("① 대문 카운트다운과 같은 숫자를 낸다", m0908.days === cd && cd === 55,
     `기한 09-08 → ${m0908.label} · 대문 D-${cd}`);

  // ── ② 세 갈래 ──────────────────────────────────────────────────
  ok("② 가오픈 전", openDueMark("2026-10-15", OPEN).bucket === "before",
     `10-15 → ${openDueMark("2026-10-15", OPEN).label}`);
  ok("② 가오픈 후", openDueMark("2026-11-20", OPEN).bucket === "after",
     `11-20 → ${openDueMark("2026-11-20", OPEN).label}`);
  const none = openDueMark(null, OPEN);
  ok("② 기한 없음은 **별개 갈래**다 (0 이나 큰 수로 접지 않는다)",
     none.bucket === "none" && none.days === null && none.label === null,
     JSON.stringify(none));

  // ── ③ 경계 ─────────────────────────────────────────────────────
  ok("③ 가오픈 하루 전은 D-1", openDueMark("2026-11-01", OPEN).days === 1,
     openDueMark("2026-11-01", OPEN).label);
  const day0 = openDueMark("2026-11-02", OPEN);
  ok("③ 가오픈 당일은 `before` 다 (`after` 가 아니다)",
     day0.bucket === "before" && day0.days === 0, `${day0.bucket} · ${day0.label}`);
  const day1 = openDueMark("2026-11-03", OPEN);
  ok("③ 하루 뒤는 `after` 이고 +1일로 적는다",
     day1.bucket === "after" && day1.days === -1, `${day1.bucket} · ${day1.label}`);

  // ── ④⑤ 집계 ───────────────────────────────────────────────────
  const rows = [
    { status: "doing", dueDate: "2026-10-15" },   // before
    { status: "todo",  dueDate: "2026-10-31" },   // before
    { status: "todo",  dueDate: "2026-11-20" },   // after
    { status: "doing", dueDate: null },           // none
    { status: "todo",  dueDate: null },           // none
    { status: "done",  dueDate: "2026-12-01" },   // 완료 — 빠진다
    { status: "done",  dueDate: null },           // 완료 — 빠진다
  ];
  const t = tallyOpenDue(rows, OPEN);
  ok("④ 세 갈래가 맞다", t.before === 2 && t.after === 1 && t.none === 2,
     `이전 ${t.before} · 이후 ${t.after} · 기한없음 ${t.none}`);
  ok("④ 완료는 빠지고 **뺀 수를 따로 낸다**", t.excludedDone === 2, `제외 ${t.excludedDone}`);
  // 짝 — 뺐다고만 하면 총합이 안 맞아 보이고, 안 맞는 총합은 다시 세게 만든다.
  ok("⑤ 네 수의 합이 전체와 같다",
     t.before + t.after + t.none + t.excludedDone === rows.length,
     `${t.before}+${t.after}+${t.none}+${t.excludedDone} = ${rows.length}`);

  console.log("");
  console.log(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(OUT, { recursive: true, force: true });
}
