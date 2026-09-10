// v3 「업무」 실측 (MD-P-2026-044 §B).
//
// **로컬 전용** (지시 32). 스위치 · 만든 area · 만든 업무를 **시작 전으로 되돌린다**.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 켜면 `/tasks` 에서 v3 「업무」에 **도착한다** (주소가 아니라 화면 · §G)
//   ② **일곱 카테고리가 전부** 칩 줄에 있다 — 접힌 `＋n` 을 펼쳐 세면 합이 맞는다
//   ③ 카테고리별 건수 합 = 전체 건수 (**새는 것이 없다**)
//   ④ 색 매핑에 없는 area 의 업무가 **회색으로 그려지되 이름이 남는다**
//   ⑤ 행에 **네 가지만** — 체크 · 제목 · 담당 · 기한. ID·우선순위·진척 막대 없음
//   ⑥ 지남 7일 이내는 코랄, **7일 초과는 회색** (오늘 화면과 같은 기준)
//   ⑦ 상태로 묶인다 · 「업무」는 **접지 않는다**
//   ⑧ 정렬이 **주소에 담긴다** — 그대로 열면 같은 순서다
//   ⑨ 카테고리 칩을 누르면 걸러지고 그것도 주소에 담긴다
//   ⑩ **상세로 가는 링크가 살아 있다** — `/tasks` 를 짝에 넣어도 안 삼켜진다
//   ⑪ 콘솔 오류 0 · 끄면 옛 업무 목록이 그대로
//
// ── 조건은 관측보다 먼저 만든다 (§G) ────────────────────────────
//
// ④는 **팔레트에 없는 area** 가 있어야 뜻을 갖는다. 로컬 일곱 개는 전부
// 팔레트에 있으므로 검사기가 하나 만들어 업무를 붙인다. 끝나면 지운다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-tasks-walk.mjs");

const REPO = process.cwd();
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-044";
const TMP = path.join(REPO, ".v3k-out");
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
const MARK = "[044검사]";
const GHOST_AREA = `${MARK} 색없는영역`;

