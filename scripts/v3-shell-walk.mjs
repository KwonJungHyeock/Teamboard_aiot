// v3 껍데기 셋 실측 (MD-P-2026-051 §A).
//
// **로컬 전용** (지시 32). 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 「＋ 새 업무」가 **모든 v3 화면**에 두 자리로 있다 (껍데기에서 한 번 그린다)
//   ② 두 자리가 **같은 곳**으로 간다
//   ③ 단축키 `C` 로 새 업무로 간다 — **도착 화면을 본다**(§G)
//   ④ 입력 칸에 커서가 있으면 `C` 가 **안 걸린다** (글자가 그대로 들어간다)
//   ⑤ 계정 블록이 **바닥 붙박이**다 — 본문을 끝까지 내려도 화면에 남는다
//   ⑥ 역할 배지가 039 규칙대로다 — `roleLabel` · `showsAdminGrantBadge` 그대로
//   ⑦ 설정 링크의 조건이 **그 화면의 조건과 같다** (§G 038) — 팀원에겐 안 눌린다
//   ⑧ 가오픈 카드: D · 긴 날짜 · 「n주 n일」이 **`lib/countdown.ts` 와 같은 값**
//   ⑨ 가오픈 카드에 **진행 막대가 없다** (시작일이 config 에 없다)
//   ⑩ 콘솔 오류 0
//
// ⑧ 의 조건 — 검사기가 값을 옮겨 적지 않는다. **제품의 함수를 그대로 부른다.**
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-shell-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3s-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-051";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(28)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(28)} ${n}`); } };

const KEY = "ui_v3_enabled";
const V3_PAGES = ["/v3", "/v3/tasks", "/v3/new", "/v3/calendar"];

