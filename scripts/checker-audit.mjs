// MD-P-2026-031 §C 회신 · 2-3 — **검사기를 검사한다.**
//
// 브라우저도 DB 도 안 쓴다. 파일만 읽는다. 그래서 언제든 돌려도 안전하다.
//
// ── 왜 있는가 ──────────────────────────────────────────────────
//
// 「검사도 낡는다」가 **세 번** 났다.
//   ① `subtask-walk` 의 행 높이 `=== 38` — §A2 가 44px 로 바꾸자 어긋났다.
//   ② `goal-link-walk` 의 `.lmn` — 컴포넌트를 지웠는데 단언이 남았다.
//   ③ `goal-screen-walk` 의 `"19px"` · `"12.5px"` — §A1 폰트 6단에서 어긋났다.
// 세 번이면 개별 수정으로 끝낼 일이 아니다. **구조로 막는다.**
//
// ── 무엇이 위험한가 — 「조용히 통과하는 단언」 ───────────────────
//
// 없는 선택자를 세면 `count()` 가 늘 0 이다. `=== 0` 을 기대하는 단언은 **영원히 통과**한다.
// 실패하지 않으니 아무도 모른다. **틀린 FAIL 보다 나쁘다** — 틀린 FAIL 은 최소한 보인다.
//
// 규격 숫자를 박아 두면 반대가 된다. 규격이 바뀌는 순간 **멀쩡한 화면이 위반으로** 잡히고,
// 그 상태로 코드를 고치면 멀쩡한 것을 망가뜨린다.
//
//   node scripts/checker-audit.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCRIPTS = fs.readdirSync("scripts").filter((f) => f.endsWith(".mjs") && f !== "checker-audit.mjs");

/** 코드베이스 전체(마크업 + 스타일)를 한 덩어리로 — 선택자가 어디에든 있으면 살아 있는 것이다. */
const haystack = (() => {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(e.name)) out.push(fs.readFileSync(p, "utf8"));
    }
  };
  for (const d of ["app", "components", "lib"]) if (fs.existsSync(d)) walk(d);
  return out.join("\n");
})();

/**
 * §A 토큰 표 — 이 값이 검사기에 **글자로** 박혀 있으면 토큰에서 읽어야 한다.
 * 값이 아니라 **이름**이 규격이다. 이름으로 읽으면 단이 바뀌어도 따라온다.
 */
const TOKENS = {
  "26px": "--f1", "20px": "--f2", "15px": "--f3", "13.5px": "--f4", "12px": "--f5", "11px": "--f6",
  "44px": "--row-h", "38px": "--hdr-h",
  // 6단에서 **없어진** 값들 — 남아 있으면 그 자체로 낡은 단언이다.
  "19px": "(없어진 단 — --f2 20px 로)", "12.5px": "(없어진 단 — --f4 13.5px 로)",
  "13px": "(없어진 단 — --f4 13.5px 로)", "14px": "(없어진 단 — --f3 15px 로)",
};

/**
 * ── ④ 이 검사기 자신에 대한 점검 ────────────────────────────────
 *
 * **빈 것끼리 같은 것은 같은 것이 아니다**(§G). 훑을 파일이 0개면 위반도 0건이고,
 * 그러면 이 도구는 아무 말도 안 한 채 「통과」라고 적는다. 그건 통과가 아니라 미측정이다.
 * (실제로 dev 서버가 죽은 상태에서 검사기 셋의 결과 해시가 전부 빈 문자열의 해시로
 *  같아서 "동일"로 읽을 뻔했다.)
 *
 * 그래서 셋을 먼저 단언한다.
 *   ① 훑은 스크립트가 있는가   ② 대조할 코드베이스가 있는가
 *   ③ **탐지기가 실제로 잡는가** — 일부러 틀린 표본을 넣어 세 탐지기가 각각 반응하는지 본다.
 * ③ 이 「짝이 되는 존재 단언」이다. 없으면 탐지기가 고장 나도 늘 0건이라 조용하다.
 */
const SELF = [];
const selfChk = (ok, what) => SELF.push({ ok, what });

const deadSel = [];
const hardPx = [];
const mute = [];

