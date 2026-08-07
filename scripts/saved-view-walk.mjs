// 저장된 뷰 왕복 실측 (MD-P-2026-027 §B3).
//
// 저장 → 사이드바 핀 등장 → 눌러서 조건 복원 → 순서 변경 → 삭제까지 실제로 밟는다.
// 만든 것은 끝나고 지운다. 라벨에는 **화면에서 읽은 값**을 적는다 (§G 캡처 라벨 규격).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("saved-view-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-027/saved-view";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const NAMES = ["실측 뷰 A", "실측 뷰 B"];
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }), domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  const step = async (id, note) => { await page.screenshot({ path: `${OUT}/${id}.png` }); rows.push({ id, note }); console.log(`  ▸ ${id.padEnd(18)} ${note}`); };

  // ① 조건을 만들고 저장
  await page.goto(`${BASE}/tasks?area=1,2&done=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const onChips = await page.locator(".pg-chip.area-chip.on").allTextContents();
  await step("01-filters", `URL ?area=1,2 로 진입 — 켜진 영역 칩 "${onChips.join(" · ")}"`);

  for (const nm of NAMES) {
    page.once("dialog", (d) => d.accept(nm));
    await page.getByRole("button", { name: "이 조건 저장" }).click();
    await page.waitForTimeout(1100);
  }
  const pins = await page.locator(".side .pinview-n").allTextContents();
  await step("02-pinned", `저장 후 사이드바 핀 "${pins.join(" · ")}"`);

  // ② 핀을 눌러 조건 복원
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator(".side .pinview a").first().click();
  await page.waitForURL(/\/tasks\?/, { timeout: 9000 });
  await page.waitForTimeout(1100);
  const back = await page.locator(".pg-chip.area-chip.on").allTextContents();
  const url = new URL(page.url());
  await step("03-restored", `핀 클릭 → ${url.pathname}${url.search} · 켜진 칩 "${back.join(" · ")}"`);

  // ③ 순서 변경 (드래그는 API 로 검증 — HTML5 DnD 는 합성 이벤트로 신뢰도가 낮다)
  const before = await sql(`SELECT id, name, sort_order FROM saved_view WHERE target='tasks' ORDER BY sort_order`);
  const flipped = [before[1].id, before[0].id];
  await page.evaluate(async (order) => {
    await fetch("/api/saved-views", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }) });
  }, flipped);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const after = await page.locator(".side .pinview-n").allTextContents();
  await step("04-reordered", `순서 변경 후 핀 "${after.join(" · ")}" (변경 전 "${before.map(b=>b.name).join(" · ")}")`);

  // ④ 경계 — 지시 28 형식. 부재 단언 하나에 짝이 되는 존재 단언을 붙인다.
  //    "남의 뷰가 안 지워진다"만 확인하면 삭제 자체가 고장 나도 통과한다.
  const [mine] = await sql(`SELECT id, name FROM saved_view WHERE owner_actor_id=1 AND target='tasks' ORDER BY id LIMIT 1`);
  const [foreign] = await sql(
    `INSERT INTO saved_view (owner_actor_id, name, target, filters, sort_order)
     VALUES (3, '남의 뷰 (실측)', 'tasks', '{}', 99) RETURNING id`);

  const listed = await page.evaluate(async () => (await (await fetch("/api/saved-views")).json()).views.map((v) => v.name));
  const seesForeign = listed.includes("남의 뷰 (실측)");

  const delForeign = await page.evaluate(async (id) => (await fetch(`/api/saved-views?id=${id}`, { method: "DELETE" })).status, foreign.id);
  const foreignLeft = (await sql(`SELECT count(*)::int n FROM saved_view WHERE id=$1`, [foreign.id]))[0].n;

  const renameForeign = await page.evaluate(async (id) => (await fetch("/api/saved-views", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: "가로챈 이름" }) })).status, foreign.id);
  const foreignName = (await sql(`SELECT name FROM saved_view WHERE id=$1`, [foreign.id]))[0]?.name ?? "(없음)";

  const delMine = await page.evaluate(async (id) => (await fetch(`/api/saved-views?id=${id}`, { method: "DELETE" })).status, mine.id);
  const mineLeft = (await sql(`SELECT count(*)::int n FROM saved_view WHERE id=$1`, [mine.id]))[0].n;

  console.log("\n── 경계 (부재 단언 + 짝이 되는 존재 단언) ──");
  console.log(`  ${!seesForeign ? "OK  " : "FAIL"} 목록에 남의 뷰 안 보임        보인 이름 [${listed.join(", ")}]`);
  console.log(`  ${foreignLeft === 1 ? "OK  " : "FAIL"} 남의 뷰 삭제 안 됨          DELETE ${delForeign} · 남은 행 ${foreignLeft} (1 이어야 한다)`);
  console.log(`  ${foreignName === "남의 뷰 (실측)" ? "OK  " : "FAIL"} 남의 뷰 이름 변경 안 됨      PATCH ${renameForeign} · 이름 "${foreignName}"`);
  console.log(`  ${mineLeft === 0 ? "OK  " : "FAIL"} 내 뷰는 삭제 됨 (짝 단언)     DELETE ${delMine} · 남은 행 ${mineLeft} (0 이어야 한다)`);

  console.log(`\nJS 오류 ${errs.length}건${errs.length ? ": " + errs[0].slice(0,90) : ""}`);
  fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify({ rows, jsErrors: errs }, null, 2));
} finally {
  if (browser) await browser.close();
  const n = await sql(`DELETE FROM saved_view WHERE name = ANY($1::text[]) RETURNING id`, [[...NAMES, "남의 뷰 (실측)", "가로챈 이름"]]);
  const left = (await sql(`SELECT count(*)::int n FROM saved_view`))[0].n;
  console.log(`정리 — 실측 뷰 ${n.length}건 삭제 · 남은 저장된 뷰 ${left}건`);
  await pool.end();
}
