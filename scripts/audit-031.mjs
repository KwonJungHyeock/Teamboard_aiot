// 031 준비 조사 — 세로 정렬 · 버튼 규격 · 칩 종류 (MD-P-2026-028 §B 회신 [병행]).
//
// **읽기 전용이다. 아무것도 고치지 않는다.** 목록만 만든다.
// 21경로를 열어 DOM 을 재고 표로 낸다. 결과는 docs/audit/031/ 에 남는다.
//
//   node scripts/audit-031.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/audit/031";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

/** 21경로 — 다른 검사와 **같은 목록**을 쓴다. 목록이 갈리면 "전 화면"이 뜻을 잃는다. */
const ROUTES = [
  "/", "/tasks", "/goals", "/projects", "/projects/1", "/calendar", "/signals",
  "/signals?tab=decision", "/inbox", "/activity", "/huddle", "/assistant",
  "/reports", "/handover", "/members", "/settings", "/saved", "/notes",
  "/profile", "/status", "/areas/1",
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
  domain: new URL(BASE).hostname, path: "/" }]);
const page = await ctx.newPage();

const align = [], buttons = [], chips = [];

for (const route of ROUTES) {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => null);
  if (!res) { console.log(`SKIP ${route}`); continue; }
  await page.waitForTimeout(700);

  const found = await page.evaluate(() => {
    /** 이 요소를 가리키는 짧은 셀렉터. 사람이 찾아갈 수 있어야 한다. */
    const sel = (el) => {
      const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 3);
      return el.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "");
    };
    const px = (v) => Math.round(parseFloat(v) || 0);
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
    };

    // ── 조사 1: 세로 정렬 ───────────────────────────────────────
    const align = [];
    for (const el of document.querySelectorAll("td, th")) {
      if (!vis(el)) continue;
      const va = getComputedStyle(el).verticalAlign;
      if (va !== "middle") align.push({ kind: "표 셀", sel: sel(el), detail: `vertical-align: ${va}` });
    }
    for (const el of document.querySelectorAll("button, .st, .gtag, .areatag, .pg-chip, .prep-tag, .prep-chip")) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      if (cs.display.includes("flex") && cs.alignItems !== "center") {
        align.push({ kind: "버튼·칩", sel: sel(el), detail: `align-items: ${cs.alignItems}` });
      }
    }
    // 글자의 세로 중심이 컨테이너 세로 중심에서 3px 넘게 벗어난 것
    for (const el of document.querySelectorAll("button, .st, .gtag, .areatag, .pg-chip, td, th")) {
      if (!vis(el) || el.children.length > 0) continue;
      const box = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize) || 0;
      if (box.height - fs < 4) continue;             // 여유가 4px 미만이면 볼 것도 없다
      const range = document.createRange();
      range.selectNodeContents(el);
      const tb = range.getBoundingClientRect();
      range.detach?.();
      if (tb.height === 0) continue;
      const off = (tb.top + tb.height / 2) - (box.top + box.height / 2);
      if (Math.abs(off) > 3) {
        align.push({
          kind: "글자 중심", sel: sel(el),
          detail: `컨테이너 ${Math.round(box.height)}px · 글자 중심 오프셋 ${off > 0 ? "+" : ""}${off.toFixed(1)}px`,
        });
      }
    }

    // ── 조사 2: 버튼 규격 ───────────────────────────────────────
    const buttons = [];
    for (const el of document.querySelectorAll('button, [role="button"], a.btn, a.btn-primary')) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      const b = {
        sel: sel(el),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 18),
        bg: cs.backgroundColor, border: cs.borderTopColor,
        bw: px(cs.borderTopWidth), radius: px(cs.borderTopLeftRadius),
        h: Math.round(el.getBoundingClientRect().height), fs: parseFloat(cs.fontSize),
      };
      buttons.push(b);
    }

    // ── 조사 3: 칩 ─────────────────────────────────────────────
    const chips = [];
    const CHIP_SEL = ".st, .gtag, .areatag, .pg-chip, .prep-tag, .prep-chip, .tdp-tag, .gdp-status, " +
      ".gdp-manual, .gout, .pws-chip, .pws-manual, .prop-sug, .utp-n, .gdrop, .prop-st";
    for (const el of document.querySelectorAll(CHIP_SEL)) {
      if (!vis(el)) continue;
      const cs = getComputedStyle(el);
      chips.push({
        sel: sel(el),
        text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 14),
        bg: cs.backgroundColor, color: cs.color,
        radius: px(cs.borderTopLeftRadius), h: Math.round(el.getBoundingClientRect().height),
        fs: parseFloat(cs.fontSize),
      });
    }
    return { align, buttons, chips };
  });

  for (const a of found.align) align.push({ route, ...a });
  for (const b of found.buttons) buttons.push({ route, ...b });
  for (const c of found.chips) chips.push({ route, ...c });
  console.log(`${route.padEnd(22)} 정렬 ${found.align.length} · 버튼 ${found.buttons.length} · 칩 ${found.chips.length}`);
}
await browser.close();

