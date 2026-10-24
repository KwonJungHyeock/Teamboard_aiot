// 알림함(위 막대의 종 · 2026-10) — 쌓인 알림이 보이고, 누르면 그 업무로 가고, 읽음이 된다.
//
//   node scripts/bell-walk.mjs            재기만 한다
//   SHOT=1 node scripts/bell-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 남이 업무를 넘기면 받는 사람 종에 숫자가 선다(사람 알림만 센다)
//   ② 열면 「배정」과 그 업무 이름 · 누르면 그 업무 상세로 가고 읽음이 된다(DB)
//   ③ 「모두 읽음」이면 숫자가 사라진다
//   ④ 390px — 위 바의 종 · 판이 화면 안에 든다 · 콘솔 오류 0
//
// **로컬 전용.** 「[검사]」 업무 · 그 알림을 지우고, 받는 사람의 원래 안 읽은 알림은 안 읽음으로 되돌린다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("bell-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/bell";
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
let browser, unreadBefore = [], member;
try {
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  member = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead || !member) throw new Error("팀장 하나 · 팀원 하나가 필요하다");
  unreadBefore = (await sql(`SELECT id FROM notification WHERE user_id = $1 AND read = false`, [member.id])).map((r) => r.id);
  const ck = (u) => tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" });
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: `tb_session=${ck(u)}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  // ① 조건 — 팀장이 제 업무를 만들어 팀원에게 넘긴다(넘길 때 알림이 생긴다)
  const before = (await api(member, "GET", "/api/notifications")).data?.unread ?? 0;
  const t = await api(lead, "POST", "/api/tasks", { title: `${MARK} 종 검사 업무` });
  await api(lead, "PATCH", `/api/tasks/${t.data?.id}`, { assigneeId: member.id });

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: ck(member) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const ty = m.type(); if (ty === "error" || ty === "warning") errs.push(`[${ty}] ${m.text().slice(0, 160)}`); });
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });

  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const bell = page.locator(".v3-top .v3-bell");
  await bell.locator(".v3-bell-n").waitFor({ timeout: 9000 }).catch(() => {});
  const badge = Number((await bell.locator(".v3-bell-n").innerText().catch(() => "0")).replace("+", ""));
  chk("①-숫자가-선다", badge === before + 1 || (before >= 99 && badge >= 99), `넘기기 전 ${before} → 종 ${badge}`);

  // ② 열고 누르기
  await bell.locator(".v3-bell-b").click();
  const item = bell.locator(".v3-bell-i", { hasText: "종 검사 업무" }).first();
  await item.waitFor({ timeout: 9000 });
  const itemText = await item.innerText();
  await shot(page, { path: `${OUT}/N1-알림함.png` });
  await item.click();
  await page.waitForURL(new RegExp(`/v3/tasks/${t.data?.id}$`), { timeout: 9000 }).catch(() => {});
  const read = (await sql(`SELECT read FROM notification WHERE user_id = $1 AND ref_type = 'task' AND ref_id = $2 ORDER BY id DESC LIMIT 1`, [member.id, t.data?.id]))[0]?.read;
  chk("②-누르면-그-업무로·읽음", itemText.includes("배정") && new URL(page.url()).pathname === `/v3/tasks/${t.data?.id}` && read === true,
      `항목 "${itemText.replace(/\s+/g, " ").slice(0, 50)}" · 간 곳 ${new URL(page.url()).pathname} · 읽음 ${read}`);

  // ③ 모두 읽음
  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const has = await bell.locator(".v3-bell-n, .v3-bell-dot").count();
  if (has) {
    await bell.locator(".v3-bell-b").click();
    await bell.getByRole("button", { name: "모두 읽음" }).click();
    await page.waitForTimeout(1200);
  }
  const left = await bell.locator(".v3-bell-n, .v3-bell-dot").count();
  chk("③-모두-읽음", left === 0, `남은 숫자 · 점 ${left}개`);

  // ④ 좁은 화면
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const top = page.locator(".v3-topbar .v3-bell-b");
  const visible = await top.isVisible();
  await top.click();
  await page.waitForTimeout(400);
  const box = await page.locator(".v3-topbar .v3-bell-p").boundingBox();
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, { path: `${OUT}/N2-좁은화면.png` });
  chk("④-390px·콘솔", visible && box && box.x >= 0 && box.x + box.width <= 390 && over <= 0 && errs.length === 0,
      `위 바 종 ${visible} · 판 ${box ? `${Math.round(box.x)}~${Math.round(box.x + box.width)}` : "없음"} · 넘침 ${over} · 콘솔 ${errs.length}${errs[0] ? ` — ${errs[0]}` : ""}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  await sql(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM task WHERE title LIKE $1 || '%'`, [MARK]).catch(() => {});
  if (unreadBefore.length) await sql(`UPDATE notification SET read = false WHERE id = ANY($1)`, [unreadBefore]).catch(() => {});
  await pool.end();
  console.log(`\n되돌림 — 받는 사람의 원래 안 읽은 알림 ${unreadBefore.length}개를 안 읽음으로`);
  console.log(`합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
