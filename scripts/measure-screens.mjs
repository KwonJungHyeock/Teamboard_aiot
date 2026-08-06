// 화면 실측 (MD-P-2026-024 지시 8) — 보고 규격 3항목을 항상 함께 뽑는다.
//
//   1. document.body.scrollHeight   — 붕괴하면 비정상적으로 커진다
//   2. 폭·높이 상위 3개 요소와 크기 — svg 1108px 같은 값이 바로 드러난다
//   3. 캡처 저장 경로               — **열어서 육안 확인하고 보고서에 명시할 것**
//
// 폰트·라운드(§G)만 재면 레이아웃 붕괴를 못 잡는다. 실제로 놓친 적이 있다.
//
//   BASE=http://127.0.0.1:3000 SESSION=<쿠키> OUT=docs/shots/MD-P-2026-0XX \
//     node scripts/measure-screens.mjs /goals /projects /projects/1
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/measure";
const PATHS = process.argv.slice(2);
if (PATHS.length === 0) {
  console.error("경로를 인자로 넘기세요 — 예: node scripts/measure-screens.mjs /goals /projects");
  process.exit(1);
}
const HOST = new URL(BASE).hostname;

const FONTS_OK = [25, 19, 14, 12.5, 11.5, 10.5];
const RADII_OK = [0, 4, 7, 9];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
if (process.env.SESSION) {
  await ctx.addCookies([{ name: "tb_session", value: process.env.SESSION, domain: HOST, path: "/" }]);
}
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const rows = [];
for (const path of PATHS) {
  const res = await page.goto(BASE + path, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForTimeout(1200);

  const m = await page.evaluate(({ FONTS_OK, RADII_OK }) => {
    const px = (v) => Math.round(parseFloat(v) * 100) / 100;
    const near = (v, list) => list.some((x) => Math.abs(v - x) < 0.26);

    // ① 문서 높이
    const scrollHeight = document.body.scrollHeight;

    // ② 최대 요소 3개 — 본문 안의 "내용물"만 본다.
    // 사이드바·배경 레이어(bgfx/grain/app)·본문 컨테이너 자체는 항상 화면만 하므로 뺀다.
    // 남는 것 중 비정상적으로 큰 값이 곧 붕괴 신호다(예: svg.cv 1108px).
    const root = document.querySelector(".pg-body") || document.querySelector(".hv") || document.querySelector("main");
    const SKIP = /^(app|bgfx|grain|pg|pg-body|pg-head|wrap|hv|main|side|sidebar)( |$)/;
    const cand = [];
    for (const el of (root ? root.querySelectorAll("*") : [])) {
      const cls = String(el.className?.baseVal ?? el.className ?? "");
      if (SKIP.test(cls)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) continue;
      cand.push({ k: `${el.tagName.toLowerCase()}${cls ? "." + cls.split(" ")[0] : ""}`.slice(0, 26),
                  w: Math.round(r.width), h: Math.round(r.height) });
    }
    cand.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
    const biggest = cand.slice(0, 3);

    // §G — 폰트·라운드 (원형은 위반이 아니다)
    let badFont = 0, badRadius = 0;
    for (const el of (root ? root.querySelectorAll("*") : [])) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const c = getComputedStyle(el);
      if (c.display === "none" || c.visibility === "hidden") continue;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
        if (!near(px(c.fontSize), FONTS_OK)) badFont++;
      }
      const rad = px(c.borderTopLeftRadius);
      const circle = c.borderTopLeftRadius.includes("%") || rad >= Math.min(r.width, r.height) / 2 - 0.5;
      if (rad > 0 && !circle && !near(rad, RADII_OK) && rad < 500) badRadius++;
    }
    return { scrollHeight, biggest, badFont, badRadius };
  }, { FONTS_OK, RADII_OK });

  const file = `${OUT}/${path.replace(/^\//, "").replace(/\//g, "-") || "home"}.png`;
  await page.screenshot({ path: file });
  rows.push({ path, status: res?.status() ?? 0, ...m, file });
}

console.log("\n| 경로 | 상태 | scrollHeight | 최대 요소 3개 (w×h) | §G 폰트 | §G 라운드 | 캡처 |");
console.log("| --- | --- | --- | --- | --- | --- | --- |");
for (const r of rows) {
  const big = r.biggest.map((b) => `\`${b.k}\` ${b.w}×${b.h}`).join("<br>");
  console.log(`| ${r.path} | ${r.status} | ${r.scrollHeight}px | ${big} | ${r.badFont} | ${r.badRadius} | ${r.file} |`);
}
console.log(`\npage errors: ${pageErrors.length ? pageErrors.join(" / ") : "none"}`);
console.log("\n⚠️ 육안 확인은 자동화되지 않는다. 위 캡처를 실제로 열어보고,");
console.log("   보고서에 '육안 확인함' 또는 '확인 안 함'을 반드시 명시할 것.");
await browser.close();
