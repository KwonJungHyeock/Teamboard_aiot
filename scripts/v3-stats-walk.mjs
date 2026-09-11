// v3 「집계」 실측 (MD-P-2026-052 §B).
//
// **로컬 전용** (지시 32). 만든 것과 바꾼 것을 전부 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 합이 맞는다 — 행 합 = 열 합 = 전체 = 기간 건수 − 네 상태 밖
//      그리고 **화면이 그 식을 스스로 적는다**
//   ② 칸을 누르면 **그 칸의 숫자만큼** 목록에 뜬다 (숫자와 목록이 같은 것을 센다)
//   ③ 기한 세 갈래가 `/api/tasks/open-due` 와 **같은 값** (다시 안 셌다)
//   ④ 달이 주소에 담긴다 · 이번 달은 안 적는다
//   ⑤ 팀원은 못 본다 — 레일에도 없고 주소로 가도 막힌다 (조건을 먼저 만든다)
//   ⑥ 프로젝트별 표가 **없다**
//   ⑦ 합이 어긋나면 화면이 말한다 (조건을 먼저 만든다)
//   ⑧ 콘솔 오류 0
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

requireLocalDb("v3-stats-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3g-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-052";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[052집계]";

let browser, swBefore = null, beforeCount = null, memberActor = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "stats.ts"), path.join(REPO, "lib", "v3", "tasks.ts"),
     path.join(REPO, "lib", "v3", "today.ts"), path.join(REPO, "lib", "v3", "category.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { cellHref, STAT_COLUMNS, monthLabel, shiftMonth } = req(path.join(TMP, "v3", "stats.js"));
  const { matchesDue, dueMonth, isDueSel } = req(path.join(TMP, "v3", "tasks.js"));

  // 짝조건 — **칸의 주소가 051 의 축을 그대로 쓰는가.** 달은 기한 축의 값이다.
  const href = cellHref("cat", 3, "doing", "2026-07");
  chk("0-짝조건-칸-주소가-축을-그대로",
      href === "/v3/tasks?cat=3&st=doing&due=m%3A2026-07"
      && isDueSel("m:2026-07") && dueMonth("m:2026-07") === "2026-07"
      && STAT_COLUMNS.length === 4 && shiftMonth("2026-12", 1) === "2027-01",
      `칸 주소 ${decodeURIComponent(href)} · 달은 기한 축의 값(m:2026-07) · 열 ${STAT_COLUMNS.length}개` +
      ` · 12월+1=${shiftMonth("2026-12", 1)}`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  const ym = today.slice(0, 7);

  /*
   * ── ①②⑦ 의 조건을 **먼저 만든다** ────────────────────────────
   *
   * 실데이터는 이번 달에 기한이 없어서 표가 통째로 0이다. 0으로는 「합이 맞는다」가
   * 아무 말도 못 한다. 이번 달 기한으로 네 상태를 하나씩 + **중단 하나**를 만든다.
   * 중단은 네 상태 밖이라 ⑦(합이 어긋날 때 말하는가)의 재료다.
   */
  const mk = async (title, status) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active, drop_reason)
     VALUES ($1, '', $2, $3, $3, $4, $5::date, 'mid', 'human', 'team', 'team', 'manual', true, $6)
     RETURNING id`,
    [title, areaId, me.id, status, `${ym}-05`, status === "dropped" ? "검사용" : null]))[0].id;

  for (const st of ["doing", "review", "todo", "done"]) await mk(`${MARK} ${st}`, st);
  await mk(`${MARK} dropped`, "dropped");

  const periodN = (await sql(
    `SELECT count(*)::int n FROM task WHERE is_active AND status <> 'proposed'
       AND to_char(due_date, 'YYYY-MM') = $1`, [ym]))[0].n;
  const droppedN = (await sql(
    `SELECT count(*)::int n FROM task WHERE is_active AND status = 'dropped'
       AND to_char(due_date, 'YYYY-MM') = $1`, [ym]))[0].n;
  chk("0-조건을-먼저-만들었다", periodN >= 5 && droppedN >= 1,
      `이번 달(${ym}) 기한 ${periodN}건 · 그중 네 상태 밖(중단) ${droppedN}건` +
      ` — 0이면 「합이 맞는다」가 아무 말도 못 한다`);

  // ⑤ 의 조건 — **팀원 계정 하나.** 없으면 등급 검사가 뜻을 잃는다.
  memberActor = (await sql(
    `INSERT INTO actor (type, display_name, is_active) VALUES ('human', $1, true) RETURNING id`,
    [`${MARK} 팀원`]))[0].id;
  await sql(
    `INSERT INTO account (actor_id, email, password_hash, role) VALUES ($1, $2, 'x', 'member')`,
    [memberActor, `${MARK}@test.local`]);

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  const cookie = (u) => ({ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: tok(u) });
  await ctx.addCookies([cookie({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                                 adminGrant: me.admin_grant, email: "x@x" })]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/v3/stats`, { waitUntil: "networkidle" });
  await page.locator(".v3-tbl").first().waitFor({ timeout: 9000 });

  // ── ① 합이 맞고, 화면이 그 식을 적는다 ────────────────────────
  const recon = (await page.locator(".v3-recon").innerText()).replace(/\s+/g, " ");
  const foot = async (i) =>
    (await page.locator(".v3-tbl").nth(i).locator("tfoot td").allInnerTexts()).map((t) => Number(t.trim()));
  const catFoot = await foot(0);
  const whoFoot = await foot(1);
  const catTotal = catFoot[catFoot.length - 1];
  const whoTotal = whoFoot[whoFoot.length - 1];
  chk("①-합이-맞고-식이-보인다",
      catTotal === periodN - droppedN && whoTotal === catTotal
      && recon.startsWith("합이 맞습니다") && recon.includes(String(catTotal)),
      `기간 ${periodN}건 − 네 상태 밖 ${droppedN}건 = ${periodN - droppedN}` +
      ` · 카테고리표 ${catTotal} · 담당자표 ${whoTotal} · 화면 "${recon.slice(0, 110)}"`);

  // ── ⑥ 프로젝트별 표가 없다 ────────────────────────────────────
  // 개수로 단언하지 않는다 (§G 052) — 카드가 하나 늘면(056 「완료율」) 개수가
  // 틀리지만 「프로젝트별이 없다」는 그대로 참이다. 이름으로 묻는다.
  // 다만 `없다`만 물으면 카드가 0개여도 통과한다 (§G 054) — 있어야 할
  // 둘이 있는지도 같이 센다.
  const heads = (await page.locator(".v3-card-h h2").allInnerTexts()).map((t) => t.trim());
  const must = ["카테고리 × 상태", "담당자 × 상태"];
  chk("⑥-프로젝트별-표가-없다",
      !heads.some((h) => h.includes("프로젝트")) && must.every((m) => heads.includes(m)),
      `표·카드 [${heads.join(" · ")}] — 프로젝트별은 이번에 안 만든다` +
      ` · 있어야 할 둘 [${must.join(" · ")}] ${must.every((m) => heads.includes(m)) ? "다 있음" : "빠짐"}`);

  // ── ③ 기한 세 갈래가 API 와 같다 ──────────────────────────────
  const strip = (await page.locator(".v3-odstrip .v3-stat-n").allInnerTexts()).map(Number);
  const api = await page.evaluate(async () => (await (await fetch("/api/tasks/open-due")).json()).tally);
  chk("③-세-갈래를-다시-안-센다",
      strip.join(",") === [api.before, api.after, api.none, api.excludedDone].join(","),
      `화면 [${strip.join(", ")}] · /api/tasks/open-due [${api.before}, ${api.after}, ${api.none}, ${api.excludedDone}]`);

  // ── ② 칸의 숫자 = 그 목록의 행 수 ─────────────────────────────
  //
  // **여기가 이 화면의 핵심이다.** 칸이 세는 것과 목록이 세는 것이 다르면
  // 숫자를 못 믿는다. 0이 아닌 칸을 하나 골라 눌러서 도착 화면의 행을 센다.
  const cell = page.locator(".v3-tbl tbody td.n a").first();
  const want = Number((await cell.innerText()).trim());
  const cellUrl = await cell.getAttribute("href");
  await cell.click();
  await page.locator(".v3-filters").waitFor({ timeout: 9000 });
  await page.waitForTimeout(900);
  const got = await page.locator(".v3-row").count();
  const chipTxt = (await page.locator(".v3-active").innerText().catch(() => "")).replace(/\s+/g, " ");
  chk("②-칸의-숫자-=-목록의-행-수",
      got === want && /기한 · \d+년 \d+월/.test(chipTxt),
      `칸 ${want}건 → ${decodeURIComponent(cellUrl ?? "")} → 목록 ${got}행` +
      ` · 걸린 조건 "${chipTxt.replace("걸린 조건 ", "").slice(0, 70)}"`);

  // ── ④ 달이 주소에 ────────────────────────────────────────────
  await page.goto(`${BASE}/v3/stats`, { waitUntil: "networkidle" });
  await page.locator(".v3-calbar").waitFor({ timeout: 9000 });
  const thisUrl = new URL(page.url());
  await page.locator(".v3-calbar button").filter({ hasText: "지난달" }).click();
  await page.waitForTimeout(700);
  const prevUrl = new URL(page.url());
  const shownMonth = (await page.locator(".v3-calm").innerText()).trim();
  chk("④-달이-주소에",
      thisUrl.searchParams.get("m") === null
      && prevUrl.searchParams.get("m") === shiftMonth(ym, -1)
      && shownMonth === monthLabel(shiftMonth(ym, -1)),
      `이번 달은 주소에 안 적는다(${thisUrl.search || "(없음)"}) · 지난달 ?m=${prevUrl.searchParams.get("m")}` +
      ` · 화면 "${shownMonth}"`);
  await page.goto(`${BASE}/v3/stats`, { waitUntil: "networkidle" });
  await page.locator(".v3-tbl").first().waitFor({ timeout: 9000 });
  await page.screenshot({ path: `${OUT}/B-집계.png`, fullPage: true });

  // ── ⑦ 합이 어긋나면 화면이 말한다 ─────────────────────────────
  //
  // 조건을 만든다 — 화면이 쓰는 순수 함수에 **일부러 어긋난 표**를 넣어 본다.
  // 화면 밖에서 DB 를 뒤틀면 그건 사람이 만들 수 없는 상태라(§G 048),
  // 대신 「어긋남을 말하는 규칙」이 실제로 어긋남을 잡는지를 값으로 본다.
  const { reconcile } = req(path.join(TMP, "v3", "stats.js"));
  const bent = reconcile({ rows: [{ total: 3 }], colTotals: [2], total: 2 }, 5, 0);
  chk("⑦-어긋나면-잡는다", !bent.ok && reconcile({ rows: [{ total: 2 }], colTotals: [2], total: 2 }, 2, 0).ok,
      `행 합 ${bent.rowSum} ≠ 열 합 ${bent.colSum} → ok=${bent.ok} (거짓이라야 한다)`);

  // ── ⑤ 팀원은 못 본다 ─────────────────────────────────────────
  await ctx.clearCookies();
  await ctx.addCookies([cookie({ id: memberActor, actorId: memberActor, name: "검사팀원",
                                 role: "member", adminGrant: false, email: `${MARK}@test.local` })]);
  await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  await page.locator(".v3-rail").waitFor({ timeout: 9000 });
  const railNames = (await page.locator(".v3-navlink").allInnerTexts()).map((t) => t.trim());
  const res = await page.goto(`${BASE}/v3/stats`, { waitUntil: "networkidle" });
  const landed = new URL(page.url()).pathname;
  chk("⑤-팀원은-못-본다",
      !railNames.includes("집계") && landed !== "/v3/stats" && res?.status() === 200,
      `팀원 레일 [${railNames.join(" · ")}] · /v3/stats → ${landed} (${res?.status()})` +
      ` — 레일과 화면이 같은 함수(hasLead)로 가린다`);

  chk("⑧-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]).catch((e) => console.error("업무 정리 실패", e.message));
  if (memberActor) {
    await pool.query(`DELETE FROM account WHERE actor_id = $1`, [memberActor]).catch((e) => console.error("account 정리 실패", e.message));
    await pool.query(`DELETE FROM actor WHERE id = $1`, [memberActor]).catch((e) => console.error("actor 정리 실패", e.message));
  }
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const actors = (await pool.query(`SELECT count(*)::int n FROM actor WHERE display_name LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount && actors === 0;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount}) · ${MARK} 사람 ${actors}명${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
