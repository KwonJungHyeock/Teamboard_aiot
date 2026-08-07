// 모션 정적 검사 (MD-P-2026-027 지시 32-b · 32-c · 32-d).
//
// 읽기 전용이다 — DB 도 브라우저도 건드리지 않는다. CSS 파일만 읽는다.
//
// 사람 눈으로는 못 잡는 세 가지를 잡는다:
//   b. transition · animation 이 §H 허용 목록 밖 속성에 걸렸는가
//      (width · height · top · left 가 슬쩍 섞여 들어오는 것)
//   c. 무한 반복 애니메이션이 스켈레톤 shimmer 하나뿐인가
//   d. §H 에 없는 시간·곡선이 하드코딩돼 있는가 (전부 토큰 참조여야 한다)
//
//   node scripts/motion-audit.mjs
import fs from "node:fs";
import path from "node:path";

const FILES = ["lib/theme.css", "app/globals.css", "app/home.css", "app/design.css"];

// §H2 허용 속성. `all` 은 금지다 — 무엇이 움직이는지 읽을 수 없다.
const ALLOWED = new Set([
  "transform", "opacity", "background-color", "border-color", "box-shadow", "stroke-dashoffset",
  // shimmer 전용. §H2 가 "background-position 만 움직인다"고 못 박은 예외.
  "background-position",
  // 값이 아니라 상태를 끄는 키워드
  "none",
]);

// §H1 토큰. 여기 없는 시간·곡선은 쓰지 않는다.
const DUR_TOKENS = ["--dur-1", "--dur-2", "--dur-3", "--dur-4", "--dur-stroke", "--dur-hl"];
const EASE_TOKENS = ["--ease-out", "--ease-in-out"];

const findings = [];
// 짝이 되는 존재 단언 (지시 28) — "0건" 만 세면 shimmer 가 통째로 사라져도 통과한다.
const allowedInfinite = [];
const add = (kind, file, line, text) => findings.push({ kind, file, line, text });

/** 주석을 지운다 — 주석 안의 예시 코드를 위반으로 세지 않기 위해. */
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));