// ── 버튼 규격 판정 ─────────────────────────────────────────────
// ① 코랄 채움 ② 중립 채움(--ink 배경 · 흰 글자) ③ 테두리(투명 + 1px --line) ④ 텍스트
const TRANSPARENT = ["rgba(0, 0, 0, 0)", "transparent"];
const RADIUS_OK = [4, 7, 9];
function classify(b) {
  const filled = !TRANSPARENT.includes(b.bg);
  const bordered = b.bw > 0;
  if (filled && /234, 74, 79/.test(b.bg)) return "① 코랄 채움";
  if (filled && /2[0-9], 2[0-9], 3[0-9]|22, 25, 29/.test(b.bg)) return "② 중립 채움";
  if (!filled && bordered && b.bw === 1) return "③ 테두리";
  if (!filled && !bordered) return "④ 텍스트";
  return "규격 밖";
}
for (const b of buttons) {
  b.kind = classify(b);
  b.badKind = b.kind === "규격 밖";
  b.badRadius = !RADIUS_OK.includes(b.radius);
  b.badHeight = b.h % 4 !== 0;
  const bad = [];
  if (b.badKind) bad.push("네 종류 중 없음");
  if (b.badRadius) bad.push(`라운드 ${b.radius}px`);
  if (b.badHeight) bad.push(`높이 ${b.h}px`);
  b.violation = bad.join(" · ");
}

const md = [];
md.push("# 031 준비 조사 — 읽기 전용\n");
md.push(`생성: scripts/audit-031.mjs · 21경로 · 뷰포트 1440×950\n`);
md.push(`> 이 문서는 **고치지 않고 목록만** 낸 것입니다 (§B 회신 [병행]).\n`);

md.push(`\n## 조사 1 — 세로 정렬 (${align.length}건)\n`);
md.push("| 경로 | 종류 | 셀렉터 | 실측값 |");
md.push("| --- | --- | --- | --- |");
for (const a of align.slice(0, 200)) md.push(`| ${a.route} | ${a.kind} | \`${a.sel}\` | ${a.detail} |`);
if (align.length === 0) md.push("| — | — | — | 없음 |");
if (align.length > 200) md.push(`\n(상위 200건만 표시 · 전체 ${align.length}건은 align.json 참조)`);

const badBtn = buttons.filter((b) => b.violation);
md.push(`\n## 조사 2 — 버튼 (전체 ${buttons.length}개 · 규격 밖 ${badBtn.length}개)\n`);
md.push("### 종류별 분포\n");
md.push("| 종류 | 개수 |");
md.push("| --- | --- |");
for (const k of ["① 코랄 채움", "② 중립 채움", "③ 테두리", "④ 텍스트", "규격 밖"]) {
  md.push(`| ${k} | ${buttons.filter((b) => b.kind === k).length} |`);
}
md.push("\n### 어긋난 축 (한 버튼이 여러 축에 걸릴 수 있다)\n");
md.push("| 축 | 개수 | 기준 |");
md.push("| --- | --- | --- |");
md.push(`| 네 종류 중 없음 | ${buttons.filter((b) => b.badKind).length} | ①코랄채움 ②중립채움 ③테두리 ④텍스트 |`);
md.push(`| 라운드 | ${buttons.filter((b) => b.badRadius).length} | 4 / 7 / 9px 셋뿐 |`);
md.push(`| 높이 | ${buttons.filter((b) => b.badHeight).length} | 4px 배수 |`);
md.push(`| **어느 하나라도** | ${badBtn.length} | / 전체 ${buttons.length} |`);
md.push("\n### 규격 밖 (상세)\n");
md.push("| 경로 | 셀렉터 | 문구 | 배경 | 테두리 | 두께 | 라운드 | 높이 | 글자 | 어긋난 점 |");
md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const b of badBtn.slice(0, 200)) {
  md.push(`| ${b.route} | \`${b.sel}\` | ${b.text || "—"} | ${b.bg} | ${b.border} | ${b.bw}px | ${b.radius}px | ${b.h}px | ${b.fs}px | ${b.violation} |`);
}
if (badBtn.length === 0) md.push("| — | — | — | — | — | — | — | — | — | 없음 |");

// 칩은 **종류**를 센다 — "종류가 몇 개인지가 031 의 출발점" 이다.
const chipKey = (c) => `${c.sel}|${c.bg}|${c.color}|${c.radius}|${c.h}|${c.fs}`;
const chipKinds = new Map();
for (const c of chips) {
  const k = chipKey(c);
  if (!chipKinds.has(k)) chipKinds.set(k, { ...c, n: 0, samples: new Set(), routes: new Set() });
  const e = chipKinds.get(k);
  e.n += 1; if (c.text) e.samples.add(c.text); e.routes.add(c.route);
}
md.push(`\n## 조사 3 — 칩 (전체 ${chips.length}개 · **종류 ${chipKinds.size}가지**)\n`);
md.push("| 셀렉터 | 문구 예 | 배경 | 글자색 | 라운드 | 높이 | 글자 | 등장 | 경로 |");
md.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
for (const c of Array.from(chipKinds.values()).sort((a, b) => b.n - a.n)) {
  md.push(`| \`${c.sel}\` | ${Array.from(c.samples).slice(0, 3).join(" / ") || "—"} | ${c.bg} | ${c.color} | ${c.radius}px | ${c.h}px | ${c.fs}px | ${c.n} | ${Array.from(c.routes).slice(0, 3).join(" ")} |`);
}

fs.writeFileSync(`${OUT}/README.md`, md.join("\n") + "\n");
fs.writeFileSync(`${OUT}/align.json`, JSON.stringify(align, null, 2));
fs.writeFileSync(`${OUT}/buttons.json`, JSON.stringify(buttons, null, 2));
fs.writeFileSync(`${OUT}/chips.json`, JSON.stringify(chips, null, 2));
console.log(`\n세로 정렬 ${align.length}건 · 버튼 ${buttons.length}개(규격 밖 ${badBtn.length}) · 칩 ${chips.length}개(${chipKinds.size}가지)`);
console.log(`→ ${OUT}/README.md`);
