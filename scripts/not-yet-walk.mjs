// 막음 화면 실측 (MD-P-2026-066 §B).
//
//   node scripts/not-yet-walk.mjs
//
// 지시서가 시킨 것 중 **이번에 할 수 있는 것**만 잰다:
//   §B-5   404 가 아니다 — 「없는 것」과 「아직 안 여는 것」은 다른 말이다
//   §B-6   문구 셋 — 무엇인지 / 언제(11월 2일 뒤) / **돌아갈 길 하나**
//   §B-8   자물쇠 표시가 레일에 **남아 있다** (지우지 않는다)
//   §B-9   **주소로 직접 들어와도** 막힌다 (레일에서 빼는 것만으로는 안 막힌다)
//   §B-11  레일이 `/profile`·`/settings` 를 옛 화면으로 안 내보낸다
//   §B-14  막음 화면의 돌아갈 길이 **눌린다**
//
// **§B-12·§B-13 은 못 쟀다.** 「필수 화면은 열리고 나머지는 전부 막음 화면」의
// **필수 목록**(지시서 §1 의 아홉)이 이번 전달에서 잘려 왔다. 짐작해서 목록을
// 만들면 있어야 할 화면을 조용히 막는다 — 그건 이 검사기가 잡을 수 없는 종류의
// 잘못이다. 목록이 오면 여기에 두 줄이 는다.
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";
import { testUser } from "./test-user.mjs";

requireLocalDb("not-yet-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HOST = new URL(BASE).hostname;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TMP = "/tmp/not-yet-walk";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const ME = await testUser("admin");
const MEMBER = await testUser("member");

let browser, swBefore = null;
try {
  /*
   * 막는 목록을 **제품에게 묻는다.** 검사기가 목록을 손으로 적으면, 067 에서
   * 줄을 지웠을 때 검사기만 옛 목록을 들고 초록으로 남는다(§G 048).
   */
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "not-yet.ts"), path.join(REPO, "lib", "v3", "routes.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { NOT_YET, NOT_YET_WHEN, NOT_YET_BACK, notYetHref } = req(path.join(TMP, "v3", "not-yet.js"));

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  chk("0조건-막는-목록이-비어-있지-않다", NOT_YET.length > 0,
      `${NOT_YET.map((s) => `${s.label}(${s.old})`).join(" · ")} — 0이면 아래는 전부 아무것도 안 잰 값이다`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await ctx.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(ME) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    if (!ignoredWhy(line)) errs.push(line); });

  // ── ① 주소로 직접 들어와도 막힌다 (§B-9) · 404 가 아니다 (§B-5) ─
  for (const s of NOT_YET) {
    const res = await page.goto(`${BASE}${s.old}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const url = new URL(page.url());
    const body = await page.locator("body").innerText();
    chk(`①-${s.key}-주소로-와도-막힌다`,
        res.status() === 200 && url.pathname === "/v3/not-yet" && url.searchParams.get("k") === s.key,
        `${s.old} → ${res.status()} ${url.pathname}?${url.searchParams.toString()}` +
        ` (404 가 아니다 · 옛 화면도 아니다)`);
    // ── ② 문구 셋 (§B-6) ────────────────────────────────────────
    const backLink = page.locator(`a[href="${NOT_YET_BACK.href}"]`).first();
    const hasBack = await backLink.count() > 0;
    chk(`②-${s.key}-문구-셋`,
        body.includes(s.label) && body.includes(s.what) && body.includes(NOT_YET_WHEN) && hasBack,
        `이름 ${body.includes(s.label) ? "O" : "X"} · 무엇 ${body.includes(s.what) ? "O" : "X"}` +
        ` · 언제 ${body.includes(NOT_YET_WHEN) ? "O" : "X"} · 돌아갈 길 ${hasBack ? "O" : "X"}`);
  }

  // ── ③ 돌아갈 길이 **눌린다** (§B-14) ───────────────────────────
  await page.goto(`${BASE}${notYetHref(NOT_YET[0].key)}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.locator(`a[href="${NOT_YET_BACK.href}"]`).first().click();
  await page.waitForURL((u) => new URL(u).pathname === NOT_YET_BACK.href, { timeout: 9000 }).catch(() => {});
  const landed = new URL(page.url()).pathname;
  chk("③-돌아갈-길이-눌린다", landed === NOT_YET_BACK.href,
      `눌렀더니 ${landed} (가야 할 곳 ${NOT_YET_BACK.href})`);

  // ── ④ 자물쇠가 레일에 **남아 있다** (§B-8) ─────────────────────
  const locks = await page.locator(".v3-rail .v3-lock").count();
  const railOld = await page.locator('.v3-rail a[href="/profile"], .v3-rail a[href="/settings"]').count();
  chk("④-레일에-자물쇠가-남는다", locks >= NOT_YET.length,
      `자물쇠 ${locks}개 · 막은 화면 ${NOT_YET.length}개 (지우면 없어진 줄 안다)`);
  chk("④짝-레일이-옛-화면으로-안-내보낸다", railOld === 0,
      `레일의 /profile·/settings 링크 ${railOld}개 (0이어야 한다 — §B-11)`);

  // ── ⑤ 팀원도 같다 — 등급이 아니라 **아직 안 만든 것**이라서 ────
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c2.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(MEMBER) }]);
  const p2 = await c2.newPage();
  const r2 = await p2.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  const u2 = new URL(p2.url());
  const b2 = await p2.locator("body").innerText();
  chk("⑤-팀원도-같은-막음-화면", r2.status() === 200 && u2.pathname === "/v3/not-yet"
      && !b2.includes("팀장부터"),
      `팀원(${MEMBER.name}) /settings → ${r2.status()} ${u2.pathname}` +
      ` · 등급 이야기 ${b2.includes("팀장부터") ? "**한다**" : "안 한다"}` +
      ` (지금 막는 이유는 등급이 아니다)`);
  await c2.close();

  // ── ⑥ 모르는 열쇠에는 **이름을 지어내지 않는다** ────────────────
  await page.goto(`${BASE}/v3/not-yet?k=없는열쇠`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const odd = await page.locator("body").innerText();
  chk("⑥-모르는-열쇠에-이름을-안-지어낸다",
      !odd.includes("없는열쇠") && odd.includes(NOT_YET_WHEN),
      `주소의 글자를 화면에 옮기지 ${odd.includes("없는열쇠") ? "**한다**" : "않는다"}` +
      ` · 돌아갈 길은 그대로 있다`);

  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
} catch (e) {
  fail += 1;
  console.error("\n넘어졌다 —", e.stack ?? e.message);
} finally {
  rmSync(TMP, { recursive: true, force: true });
  if (browser) await browser.close();
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const ok = JSON.stringify(nowVal) === JSON.stringify(swBefore);
    console.log(`\n뒷정리 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) process.exitCode = 1;
}