let browser, swBefore = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "countdown.ts"), path.join(REPO, "lib", "types.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { dDay, weeksAndDays, longDateKst } = req(path.join(TMP, "countdown.js"));
  const { roleLabel, showsAdminGrantBadge, hasLead } = req(path.join(TMP, "types.js"));

  chk("0-짝조건-주-파생이-맞다",
      weeksAndDays(52)?.text === "7주 3일 남음" && weeksAndDays(14)?.text === "2주 남음"
      && weeksAndDays(3)?.text === "3일 남음" && weeksAndDays(0) === null && weeksAndDays(-5) === null,
      `52일 → "${weeksAndDays(52)?.text}" · 14일 → "${weeksAndDays(14)?.text}"` +
      ` · 3일 → "${weeksAndDays(3)?.text}" · 지났으면 ${weeksAndDays(0)}`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  /* ── ①② 「새 업무」 버튼은 **정확히 하나** (056 §A) ──────────────
   *
   * 051 은 레일과 헤더 두 자리였다. 지시자 정정 — 헤더도 껍데기에서 그리므로
   * 이미 모든 화면에 있었고, 같은 곳으로 가는 버튼이 한 화면에 둘이었다.
   *
   * 그래서 묻는 것이 바뀐다: 「둘 다 있는가」가 아니라 **「하나인가」**.
   * 클래스로 세지 않고 **화면에 보이는 것**으로 센다 — 클래스로 세면 레일 것을
   * 다른 이름으로 되살려도 통과한다.
   */
  const seen = [];
  for (const p of V3_PAGES) {
    await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
    await page.locator(".v3-main").waitFor({ timeout: 9000 });
    const btns = page.locator(".v3 a, .v3 button").filter({ hasText: /새 업무/ });
    const n = await btns.count();
    const hrefs = await btns.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    // 레일의 메뉴 항목 「새 업무」는 버튼이 아니라 **메뉴**다 — 세는 데서 뺀다.
    const nav = await page.locator(".v3-navlink").filter({ hasText: /새 업무/ }).count();
    seen.push({ p, n: n - nav, hrefs: hrefs.filter((h) => h !== null) });
  }
  chk("①-「새-업무」-버튼이-정확히-하나",
      seen.every((s) => s.n === 1),
      seen.map((s) => `${s.p} ${s.n}개`).join(" · ") + " (레일 메뉴 항목은 뺀 수)");
  chk("②-그-하나가-같은-곳으로",
      seen.every((s) => s.hrefs.every((h) => h === "/v3/new")),
      `가리키는 곳 [${Array.from(new Set(seen.flatMap((s) => s.hrefs))).join(", ")}]`);
  // 레일의 흰 버튼이 **실제로 없어졌는지** 값으로 본다. 없어진 것을 세는 자리다.
  chk("②짝-레일의-흰-버튼은-없다",
      (await page.locator(".v3-railnew").count()) === 0,
      `.v3-railnew ${await page.locator(".v3-railnew").count()}개 — 056 §A 에서 거뒀다`);

  // ── ③ 단축키 C — **도착 화면을 본다** ──────────────────────────
  await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await page.locator(".v3-h1").waitFor({ timeout: 8000 });
  await page.locator("body").press("c");
  const arrived = await page.locator(".v3-title-in").first()
    .waitFor({ timeout: 9000 }).then(() => true).catch(() => false);
  const h1 = (await page.locator(".v3-h1").innerText().catch(() => "")).trim();
  chk("③-단축키-C-로-새-업무", arrived && h1 === "새 업무",
      `${new URL(page.url()).pathname} · 제목 "${h1}" · 큰 입력칸 ${arrived ? "있음" : "**없음**"}`);

  // ── ④ 입력 중에는 안 걸린다 ────────────────────────────────────
  //
  // 조건을 만든다 — 제목 칸에 커서를 두고 `c` 를 친다. 화면으로 끌려가면
  // 적던 것이 사라지고, 사라진 이유가 화면 어디에도 안 남는다.
  await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await page.locator(".v3-chips input, .v3-h1").first().waitFor({ timeout: 8000 });
  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  await page.locator(".v3-title-in").waitFor({ timeout: 8000 });
  await page.locator(".v3-title-in").click();
  await page.locator(".v3-title-in").type("abc");
  await page.waitForTimeout(300);
  const typed = await page.locator(".v3-title-in").inputValue();
  chk("④-입력-중에는-안-걸린다", typed === "abc",
      `제목 칸에 "abc" 를 쳤고 값은 "${typed}" — `+
      `'c' 가 단축키로 먹었으면 글자가 빠지거나 화면이 바뀐다`);

  // ── ⑤ 계정 블록이 바닥 붙박이 ──────────────────────────────────
  //
  // 조건을 만든다 — **본문이 화면보다 긴 곳**으로 가서 끝까지 내린다.
  await page.goto(`${BASE}/v3/tasks?done=1`, { waitUntil: "networkidle" });
  await page.locator(".v3-row").first().waitFor({ timeout: 9000 });
  const docH = await page.evaluate(() => document.body.scrollHeight);
  const winH = await page.evaluate(() => window.innerHeight);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(400);
  const box = await page.locator(".v3-acct").boundingBox();
  const inView = box !== null && box.y >= 0 && box.y + box.height <= winH + 2;
  chk("⑤-계정-블록이-바닥-붙박이",
      docH > winH && inView,
      `본문 ${docH}px > 화면 ${winH}px · 끝까지 내린 뒤 계정 블록 y=${box?.y?.toFixed(0)}` +
      ` h=${box?.height?.toFixed(0)} → ${inView ? "화면 안" : "**밀려 나감**"}`);

  // ── ⑥ 역할 배지가 039 그대로 ───────────────────────────────────
  const badges = await page.locator(".v3-acct-bg em").allInnerTexts();
  const want = [roleLabel(me.role)];
  if (showsAdminGrantBadge({ role: me.role, adminGrant: me.admin_grant })) want.push("관리자 권한");
  chk("⑥-역할-배지가-039-그대로",
      badges.map((t) => t.trim()).join("|") === want.join("|"),
      `화면 [${badges.map((t) => t.trim()).join(" · ")}] · lib/types 가 내는 것 [${want.join(" · ")}]`);

  // ── ⑦ 설정 링크의 조건 = 그 화면의 조건 (§G 038) ───────────────
  const leadNow = hasLead(me.role);
  const settingsLink = await page.locator('.v3-acct-l[href="/settings"]').count();
  const settingsOff = await page.locator(".v3-acct-l.off").count();
  chk("⑦-설정-링크가-화면과-같은-조건",
      leadNow ? (settingsLink === 1 && settingsOff === 0) : (settingsLink === 0 && settingsOff === 1),
      `hasLead(${me.role}) = ${leadNow} · 눌리는 설정 ${settingsLink}개 · 흐린 설정 ${settingsOff}개` +
      ` — app/settings/page.tsx 도 hasLead 로 막는다`);

  // ── ⑧⑨ 가오픈 카드 ────────────────────────────────────────────
  await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  await page.locator(".v3-open").waitFor({ timeout: 9000 });
  const openAt = await page.evaluate(async () =>
    (await (await fetch("/api/tasks/open-due")).json()).openAt);
  const openAtMs = Date.parse(String(openAt));
  const d = dDay(openAtMs, Date.now());
  const card = {
    d: (await page.locator(".v3-open-d").innerText()).trim(),
    when: (await page.locator(".v3-open-when").innerText()).trim(),
    left: (await page.locator(".v3-open-left").innerText().catch(() => "")).trim(),
  };
  const wantD = d > 0 ? `D-${d}` : d === 0 ? "당일" : `+${-d}일`;
  chk("⑧-가오픈-카드가-countdown-과-같다",
      card.d === wantD && card.when === longDateKst(openAtMs)
      && card.left === (weeksAndDays(d)?.text ?? ""),
      `화면 [${card.d} · ${card.when} · ${card.left}] · lib/countdown [${wantD} · ` +
      `${longDateKst(openAtMs)} · ${weeksAndDays(d)?.text ?? "(없음)"}]`);

  /*
   * ⑨ **진행 막대가 없다.**
   *
   * 시작일이 `config` 에 없으므로 「얼마나 왔는가」의 근거가 없다. 값으로
   * 확인한다 — 카드 안의 막대꼴 요소 수와, config 에 시작일 열쇠가 있는지 둘 다.
   */
  const bars = await page.locator(".v3-open .v3-bar, .v3-open progress, .v3-open [role='progressbar']").count();
  const startKeys = await sql(
    `SELECT key FROM config WHERE key ILIKE '%start%' OR key ILIKE '%open%'`);
  chk("⑨-진행-막대가-없다",
      bars === 0,
      `카드 안 막대 ${bars}개 · config 의 관련 열쇠 [${startKeys.map((r) => r.key).join(", ") || "없음"}]` +
      ` — 시작일이 없으니 비율의 근거가 없다`);

  await page.screenshot({ path: `${OUT}/A-껍데기.png`, fullPage: true });
  chk("⑩-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore);
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
