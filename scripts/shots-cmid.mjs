// MD-P-2026-031 §C 회신 8 · 4-1 — 중간 병합 전 캡처 4장.
//
// **읽기만 한다.** 데이터를 만들지도 바꾸지도 않는다.
//
// 규격: 1440×950 · 배율 100% · deviceScaleFactor 1.
// 첫 실행 안내가 떠 있으면 캡처를 덮으므로 먼저 닫는다 —
// **덮인 것은 캡처에서도 덮인다.**
//
//   AUTH_SECRET=... node scripts/shots-cmid.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-031/C-mid";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 950 },
  deviceScaleFactor: 1,
});
await ctx.addCookies([{
  name: "tb_session",
  value: tok({ id: 1, actorId: 1, name: "권정혁", role: "lead", email: "l@l" }),
  domain: new URL(BASE).hostname, path: "/",
}]);
const page = await ctx.newPage();

const errs = [];
page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 120)); });
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "";
  if (!/ABORTED/i.test(why)) errs.push(`요청 실패 ${r.url().slice(-50)} (${why})`);
});

const SHOTS = [
  { name: "1-홈", path: "/", wait: ".judge" },
  { name: "2-업무목록", path: "/tasks", wait: 'select[aria-label="정렬 기준"]' },
  { name: "3-목표", path: "/goals", wait: ".pg-body" },
  { name: "4-프로젝트상세", path: "/projects/1", wait: ".pg-body" },
];

for (const s of SHOTS) {
  await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(s.wait, { timeout: 20000 });
  // 첫 실행 안내가 떠 있으면 닫는다. 캡처는 일상 화면을 담아야 한다.
  if (await page.$(".frn[role=dialog]")) {
    await page.click(".frn .frn-skip");
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1800);
  const file = `${OUT}/${s.name}.png`;
  await page.screenshot({ path: file });
  const h = await page.evaluate(() => document.documentElement.scrollHeight);
  const zoom = await page.evaluate(() => Math.round(window.devicePixelRatio * 100));
  console.log(`  ${s.name.padEnd(14)} ${s.path.padEnd(14)} 문서높이 ${String(h).padStart(5)}px · 배율 ${zoom}% · ${file}`);
}

console.log(`\n콘솔 오류 ${errs.length}건${errs.length ? " — " + errs.slice(0, 3).join(" / ") : ""}`);
await browser.close();
process.exit(errs.length ? 1 : 0);
