// 캘린더 열기(2026-10) — 레일에서 열리고, 주 보기는 접지 않고 다 세우고, 「내 것만」이 거른다.
//
//   node scripts/calendar-walk.mjs            재기만 한다
//   SHOT=1 node scripts/calendar-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 레일의 「캘린더」 → /v3/calendar (막음 화면이 아니다) · 옛 /calendar 도 여기로
//   ② 주 보기 — 한 날에 다섯 건을 세워도 **다섯 다** 보인다(달 보기는 셋 + ＋2) · 주소에 v=week
//   ③ 지난주 · 다음주 · 이번 주 — 주소의 w 가 일요일로 움직인다
//   ④ 「내 것만」 — 남이 담당인 건 빠진다 · 주소에 mine=1
//   ⑤ 390px — 주 보기가 위아래로 흐른다 · 넘침 0 · 콘솔 오류 0
//
// **로컬 전용.** 「[검사]」 업무만 만들고 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("calendar-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/calendar";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const MARK = "[검사]";
let browser;
try {
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  const ck = (u) => tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" });
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: `tb_session=${ck(u)}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  // 조건 — 다음 주 수요일에 다섯 건(내 것 셋 · 남의 것 둘)
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  const t0 = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  const sun = new Date(t0 - new Date(t0).getUTCDay() * 86400000);
  const nextSun = new Date(sun.getTime() + 7 * 86400000).toISOString().slice(0, 10);
  const wed = new Date(sun.getTime() + 10 * 86400000).toISOString().slice(0, 10);
  for (let i = 1; i <= 5; i += 1)
    await api(lead, "POST", "/api/tasks", { title: `${MARK} 주 보기 ${i}`, dueDate: wed, assigneeId: i <= 3 ? lead.id : member.id });

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: ck(lead) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const ty = m.type(); if (ty === "error" || ty === "warning") errs.push(`[${ty}] ${m.text().slice(0, 160)}`); });
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });

  // ① 레일 · 옛 주소
  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  await page.locator(".v3-rail a", { hasText: "캘린더" }).first().click();
  await page.waitForURL(/\/v3\/calendar/, { timeout: 9000 });
  await page.locator(".v3-calbar").waitFor({ timeout: 9000 });
  const p1 = new URL(page.url()).pathname;
  await page.goto(`${BASE}/calendar`, { waitUntil: "networkidle" });
  const p2 = new URL(page.url()).pathname;
  chk("①-레일에서-열린다", p1 === "/v3/calendar" && p2 === "/v3/calendar", `레일 → ${p1} · 옛 /calendar → ${p2}`);

  // ② 주 보기 — 접지 않는다 / 달 보기는 접는다
  await page.goto(`${BASE}/v3/calendar?m=${wed.slice(0, 7)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const monthCell = page.locator(".v3-cal-d", { has: page.locator(".v3-cal-dn", { hasText: new RegExp(`^${Number(wed.slice(8))}$`) }) })
    .filter({ hasNot: page.locator(".out") }).first();
  const monthPills = await page.locator(".v3-cal-d:not(.out)").filter({ hasText: "주 보기" }).locator("a.v3-pill", { hasText: "주 보기" }).count();
  await page.getByRole("tab", { name: "주" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "다음주 ▸" }).click();
  await page.waitForTimeout(900);
  const u2 = new URL(page.url());
  const wedCol = page.locator(".v3-calwk-d").nth(3);
  const weekPills = await wedCol.locator("a.v3-pill", { hasText: "주 보기" }).count();
  await shot(page, { path: `${OUT}/C1-주보기.png`, fullPage: true });
  chk("②-주-보기는-다-세운다", weekPills === 5 && monthPills <= 3 && u2.searchParams.get("v") === "week",
      `주 보기 수요일 ${weekPills}건 · 달 보기 칸 ${monthPills}건(+더보기) · v=${u2.searchParams.get("v")}`);
  void monthCell;

  // ③ 이동
  const w1 = u2.searchParams.get("w");
  await page.getByRole("button", { name: "이번 주" }).click();
  await page.waitForTimeout(500);
  const w2 = new URL(page.url()).searchParams.get("w");
  chk("③-주-이동", w1 === nextSun && w2 === null, `다음주 w=${w1}(일요일 ${nextSun}) · 이번 주 w=${w2 ?? "없음(기본)"}`);

  // ④ 내 것만
  await page.goto(`${BASE}/v3/calendar?v=week&w=${nextSun}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "내 것만" }).click();
  await page.waitForTimeout(600);
  const mineN = await page.locator(".v3-calwk-d").nth(3).locator("a.v3-pill", { hasText: "주 보기" }).count();
  const mineQ = new URL(page.url()).searchParams.get("mine");
  chk("④-내-것만", mineN === 3 && mineQ === "1", `내 것 ${mineN}건(3 이어야) · mine=${mineQ}`);

  // ⑤ 좁은 화면
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(600);
  const list = await page.locator(".v3-daylist .v3-calwk-d").count();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, { path: `${OUT}/C2-좁은화면.png`, fullPage: true });
  chk("⑤-390px·콘솔", list === 7 && over <= 0 && errs.length === 0, `이레 목록 ${list} · 넘침 ${over} · 콘솔 ${errs.length}${errs[0] ? ` — ${errs[0]}` : ""}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  await sql(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM task WHERE title LIKE $1 || '%'`, [MARK]).catch(() => {});
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