// 선택자를 받는 자리만 본다. 아무 문자열이나 훑으면 SQL·문구까지 걸린다.
const SEL_CALL = /(?:locator|querySelector|querySelectorAll|\$\$eval|\$eval|\$\$|\$|click|fill|waitForSelector|hasText)\(\s*(["'`])([^"'`]+)\1/g;

for (const f of SCRIPTS) {
  const src = fs.readFileSync(path.join("scripts", f), "utf8");
  const lines = src.split("\n");

  lines.forEach((line, i) => {
    /**
     * **없는 것이 정상인 선택자**가 있다 — 지운 기능이 안 돌아오는지 보는 부재 단언이다.
     * 그건 낡은 것이 아니라 의도다. 다만 **의도라고 적혀 있어야** 봐준다.
     * 바로 윗줄이나 같은 줄에 `audit:absent` 를 적는다. 적지 않으면 낡은 것으로 본다.
     * (「부재 단언 옆에 존재 단언」과 짝이다 — 없어진 것을 재려면 남은 것도 같이 재라.)
     */
    const declared = /audit:absent/.test(line) || /audit:absent/.test(lines[i - 1] ?? "") || /audit:absent/.test(lines[i - 2] ?? "");
    if (declared) return;
    // ── ① 죽은 선택자 ─────────────────────────────────────────
    for (const m of line.matchAll(SEL_CALL)) {
      const sel = m[2];
      if (!sel.includes(".")) continue;
      // `a, b, c` 는 하나만 살아 있어도 동작한다 — 그래도 죽은 가지는 적는다.
      const branches = sel.split(",").map((s) => s.trim());
      for (const b of branches) {
        for (const cls of b.match(/\.[a-zA-Z][\w-]*/g) ?? []) {
          const name = cls.slice(1);
          if (/^(mjs|json|png|css|ts|tsx|js)$/.test(name)) continue;
          if (haystack.includes(name)) continue;
          deadSel.push({ f, line: i + 1, sel, cls, alone: branches.length === 1 });
        }
      }
    }
    /**
     * ── ③ 삼켜진 예외 ─────────────────────────────────────────
     * `catch(() => {})` 는 **없는 실패**를 만든다. 다섯 검사기가 `.frn-x` 오타로
     * 첫 실행 안내를 한 번도 못 닫으면서 몇 달을 통과한 것이 그 결과다.
     * 실패해도 되는 동작이면 **"실패해도 된다"를 로그로 남긴다.**
     */
    if (/catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line)) {
      mute.push({ f, line: i + 1, text: line.trim().slice(0, 88) });
    }
    // ── ② 박아 둔 규격 숫자 ───────────────────────────────────
    for (const m of line.matchAll(/"(\d+(?:\.\d+)?px)"/g)) {
      const px = m[1];
      if (TOKENS[px]) hardPx.push({ f, line: i + 1, px, token: TOKENS[px], text: line.trim().slice(0, 96) });
    }
  });
}

// ── ④ 자기 점검 — 세 탐지기에 일부러 틀린 표본을 물린다 ────────────
{
  const probe = [
    'await page.locator(".zz-없는클래스-probe").click();',   // ① 죽은 선택자
    'const x = fs === "12.5px";',                            // ② 박아 둔 규격 숫자
    'await thing().catch(() => {});',                        // ③ 삼켜진 예외
  ];
  let hitSel = 0, hitPx = 0, hitMute = 0;
  for (const line of probe) {
    for (const m of line.matchAll(SEL_CALL)) {
      for (const cls of (m[2].match(/\.[a-zA-Z][\w-]*/g) ?? [])) {
        if (!haystack.includes(cls.slice(1))) hitSel++;
      }
    }
    for (const m of line.matchAll(/"(\d+(?:\.\d+)?px)"/g)) if (TOKENS[m[1]]) hitPx++;
    if (/catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(line)) hitMute++;
  }
  selfChk(SCRIPTS.length > 0, `훑은 스크립트 ${SCRIPTS.length}개`);
  selfChk(haystack.length > 1000, `대조할 코드베이스 ${Math.round(haystack.length / 1024)}KB`);
  selfChk(hitSel === 1 && hitPx === 1 && hitMute === 1,
    `탐지기 자기 시험 — 죽은 선택자 ${hitSel} · 규격값 ${hitPx} · 삼켜진 예외 ${hitMute} (각 1이어야 한다)`);
}
console.log("── ④ 이 검사기 자신 ────────────────────────────────────────");
for (const s of SELF) console.log(`   ${s.ok ? "ok " : "✗ "} ${s.what}`);
console.log("");

console.log("── ① 코드베이스에 없는 선택자 (조용히 통과하는 단언) ──────────────");
if (!deadSel.length) console.log("   없음");
for (const d of deadSel) {
  console.log(`   ${d.alone ? "✗" : "△"} ${d.f}:${d.line}  ${d.cls}   («${d.sel}»)${d.alone ? "" : " — 여러 갈래 중 하나"}`);
}
console.log(`   ✗ 단독 ${deadSel.filter((d) => d.alone).length}건 · △ 갈래 ${deadSel.filter((d) => !d.alone).length}건\n`);

console.log("── ② 토큰에서 읽어야 할 규격 숫자 ────────────────────────────");
if (!hardPx.length) console.log("   없음");
for (const h of hardPx) console.log(`   ${h.f}:${h.line}  "${h.px}" → ${h.token}\n      ${h.text}`);
console.log(`   합계 ${hardPx.length}건\n`);

console.log("── ③ 삼켜진 예외 `catch(() => {})` ─────────────────────────");
console.log(`   ${mute.length}건 — 실패해도 되는 동작이면 **그렇다고 로그를 남긴다.**`);
const byFile = new Map();
for (const m of mute) byFile.set(m.f, (byFile.get(m.f) ?? 0) + 1);
for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(2)}  ${f}`);
console.log("   (판정에는 아직 넣지 않는다 — 한 번에 다 고치면 그 자체가 위험하다. §D 에서 줄인다)\n");

// 자기 점검이 하나라도 깨지면 **나머지 0건은 증거가 아니다.**
const selfBad = SELF.filter((s) => !s.ok).length;
const fail = deadSel.filter((d) => d.alone).length + hardPx.length + selfBad;
console.log(`합계 — 자기 점검 ${selfBad ? `✗ ${selfBad}건` : "ok"} · 단독 죽은 선택자 ${deadSel.filter((d) => d.alone).length}`
  + ` · 박아 둔 규격값 ${hardPx.length} · 삼켜진 예외 ${mute.length}(참고) · 판정 ${fail ? "실패" : "통과"}`);
process.exit(fail ? 1 : 0);
