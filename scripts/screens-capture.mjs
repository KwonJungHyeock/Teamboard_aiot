// 전 화면 캡처 — 정련 검수용 (2026-10). 넓은 화면(1440) · 폰(390) 두 벌을 한 번에 찍는다.
//
//   OUT=폴더 node scripts/screens-capture.mjs
//
// **로컬 전용 · 읽기만** — 화면을 열고 찍기만 한다. 회의실 화면을 찍으려고 「[검사]」 회의 하나를
// 열었다가 끝에 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("screens-capture.mjs");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/all";
const S = process.env.AUTH_SECRET;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };
mkdirSync(OUT, { recursive: true });

const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
    WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
const ck = tok({ id: lead.id, actorId: lead.id, name: lead.nm, role: lead.role, adminGrant: lead.admin_grant, email: "x@x" });
const task = (await sql(`SELECT id FROM task WHERE is_active AND visibility = 'team' AND description <> '' ORDER BY id DESC LIMIT 1`))[0]?.id;
const goal = (await sql(`SELECT id FROM goal WHERE is_active ORDER BY id LIMIT 1`))[0]?.id;
const mt = await fetch(`${BASE}/api/meetings`, { method: "POST", headers: { cookie: `tb_session=${ck}`, "content-type": "application/json" },
  body: JSON.stringify({ title: "[검사] 주간 가오픈 점검" }) }).then((r) => r.json());
for (const [kind, b] of [["agenda", "업로드 한도 정하기"], ["agenda", "가오픈 체크리스트"], ["decision", "가오픈 업로드 한도는 100MB"], ["action", "덱 나눠 올리기 반영"], ["link", "https://example.com/deck-builder"]])
  await fetch(`${BASE}/api/meetings/${mt.id}`, { method: "POST", headers: { cookie: `tb_session=${ck}`, "content-type": "application/json" },
    body: JSON.stringify({ kind, body: b }) });

const SCREENS = [
  ["01-관제", "/v3/control"], ["02-대시보드", "/v3"], ["03-업무목록", "/v3/tasks"], ["04-업무상세", `/v3/tasks/${task}`],
  ["05-새업무", "/v3/new"], ["06-목표", "/v3/goals"], ["07-목표상세", `/v3/goals/${goal}`], ["08-집계", "/v3/stats"],
  ["09-팀", "/v3/team"], ["10-구성원", "/v3/members"], ["11-내정보", "/v3/me"], ["12-내기록", "/v3/log"],
  ["13-회의실", "/v3/room"], ["14-회의", `/v3/room/${mt.id}`], ["15-설정", "/v3/settings"], ["16-캘린더", "/v3/calendar"],
  ["17-캘린더주", "/v3/calendar?v=week"], ["18-월간보고", "/v3/report"], ["19-막음", "/v3/not-yet?k=reports"],
];
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox", "--no-proxy-server"] });
const errs = [];
for (const [w, h] of [[1440, 950], [390, 844]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([{ name: "tb_session", value: ck, domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") errs.push(`${w} ${page.url()} ${m.text().slice(0, 120)}`); });
  for (const [name, path] of SCREENS) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(900);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (over > 0) errs.push(`${w} ${path} 가로 넘침 ${over}px`);
    await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: true });
  }
  if (w === 1440) {
    await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
    await page.locator(".v3-top .v3-bell-b").click().catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/20-알림함-${w}.png` });
  }
  await ctx.close();
}
await browser.close();
await sql(`DELETE FROM meeting WHERE id = $1`, [mt.id]);
await pool.end();
console.log(errs.length ? errs.join("\n") : "콘솔 오류 · 가로 넘침 0");
