// 판정 코드에 사람 이름·이메일이 박혀 있지 않은가 (MD-P-2026-041 §A).
//
// 0035 는 **한 사람의 이름을 SQL 에 적는다.** 부트스트랩은 규칙이 아니라 한 번
// 있었던 사건이라 그래도 된다 — 다만 그 예외가 **늘어나지 않는 것**은 글로
// 다짐할 일이 아니라 검사가 지킬 일이다(§G).
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① `lib/` `app/` `components/` 의 **실행되는 코드**에 이름이 없다
//   ② 이메일도 없다 (입력 힌트 placeholder 는 값이 아니라 안내라 뺀다 — 다만 센다)
//   ③ 이름이 **새로운 곳으로 번지지 않았다** — 허용 목록 밖 마이그레이션에 없는가
//   ④ 검사 자체가 살아 있다 — 일부러 만든 가짜 줄을 정말 잡는가
//
// ④가 없으면 이 검사는 「0건」을 낼 때마다 「깨끗하다」와 「아무것도 안 보고
// 있다」를 구분하지 못한다. 빈 것끼리의 일치는 확인이 아니다(§G).
//
// 이름은 0035 에서 읽어 온다. 여기 사본을 적으면 이름이 바뀔 때 검사만 옛 이름을 본다.
//   node scripts/name-in-code-audit.mjs
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOTS = ["lib", "app", "components"];
const EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs"]);
/*
 * 이름이 있어도 되는 자리. **늘리려면 지시가 있어야 한다.**
 *
 * 0003·0008 은 이 규칙이 생기기 한참 전에 **이미 적용된** 초기 데이터다
 * (영역 배정 · 실제 업무 임포트). 이미 적용된 마이그레이션은 고치지 않는다는
 * RUNBOOK 규약 때문에 지울 수 없다. 지울 수 없는 것을 「없다」고 적으면
 * 검사가 거짓말을 하게 되므로, **있는 그대로 적고 왜 그런지 남긴다.**
 * 0035 는 새로 만든 예외다 — 이 목록이 여기서 더 자라면 검사가 막는다.
 */
const ALLOWED = new Set([
  "db/migrations/0003_area_rework.sql",              // 초기 영역 배정 (적용 완료 · 고칠 수 없음)
  "db/migrations/0008_real_tasks_import.sql",        // 실제 업무 임포트 (적용 완료 · 고칠 수 없음)
  "db/migrations/0035_bootstrap_admin_grant.sql",    // 041 §A — 부트스트랩
  "db/migrations/rollback/0035_bootstrap_admin_grant_down.sql",
]);

const UP35 = readFileSync("db/migrations/0035_bootstrap_admin_grant.sql", "utf8");
const NAME = UP35.match(/ac\.display_name\s*=\s*'([^']+)'/)?.[1] ?? null;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*robodyne\.co\.kr/;

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

/** 주석을 걷어낸다 — 남는 것이 **실행되는 코드**다. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // /* */ · JSX {/* */} 의 속
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))  // // — URL 의 // 는 건드리지 않는다
    .join("\n");
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (e === "node_modules" || e === ".next") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(p))) out.push(p);
  }
  return out;
}

/** 한 파일에서 걸린 줄들 — 입력 힌트는 따로 뺀다. */
function scan(file, src) {
  const code = stripComments(src);
  const hits = [], hints = [];
  code.split("\n").forEach((line, i) => {
    const isHint = /placeholder\s*=/.test(line);
    if (NAME && line.includes(NAME)) (isHint ? hints : hits).push([i + 1, "이름", line.trim()]);
    if (EMAIL.test(line)) (isHint ? hints : hits).push([i + 1, "이메일", line.trim()]);
  });
  return { file, hits, hints };
}

ok("0-이름을-0035에서-읽었다", NAME !== null, NAME ? `"${NAME}"` : "**못 찾음 — 식이 바뀌었는가**");
if (!NAME) process.exit(1);

const results = ROOTS.flatMap((r) => walk(r)).map((f) => scan(f, readFileSync(f, "utf8")));
const bad = results.filter((r) => r.hits.length);
const hinted = results.filter((r) => r.hints.length);

ok("①②-판정-코드에-이름·이메일이-없다", bad.length === 0,
   bad.length === 0
     ? `lib · app · components ${results.length}개 파일 · 걸린 곳 0`
     : bad.map((r) => `\n     ${r.file}\n${r.hits.map(([n, k, l]) => `       ${n}행 [${k}] ${l.slice(0, 90)}`).join("\n")}`).join(""));

// 입력 힌트는 값이 아니라 안내다. 막지 않되 **몇 개인지는 보인다** —
// 없앤 지표는 대체 지표와 함께 없앤다(§G). 여기선 안 없애고 세어서 낸다.
console.log(`     (입력 힌트) ${hinted.length}곳 — ${hinted.map((r) => `${r.file}:${r.hints[0][0]}`).join(" · ") || "없음"}`);

// ── ③ 이름이 다른 마이그레이션으로 번지지 않았는가 ──────────────
const mig = [];
for (const d of ["db/migrations", "db/migrations/rollback"]) {
  for (const e of readdirSync(d)) {
    if (!e.endsWith(".sql")) continue;
    const rel = `${d}/${e}`;
    const src = readFileSync(rel, "utf8");
    // 주석은 뺀다. `-- 지시서는 ac.name 이었으나…` 같은 설명이 값으로 읽히면 안 된다.
    const code = src.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    if (code.includes(NAME)) mig.push(rel);
  }
}
const stray = mig.filter((f) => !ALLOWED.has(f));
ok("③-이름이-새로운-곳으로-안-번졌다", stray.length === 0,
   `이름이 든 마이그레이션 ${mig.length}개 [${mig.join(", ")}]${stray.length ? ` · **허용 밖 ${stray.join(", ")}**` : ""}`);

// ── ④ 검사가 살아 있는가 ────────────────────────────────────────
//
// 진짜 파일을 건드리지 않는다. 가짜 원문을 만들어 같은 함수에 넣는다.
const probeBad = scan("가짜.ts", `const who = "${NAME}";\nconst m = "a@robodyne.co.kr";\n`);
const probeComment = scan("가짜2.ts", `// ${NAME} 은 여기 없다\n/* a@robodyne.co.kr */\n`);
ok("④-검사가-살아있다", probeBad.hits.length === 2 && probeComment.hits.length === 0,
   `가짜 코드 ${probeBad.hits.length}건 잡음(2여야 한다) · 가짜 주석 ${probeComment.hits.length}건(0이어야 한다)`);

console.log(`\n${pass}/${pass + fail} 통과`);
process.exitCode = fail ? 1 : 0;
