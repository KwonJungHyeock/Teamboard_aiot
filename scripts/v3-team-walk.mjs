// v3 「팀 현황」 실측 (MD-P-2026-052 §A).
//
// **로컬 전용** (지시 32). 만든 것과 바꾼 것을 전부 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 열 수 = **활성 담당자 수** (값으로)
//   ② 각 열 건수의 합 = **진행 중 전체** (새는 것 없음)
//   ③ 칩을 누르면 **열이 그대로 있고 건수만 준다**
//   ④ 비활성 담당의 진행 중 업무가 **「담당 없음」 열**에 나온다 (조건을 먼저)
//   ⑤ 한 열에 다섯까지 + 「＋n건 더 보기」
//   ⑥ 이름이 **코드에 안 박혀 있다** — 계정을 늘리면 열도 는다
//   ⑦ 담당 거르개는 **여기 없다** (열이 이미 담당이다)
//   ⑧ 완료는 안 보인다
//   ⑨ 콘솔 오류 0
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

requireLocalDb("v3-team-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3t-out");
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
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(28)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(28)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[052팀]";

let browser, swBefore = null, beforeCount = null, ghostActor = null, newbie = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "team.ts"), path.join(REPO, "lib", "v3", "tasks.ts"),
     path.join(REPO, "lib", "v3", "today.ts"), path.join(REPO, "lib", "v3", "category.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { buildColumns, columnLayout, COL_MAX, OPEN_STATUSES } = req(path.join(TMP, "v3", "team.js"));

  // 짝조건 — **미리 정해 둔 배치**가 그대로인가. 넷은 좁히고 다섯부터 민다.
  chk("0-짝조건-배치를-미리-정했다",
      columnLayout(3).cols === 3 && !columnLayout(3).scroll
      && columnLayout(4).cols === 4 && !columnLayout(4).scroll
      && columnLayout(5).cols === 5 && columnLayout(5).scroll
      && COL_MAX === 5 && !OPEN_STATUSES.includes("done"),
      `3→${columnLayout(3).cols}열 · 4→${columnLayout(4).cols}열 · 5→${columnLayout(5).cols}열(가로로 밈)` +
      ` · 한 열 최대 ${COL_MAX}건 · 서는 상태 [${OPEN_STATUSES.join(", ")}]`);

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

  const mk = async (title, who, status = "doing", due = today) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $6, $4, $5::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, areaId, who, status, due, me.id]))[0].id;

  /*
   * ── ④ 의 조건을 **먼저 만든다** ───────────────────────────────
   *
   * 비활성 계정 하나와 그 사람 앞으로 된 진행 중 업무 하나. 이 둘이 없으면
   * ④ 는 「원래 없어서 통과」한다. 뒷정리에서 둘 다 지운다.
   */
  ghostActor = (await sql(
    `INSERT INTO actor (type, display_name, is_active) VALUES ('human', $1, false) RETURNING id`,
    [`${MARK} 떠난 사람`]))[0].id;
  const ghostTask = await mk(`${MARK} 떠난 사람 업무`, ghostActor);

  /*
   * ── ⑥ 의 조건 — **사람을 하나 더 만든다.**
   *
   * 「이름을 코드에 안 박았다」는 눈으로 소스를 봐서는 증명이 안 된다.
   * 계정을 하나 늘렸을 때 열이 하나 느는지로 본다.
   */
  newbie = (await sql(
    `INSERT INTO actor (type, display_name, is_active) VALUES ($1, $2, true) RETURNING id`,
    ["human", `${MARK} 새 사람`]))[0].id;

  const activeBefore = (await sql(
    `SELECT count(*)::int n FROM actor WHERE type = 'human' AND is_active = true`))[0].n;

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  const colNames = async () =>
    (await page.locator(".v3-col-nm b").allInnerTexts()).map((t) => t.trim());
  const colCounts = async () =>
    (await page.locator(".v3-col-n").allInnerTexts()).map((t) => Number(t.trim()));

  await page.goto(`${BASE}/v3/team`, { waitUntil: "networkidle" });
  await page.locator(".v3-col").first().waitFor({ timeout: 9000 });

  // ── ① 열 수 = 활성 담당자 수 (+ 담당 없음 열) ───────────────────
  const names = await colNames();
  const hasNone = names.includes("담당 없음");
  chk("①-열-수-=-활성-담당자-수",
      names.length === activeBefore + (hasNone ? 1 : 0),
      `열 ${names.length}개 [${names.join(" · ")}] · 활성 사람 ${activeBefore}명` +
      `${hasNone ? " + 「담당 없음」 1" : ""}`);

  // ── ⑥ 이름이 코드에 안 박혔다 — 만든 사람이 열로 섰다 ───────────
  chk("⑥-이름을-코드에-안-박았다",
      names.includes(`${MARK} 새 사람`),
      `방금 만든 계정 "${MARK} 새 사람" 이 열로 ${names.includes(`${MARK} 새 사람`) ? "섰다" : "**안 섰다**"}` +
      ` — 코드에 박혀 있으면 안 선다`);

  // ── ④ 비활성 담당의 업무가 「담당 없음」 열에 ──────────────────
  const noneCol = page.locator(".v3-col").filter({ hasText: "담당 없음" }).first();
  const noneTxt = (await noneCol.innerText().catch(() => "")).replace(/\s+/g, " ");
  chk("④-떠난-사람-업무가-안-사라진다",
      noneTxt.includes(`${MARK} 떠난 사람 업무`) && /비활성 계정 담당 \d+건 포함/.test(noneTxt),
      `「담당 없음」 열 "${noneTxt.slice(0, 90)}"`);

  // ── ② 합이 맞는다 ─────────────────────────────────────────────
  const counts = await colCounts();
  const sum = counts.reduce((a, b) => a + b, 0);
  const openN = (await sql(
    `SELECT count(*)::int n FROM task t
      WHERE t.is_active AND t.status = ANY($1::text[])
        AND (t.visibility <> 'private' OR t.created_by = $2 OR t.assignee_id = $2)`,
    [OPEN_STATUSES, me.id]))[0].n;
  const leak = await page.locator(".v3-leak").count();
  chk("②-열-합-=-진행-중-전체",
      sum === openN && leak === 0,
      `열 합 ${sum}건 [${counts.join("+")}] · DB 진행 중 ${openN}건 · 경고 줄 ${leak}개`);

  // ── ⑧ 완료는 안 보인다 ────────────────────────────────────────
  const doneN = (await sql(
    `SELECT count(*)::int n FROM task WHERE is_active AND status = 'done'`))[0].n;
  const doneShown = await page.locator(".v3-cardrow .v3-cb.done").count();
  chk("⑧-완료는-안-보인다", doneShown === 0 && doneN > 0,
      `DB 완료 ${doneN}건 · 화면에 선 완료 ${doneShown}건 (0이라야 한다)`);

  // ── ⑦ 담당 거르개가 없다 ──────────────────────────────────────
  const axes = (await page.locator(".v3-fx-l").allInnerTexts()).map((t) => t.trim());
  chk("⑦-담당-거르개는-없다",
      !axes.includes("담당") && axes.includes("상태") && axes.includes("기한"),
      `거르개 축 [${axes.join(" · ")}] — 열이 이미 담당이다`);

  // ── ⑤ 다섯까지 + 「＋n건 더 보기」 ────────────────────────────
  //
  // 조건을 만든다 — 한 사람에게 여섯 건을 몰아 준다.
  for (let i = 1; i <= 6; i += 1) await mk(`${MARK} 몰아주기 ${i}`, newbie);
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".v3-col").first().waitFor({ timeout: 9000 });
  const pileCol = page.locator(".v3-col").filter({ hasText: `${MARK} 새 사람` }).first();
  const shownN = await pileCol.locator(".v3-cardrow").count();
  const moreTxt = (await pileCol.locator(".v3-col-more").innerText().catch(() => "")).trim();
  await pileCol.locator(".v3-col-more").click();
  await page.waitForTimeout(400);
  const afterN = await pileCol.locator(".v3-cardrow").count();
  chk("⑤-다섯까지-+-더-보기",
      shownN === COL_MAX && /^＋\d+건 더 보기$/.test(moreTxt) && afterN === 6,
      `여섯 건 몰아줌 → ${shownN}건 + "${moreTxt}" → 펼치면 ${afterN}건`);
  await page.screenshot({ path: `${OUT}/A-팀현황.png`, fullPage: true });

  // ── ③ 칩을 눌러도 열이 그대로 있고 건수만 준다 ─────────────────
  const before3 = await colNames();
  const sumBefore = (await colCounts()).reduce((a, b) => a + b, 0);
  await page.locator(".v3-chips .v3-chip").nth(1).click();     // 첫 카테고리
  await page.waitForTimeout(900);
  const after3 = await colNames();
  const sumAfter = (await colCounts()).reduce((a, b) => a + b, 0);
  chk("③-칩을-눌러도-열은-그대로",
      before3.join("|") === after3.join("|") && sumAfter < sumBefore,
      `열 ${before3.length}개 → ${after3.length}개(같아야 한다) · 합 ${sumBefore} → ${sumAfter}(줄어야 한다)` +
      ` · 주소 ${new URL(page.url()).search}`);
  await page.screenshot({ path: `${OUT}/A-팀현황-거름.png`, fullPage: true });

  chk("⑨-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
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
  // 만든 사람 둘도 지운다 — 검사가 남긴 계정이 다음 회차의 열로 선다.
  for (const id of [ghostActor, newbie]) {
    if (id) await pool.query(`DELETE FROM actor WHERE id = $1`, [id]).catch((e) => console.error("actor 정리 실패", e.message));
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