for (const f of FILES) {
  const raw = fs.readFileSync(path.resolve(f), "utf8");
  const src = stripComments(raw);
  const lines = src.split("\n");

  lines.forEach((ln, i) => {
    const no = i + 1;

    // ── b. transition 속성 검사 ──────────────────────────────────────
    // `transition: a .1s, b .2s` 를 콤마로 쪼개고 각 조각의 첫 낱말을 본다.
    const tr = ln.match(/transition:\s*([^;}]+)/);
    if (tr) {
      for (const part of tr[1].split(",")) {
        const prop = part.trim().split(/\s+/)[0];
        if (!prop) continue;
        // 지속시간부터 오는 축약형(`transition: .2s ease`)은 = all 이다
        if (/^[\d.]/.test(prop)) { add("b", f, no, `transition 이 속성 없이 시작 — all 과 같다: "${part.trim()}"`); continue; }
        if (prop.startsWith("var(") || prop === "inherit" || prop === "initial" || prop === "unset") continue;
        if (!ALLOWED.has(prop)) add("b", f, no, `허용 목록 밖 속성에 transition: "${prop}"`);
      }
    }

    // ── b(2). @keyframes 안에서 움직이는 속성 ─────────────────────────
    // 아래 블록 스캔에서 처리한다 (여기서는 줄 단위로 못 본다).

    // ── c. 무한 반복 ────────────────────────────────────────────────
    if (/animation[^;}]*\binfinite\b/.test(ln)) {
      // 스켈레톤만 허용. 선택자는 바로 위 블록 헤더에서 찾는다.
      let head = "";
      for (let j = i; j >= 0 && j > i - 8; j--) {
        if (lines[j].includes("{")) { head = lines[j].split("{")[0].trim(); break; }
      }
      const isSkeleton = /\.sk-(row|block)/.test(head);
      if (isSkeleton) allowedInfinite.push(`${f}:${no} ${head}`);
      else add("c", f, no, `무한 반복 애니메이션 — 선택자 "${head}" (스켈레톤 shimmer 하나만 허용)`);
    }

    // ── d. 하드코딩된 시간 ──────────────────────────────────────────
    if (/(transition|animation)[^;}]*:/.test(ln)) {
      const decl = ln.slice(ln.indexOf(":") + 1);
      // shimmer 의 1.2s 는 §H2 가 값으로 못 박은 유일한 예외다.
      const shimmerLine = /sk-shimmer/.test(ln);
      const times = decl.match(/(?<![\w-])\d*\.?\d+m?s(?![\w-])/g) ?? [];
      for (const t of times) {
        if (shimmerLine && t === "1.2s") continue;
        add("d", f, no, `하드코딩된 시간 "${t}" — ${DUR_TOKENS.join(" · ")} 중 하나를 쓸 것`);
      }
      // 하드코딩된 곡선
      const curves = decl.match(/cubic-bezier\([^)]*\)/g) ?? [];
      for (const c of curves) add("d", f, no, `하드코딩된 곡선 "${c}" — ${EASE_TOKENS.join(" · ")} 중 하나를 쓸 것`);
      // ease / ease-in / ease-out 같은 키워드도 토큰이 아니다.
      // linear 는 shimmer 가 §H2 에서 값으로 지정한 것이라 예외.
      const kw = decl.match(/(?<![\w-])(ease-in-out|ease-in|ease-out|ease)(?![\w-])/g) ?? [];
      for (const k of kw) add("d", f, no, `하드코딩된 곡선 키워드 "${k}" — ${EASE_TOKENS.join(" · ")} 중 하나를 쓸 것`);
      if (/(?<![\w-])linear(?![\w-])/.test(decl) && !shimmerLine) {
        add("d", f, no, `하드코딩된 곡선 키워드 "linear" — shimmer 밖에서는 쓰지 않는다`);
      }
    }
  });

  // ── b(2). @keyframes 블록이 실제로 움직이는 속성 ───────────────────
  const kf = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = kf.exec(src))) {
    const name = m[1];
    // 중괄호 짝을 세어 블록 끝을 찾는다
    let depth = 0, k = m.index + m[0].length - 1, end = k;
    for (; k < src.length; k++) {
      if (src[k] === "{") depth++;
      else if (src[k] === "}") { depth--; if (depth === 0) { end = k; break; } }
    }
    const body = src.slice(m.index, end);
    const startLine = src.slice(0, m.index).split("\n").length;
    for (const d of body.matchAll(/(?:^|[{;])\s*([a-z-]+)\s*:/g)) {
      const prop = d[1];
      if (prop === "from" || prop === "to") continue;
      if (!ALLOWED.has(prop)) add("b", f, startLine, `@keyframes ${name} 이 허용 목록 밖 속성을 움직임: "${prop}"`);
    }
  }
}

// 짝이 되는 존재 단언 — 스켈레톤 shimmer 는 **있어야** 한다.
if (allowedInfinite.length === 0) {
  add("c", "-", 0, "허용된 무한 반복(스켈레톤 shimmer)이 하나도 없다 — 규칙이 아니라 대상이 사라진 것일 수 있다");
}

const byKind = { b: "허용 속성 밖", c: "무한 반복", d: "토큰 아닌 값" };
for (const k of ["b", "c", "d"]) {
  const list = findings.filter((x) => x.kind === k);
  console.log(`\n── 32-${k} ${byKind[k]} — ${list.length}건 ──`);
  for (const x of list) console.log(`  ${x.file}:${x.line}  ${x.text}`);
}
console.log(`\n허용된 무한 반복 ${allowedInfinite.length}건 — ${allowedInfinite.join(" · ") || "없음"}`);
console.log(`합계 ${findings.length}건`);
process.exit(findings.length === 0 ? 0 : 1);
