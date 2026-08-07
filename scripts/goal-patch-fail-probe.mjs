// 목표 연결 PATCH 실패 시 무슨 일이 벌어지는지 실측 (MD-P-2026-027 §C·§D 회신 [확인]).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 등록 모달은 업무를 POST 로 만든 뒤 목표를 PATCH 로 붙인다.
// POST 는 됐는데 PATCH 가 실패하면 "목표 없는 업무"가 남는다.
// 그 상황을 실제로 만들어(라우트 가로채기) 화면이 무엇을 말하는지 읽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("goal-patch-fail-probe.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-027/task-create";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const MARK = "[실측]";
fs.mkdirSync(OUT, { recursive: true });
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();

  // 업무 PATCH 만 500 으로 떨어뜨린다. POST 는 그대로 통과시킨다.
  await page.route("**/api/tasks/*", (route) =>
    route.request().method() === "PATCH"
      ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "테스트용 500" }) })
      : route.continue());

  await page.goto(`${BASE}/tasks?panel=task:new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);

  const title = `${MARK} 목표 PATCH 실패 확인`;
  await page.locator(".ntm-title").fill(title);
  // 목표 하나 체크
  await page.locator('.ntm-side .prop-row:has(.prop-l:text-is("목표")) .prop-v').click();
  await page.waitForTimeout(400);
  const goalBoxes = page.locator(".prop-goals input[type=checkbox]");
  const nGoals = await goalBoxes.count();
  if (nGoals === 0) { console.log("연결 가능한 월 목표가 없어 확인 불가"); process.exit(0); }
  await goalBoxes.first().check();
  await page.waitForTimeout(300);

  await page.keyboard.press("Meta+Enter");
  await page.waitForTimeout(2200);

  const modalOpen = await page.locator(".ntm").count();
  const shown = await page.locator(".ntm-err").innerText().catch(() => "(오류 표시 없음)");
  const toastTxt = await page.locator(".toast, [class*=toast]").first().innerText().catch(() => "(토스트 없음)");
  const row = await sql(`SELECT id FROM task WHERE title=$1 AND is_active`, [title]);
  const links = row[0] ? await sql(`SELECT goal_id FROM goal_task WHERE task_id=$1`, [row[0].id]) : [];
  await page.screenshot({ path: `${OUT}/probe-goal-patch-fail.png` });

  console.log(`업무 생성        task ${row.length}건 (POST 는 성공)`);
  console.log(`목표 연결        goal_task ${links.length}건 (PATCH 가 500 이므로 0이어야 한다)`);
  console.log(`모달             ${modalOpen === 1 ? "열린 채로 남음" : "닫힘"}`);
  console.log(`화면 문구        "${shown.replace(/\n+/g, " ")}"`);
  console.log(`토스트           "${toastTxt.replace(/\n+/g, " ")}"`);
} finally {
  const t = await sql(`SELECT id FROM task WHERE title LIKE $1`, [`${MARK}%`]);
  if (t.length) {
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [t.map((x) => x.id)]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [t.map((x) => x.id)]);
    await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [t.map((x) => x.id)]);
  }
  console.log(`정리 — 업무 ${t.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