let browser, swBefore = null, madeTasks = [], ghostArea = null, beforeCount = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "tasks.ts"), path.join(REPO, "lib", "v3", "today.ts"),
     path.join(REPO, "lib", "v3", "category.ts"), "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { groupTasks, dueTone, countByArea } = req(path.join(TMP, "v3", "tasks.js"));
  const { resolveAreas, chipRow, AREA_PALETTE } = req(path.join(TMP, "v3", "category.js"));

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };
  await setSwitch(null);

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  // ── 조건 ── 팔레트에 **없는** area 와 그 업무. 지남 3일 · 40일도 만든다.
  const maxSort = (await sql(`SELECT COALESCE(max(sort_order), 0)::int n FROM area`))[0].n;
  ghostArea = (await sql(
    `INSERT INTO area (name, color_key, sort_order) VALUES ($1, 'team', $2) RETURNING id`,
    [GHOST_AREA, maxSort + 1]))[0].id;
  const inPalette = AREA_PALETTE.map((p) => p.name);
  chk("0-짝조건", !inPalette.includes(GHOST_AREA),
      `"${GHOST_AREA}" 는 팔레트에 없다 (팔레트 ${inPalette.length}개) — ④가 뜻을 가진다`);

  const back = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10); };
  const mk = async (title, status, due, areaId) => (await sql(
    `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id)
     VALUES ($1, $2, $3::date, $4, 'team', 'team', $5, $5) RETURNING id`,
    [`${MARK} ${title}`, status, due, areaId, me.id]))[0].id;
  madeTasks.push(await mk("색없는 업무", "doing", today, ghostArea));
  madeTasks.push(await mk("지남 3일", "doing", back(3), ghostArea));
  madeTasks.push(await mk("지남 40일", "todo", back(40), ghostArea));
  console.log(`   (조건) area#${ghostArea} "${GHOST_AREA}" + 업무 ${madeTasks.length}건`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.locator(".frn-skip").first().click({ timeout: 1500 }).catch(() => {});
  const oldFp = async () => {
    const r = await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    return `${r?.status()}:${new URL(page.url()).pathname}:${await page.locator(".v3").count()}`;
  };
  const fpOff = await oldFp();

  // ── ① 켜면 도착 ────────────────────────────────────────────────
  await setSwitch(true);
  const res = await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const h1 = (await page.locator(".v3-h1").innerText().catch(() => "")).trim();
  chk("①-켜면-업무에-도착한다",
      new URL(page.url()).pathname === "/v3/tasks" && h1 === "업무",
      `→ ${new URL(page.url()).pathname} (${res?.status()}) · "${h1}"`);
  await page.locator(".v3-card").first().waitFor({ timeout: 8000 });

  // 재료 — DB 에서 직접 읽어 같은 함수로 다시 센다.
  const rows = await sql(
    `SELECT t.id, t.title, t.status, t.due_date::text AS "dueDate",
            ac.display_name AS "assigneeName", t.area_id AS "areaId",
            t.completed_at::text AS "completedAt", t.parent_task_id AS "parentTaskId"
       FROM task t LEFT JOIN actor ac ON ac.id = t.assignee_id
      WHERE t.is_active = true AND t.status <> 'proposed'
        AND (t.visibility = 'team' OR t.created_by = $1)`, [me.id]);
  const areaRows = await sql(`SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`);
  const areas = resolveAreas(areaRows);
  const counts = countByArea(rows);
  const { shown, hidden } = chipRow(areas, counts);

  // ── ② 일곱(+검사용 하나) 카테고리가 전부 있다 ───────────────────
  const chipTexts = async () => {
    const n = await page.locator(".v3-chips .v3-chip").count();
    const out = [];
    for (let i = 0; i < n; i++) out.push((await page.locator(".v3-chips .v3-chip").nth(i).innerText()).replace(/\s+/g, " ").trim());
    return out;
  };
  const before = await chipTexts();
  const plus = page.locator(".v3-chip.dashed");
  const hasPlus = await plus.count() > 0;
  if (hasPlus) { await plus.first().click(); await page.waitForTimeout(250); }
  const after = await chipTexts();
  // 「전체」 칩에는 건수가 붙어 "전체 27" 이다 — `!== "전체"` 로는 안 걸러진다.
  // 처음에 그렇게 썼다가 칩을 9개로 세고 FAIL 이 났다. 화면이 아니라 셈이 틀렸다.
  const named = after.filter((t) => !t.startsWith("전체") && !t.startsWith("＋"));
  const allNames = areas.map((a) => a.name);
  chk("②-카테고리가-전부-있다",
      allNames.every((n) => named.some((t) => t.startsWith(n))) && named.length === areas.length,
      `칩 ${named.length}개 · area ${areas.length}개 · 접힘 ${hidden.length}개(${hasPlus ? "＋n 있었다" : "없었다"})`);

  // ── ③ 합이 맞는가 ──────────────────────────────────────────────
  const chipSum = shown.concat(hidden).reduce((n, c) => n + c.count, 0);
  const allChip = (before.find((t) => t.startsWith("전체")) ?? "").replace(/\D/g, "");
  chk("③-칩-합-=-전체", chipSum === rows.length && Number(allChip) === rows.length,
      `칩 합 ${chipSum} · 전체 칩 ${allChip} · DB ${rows.length}`);

  // ── ④ 색 없는 area — 회색이되 이름이 남는다 ─────────────────────
  const ghostChip = after.find((t) => t.startsWith(GHOST_AREA));
  const ghostView = areas.find((a) => a.id === ghostArea);
  chk("④-색없는-영역도-이름이-남는다",
      !!ghostChip && ghostView?.tone === "etc",
      `칩 "${ghostChip ?? "**없다**"}" · 색 ${ghostView?.tone} (etc = 회색)`);

  // ── ⑤ 행에 네 가지만 ───────────────────────────────────────────
  const row = page.locator(".v3-row").first();
  const kids = await row.evaluate((el) => Array.from(el.children).map((c) => c.className));
  const rowTxt = await row.innerText();
  chk("⑤-행에-네-가지만", kids.length === 3 && !/#\d/.test(rowTxt) && await row.locator("progress, .v3-bar").count() === 0,
      `자식 ${kids.length}개 [${kids.join(" | ")}] · ID 표기 없음 · 진척 막대 없음`);

  // ── ⑥ 기한의 결 ────────────────────────────────────────────────
  const tone3 = page.locator(".v3-row").filter({ hasText: `${MARK} 지남 3일` }).first();
  const tone40 = page.locator(".v3-row").filter({ hasText: `${MARK} 지남 40일` }).first();
  const c3 = await tone3.locator(".v3-due").evaluate((el) => getComputedStyle(el).color);
  const c40 = await tone40.locator(".v3-due").evaluate((el) => getComputedStyle(el).color);
  chk("⑥-7일-이내만-코랄", c3 === "rgb(224, 82, 79)" && c40 === "rgb(154, 164, 184)",
      `지남3일 ${c3} (코랄) · 지남40일 ${c40} (회색)`);
  chk("⑥짝-계산과-같다",
      dueTone(back(3), today) === "late" && dueTone(back(40), today) === "stale",
      `계산 ${dueTone(back(3), today)} · ${dueTone(back(40), today)}`);

  // ── ⑦ 묶음 · 안 접는다 ─────────────────────────────────────────
  const want = groupTasks(rows, "due");
  const cardTitles = [];
  const nCard = await page.locator(".v3-card .v3-card-h h2").count();
  for (let i = 0; i < nCard; i++) cardTitles.push((await page.locator(".v3-card .v3-card-h h2").nth(i).innerText()).trim());
  const shownRows = await page.locator(".v3-row").count();
  chk("⑦-상태로-묶이고-안-접는다",
      cardTitles.join(" | ") === want.map((g) => g.label).join(" | ")
        && shownRows === want.reduce((n, g) => n + g.rows.length, 0)
        && await page.locator(".v3-stale-h").count() === 0,
      `묶음 [${cardTitles.join(" | ")}] · 행 ${shownRows} · 접힌 줄 ${await page.locator(".v3-stale-h").count()}개`);

  // 거르기 전 전체 목록도 남긴다 — 걸러진 화면만 있으면 결을 못 본다.
  await page.screenshot({ path: `${OUT}/v3-tasks.png`, fullPage: true });

  // ── ⑧ 정렬이 주소에 담긴다 ──────────────────────────────────────
  const firstTitle = async () => (await page.locator(".v3-card .v3-row .v3-row-t").first().innerText()).trim();
  const dueFirst = await firstTitle();
  await page.locator(".v3-sortbtn").click();
  await page.waitForTimeout(500);
  const urlAfter = new URL(page.url());
  const recentFirst = await firstTitle();
  // 같은 주소를 **새로 열어** 같은 순서가 나오는지 본다 — 그래야 공유가 된다.
  await page.goto(urlAfter.toString(), { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const reopened = await firstTitle();
  chk("⑧-정렬이-주소에-담긴다",
      urlAfter.searchParams.get("sort") === "recent" && reopened === recentFirst && recentFirst !== dueFirst,
      `?sort=${urlAfter.searchParams.get("sort")} · 기한순 첫 행 "${dueFirst}" → 최신순 "${recentFirst}" · 다시 열어도 "${reopened}"`);

  // ── ⑨ 카테고리 거르기도 주소에 ─────────────────────────────────
  await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const dashed = page.locator(".v3-chip.dashed");
  if (await dashed.count()) { await dashed.first().click(); await page.waitForTimeout(200); }
  await page.locator(".v3-chip").filter({ hasText: GHOST_AREA }).first().click();
  await page.waitForTimeout(600);
  const u9 = new URL(page.url());
  const n9 = await page.locator(".v3-row").count();
  chk("⑨-거르기가-주소에-담긴다",
      u9.searchParams.get("cat") === String(ghostArea) && n9 === madeTasks.length,
      `?cat=${u9.searchParams.get("cat")} · 행 ${n9} (만든 ${madeTasks.length}건)`);
  await page.screenshot({ path: `${OUT}/v3-tasks-filtered.png`, fullPage: true });

  // ── ⑩ 상세로 가는 링크가 안 삼켜진다 ────────────────────────────
  const href = await page.locator(".v3-row .v3-row-t").first().getAttribute("href");
  const wantId = (href ?? "").match(/task:(\d+)/)?.[1] ?? "";
  await page.locator(".v3-row .v3-row-t").first().click();
  // **시간이 아니라 상태를 기다린다.** 「불러오는 중」에서 통과하면 도착을 안 본 것이다(§G).
  await page.locator("aside.tdp").filter({ hasText: `#${wantId}` })
    .first().waitFor({ timeout: 10000 }).catch(() => {});
  const panelTxt = (await page.locator("aside.tdp").first().innerText().catch(() => "")).slice(0, 60);
  chk("⑩-상세-링크가-살아있다",
      new URL(page.url()).pathname === "/tasks" && panelTxt.includes(`#${wantId}`),
      `${href} → ${new URL(page.url()).pathname} · 패널 "${panelTxt.replace(/\n/g, " ")}"`);

  chk("⑪-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);

  // ── 끄면 옛 목록 ───────────────────────────────────────────────
  await setSwitch(false);
  const fpBack = await oldFp();
  chk("⑪-끄면-옛-업무-목록", fpBack === fpOff, fpBack === fpOff ? `지문 일치 (${fpBack})` : `${fpBack} vs ${fpOff}`);

  await ctx.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(TMP, { recursive: true, force: true });
  for (const id of madeTasks) await pool.query(`DELETE FROM task WHERE id = $1`, [id]).catch(() => {});
  if (ghostArea !== null) await pool.query(`DELETE FROM area WHERE id = $1`, [ghostArea]).catch((e) => console.error("area 정리 실패", e.message));
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const leftT = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const leftA = (await pool.query(`SELECT count(*)::int n FROM area WHERE name LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && leftT === beforeCount && leftA === 0;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${leftT}건 (시작 전 ${beforeCount}) · 영역 ${leftA}개${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  await browser?.close();
  await pool.end();
}
