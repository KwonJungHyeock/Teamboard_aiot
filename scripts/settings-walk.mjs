// 설정(2026-10) — 팀장이 화면에서 가오픈 · 진척 편집자 · Notion 을 바꾸고, 바꾼 값이 제자리에 간다.
//
//   node scripts/settings-walk.mjs            재기만 한다
//   SHOT=1 node scripts/settings-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 팀장 — 계정 블록에 「설정」 · 화면이 열린다 / 팀원 — 링크가 없다(막힘은 denied-walk ③짝)
//   ② 가오픈 날짜를 바꾸면 API 와 관제 D-day 가 따라 바뀐다
//   ③ 진척 편집자를 정하고 비울 수 있다
//   ④ Notion — 연결 확인이 말을 돌려준다 · 엉뚱한 상위 페이지는 막는다
//   ⑤ 390px · 콘솔 오류 0
//
// **로컬 전용.** 손댄 config 행(가오픈 · 진척 편집자 · Notion 상위 페이지 · 상태)은 시작 전 값으로 되돌린다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("settings-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/settings";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEYS = ["platform_open_at", "progress_editor_actor_id", "notion_resource_parent", "notion_status"];
let browser, saved = [];
try {
  saved = await sql(`SELECT key, value, updated_by FROM config WHERE key = ANY($1)`, [KEYS]);
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead || !member) throw new Error("팀장 하나 · 팀원 하나가 필요하다");
  const ck = (u) => tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" });
  const api = async (u, path) => { const r = await fetch(`${BASE}${path}`, { headers: { cookie: `tb_session=${ck(u)}` } }); return r.json().catch(() => null); };

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const open = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: ck(u) }]);
    const page = await ctx.newPage();
    page.errs = [];
    page.on("pageerror", (e) => page.errs.push(e.message));
    page.on("console", (m) => { const t = m.type(); if (t === "error" || t === "warning") page.errs.push(`[${t}] ${m.text().slice(0, 160)}`); });
    return page;
  };
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });

  // ── ① ─────────────────────────────────────────────────────────
  const mp = await open(member);
  await mp.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const memberLink = await mp.locator(".v3-acct-a a", { hasText: "설정" }).count();
  const page = await open(lead);
  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  await page.locator(".v3-acct-a a", { hasText: "설정" }).click();
  await page.waitForURL(/\/v3\/settings$/, { timeout: 9000 });
  await page.locator("h1", { hasText: "설정" }).waitFor({ timeout: 9000 });
  await page.locator('input[type="date"]').waitFor({ timeout: 9000 });
  chk("①-팀장에게만-설정", memberLink === 0 && page.url().endsWith("/v3/settings"), `팀원 링크 ${memberLink} · 팀장 → ${new URL(page.url()).pathname}`);

  // ── ② ─────────────────────────────────────────────────────────
  const before = (await api(lead, "/api/settings/platform")).open.openAt;
  const target = "2026-12-01";
  await page.locator('input[type="date"]').fill(target);
  await page.locator(".v3-card", { hasText: "가오픈 날짜" }).getByRole("button", { name: "저장" }).click();
  await page.waitForTimeout(1200);
  const after = (await api(lead, "/api/settings/platform")).open.openAt;
  const cp = await open(lead);
  await cp.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const dday = await cp.locator(".v3-ctl-dday").innerText().catch(() => "");
  chk("②-가오픈이-따라-바뀐다", after.startsWith(target) && dday.includes("12.01"), `${before.slice(0, 10)} → ${after.slice(0, 10)} · 관제 "${dday.replace(/\s+/g, " ")}"`);

  // ── ③ ─────────────────────────────────────────────────────────
  const sel = page.locator(".v3-card", { hasText: "진척 편집자" }).locator("select");
  await sel.selectOption(String(member.id));
  await page.locator(".v3-card", { hasText: "진척 편집자" }).getByRole("button", { name: "저장" }).click();
  await page.waitForTimeout(1000);
  const ed1 = (await api(lead, "/api/settings/platform")).editor;
  await sel.selectOption("");
  await page.locator(".v3-card", { hasText: "진척 편집자" }).getByRole("button", { name: "저장" }).click();
  await page.waitForTimeout(1000);
  const ed2 = (await api(lead, "/api/settings/platform")).editor;
  chk("③-진척-편집자", ed1?.id === member.id && ed2 === null, `정함 ${ed1?.name} → 비움 ${ed2 === null}`);

  // ── ④ ─────────────────────────────────────────────────────────
  const nc = page.locator(".v3-card", { hasText: "Notion 연결" });
  await nc.getByRole("button", { name: "연결 확인" }).click();
  await page.waitForTimeout(2500);
  const said = await nc.innerText();
  await page.locator("#v3-set-parent").fill("이건 주소가 아니다");
  await nc.locator(".v3-set-row", { has: page.locator("#v3-set-parent") }).getByRole("button", { name: "저장" }).click();
  await page.waitForTimeout(800);
  const bad = await nc.innerText();
  await shot(page, { path: `${OUT}/S1-설정.png`, fullPage: true });
  chk("④-Notion", /연결되었습니다|Integration|토큰|실패|오류|권한/.test(said) && bad.includes("32자리"),
      `연결 확인 말 ${/연결되었습니다/.test(said) ? "연결됨" : "토큰 없음/실패 안내"} · 엉뚱한 상위 페이지 ${bad.includes("32자리") ? "막음" : "**안 막음**"}`);

  // ── ⑤ ─────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, { path: `${OUT}/S2-좁은화면.png`, fullPage: true });
  // ④ 에서 일부러 넣은 엉뚱한 주소가 낸 400 한 줄은 뺀다 — 막은 것이 맞다
  const errs = [...page.errs, ...mp.errs, ...cp.errs].filter((e) => !/status of 400/.test(e));
  chk("⑤-390px·콘솔", over <= 0 && errs.length === 0, `넘침 ${over}px · 콘솔 ${errs.length}${errs.length ? ` — ${errs[0]}` : ""}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  await sql(`DELETE FROM config WHERE key = ANY($1)`, [KEYS]).catch(() => {});
  for (const s of saved) await sql(`INSERT INTO config (key, value, updated_by) VALUES ($1, $2, $3)`, [s.key, s.value, s.updated_by]).catch(() => {});
  await sql(`DELETE FROM activity_log WHERE message LIKE '%플랫폼 설정 변경%' AND created_at > now() - interval '10 minutes'`).catch(() => {});
  await pool.end();
  console.log(`\n되돌림 — config ${saved.length}행을 시작 전 값으로`);
  console.log(`합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
