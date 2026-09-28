// 대시보드 실측 (MD-P-2026-066 §D).
//
//   node scripts/dash-walk.mjs
//
// 지시서의 검사 둘과 그 조건들:
//   §D-35  세 숫자가 **각각 목록 화면에서 같은 조건으로 센 값**과 같다
//          — 대시보드가 따로 세면 언젠가 갈린다
//   §D-36  목표 진척이 집계 화면의 값과 **글자 그대로** 같다
//   §D-30  위 칸 셋 · **기한 지남만 색**
//   §D-31  내 업무 다섯 줄 · §B-4 「내 업무」는 `?mine=1` 이다
//   §D-34  근거 없는 숫자를 만들지 않는다 — 못 센 진척은 「—」다(0% 가 아니다)
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";
import { testUser } from "./test-user.mjs";

requireLocalDb("dash-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HOST = new URL(BASE).hostname;
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
const MARK = "[066검사]";
const ME = await testUser("admin");

/** 칸 하나를 이름으로 찾아 **숫자와 링크와 색**을 읽는다. */
const tile = async (page, label) => {
  const el = page.locator(".v3-stat").filter({ hasText: label }).first();
  if (!(await el.count())) return null;
  return el.evaluate((e) => ({
    // 070 §F-47 — 숫자가 세어 올라가는 중일 수 있다. 값은 `data-n` 에서 읽는다
    n: Number(e.querySelector(".v3-stat-n")?.getAttribute("data-n") ?? NaN),
    sub: (e.querySelector(".v3-stat-s")?.textContent ?? "").trim(),
    href: e.getAttribute("href"),
    color: getComputedStyle(e.querySelector(".v3-stat-n")).color,
  }));
};

let browser, swBefore = null, made = [], beforeCount = null;
try {
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  /*
   * ── 조건을 만든다 ───────────────────────────────────────────────
   *
   * 처음 돌렸을 때 「오늘 할 일 0 · 이번 주 마감 0」이었다. 0 과 0 을 맞춰 보는
   * 것은 **아무것도 안 잰 값**이다(§G 053) — 칸이 늘 0을 그려도 통과한다.
   * 그래서 오늘 마감 하나를 넣는다. 이 하나가 「오늘 할 일」과 「이번 주 마감」
   * 둘 다에 들어간다(오늘은 이번 주에 들어 있다).
   */
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  made.push((await sql(
    `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id)
     VALUES ($1, 'doing', $2::date, $3, 'team', 'team', $4, $4) RETURNING id`,
    [`${MARK} 오늘 마감`, today, areaId, ME.id]))[0].id);
  console.log(`   (조건) 오늘(${today}) 마감 업무 #${made[0]} 하나 — ③④ 가 0 대 0 이 아니게 된다`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1700 } });
  await ctx.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(ME) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    if (!ignoredWhy(line)) errs.push(line); });

  await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  /*
   * ── ① 위 칸 넷 · 기한 지남만 색 (071 §B-8 · §B-10) ────────────────
   * 066 §D-30 의 셋(오늘 할 일 · 기한 지남 · 이번 주 마감)이 071 에서 넷(진행 중 ·
   * 기한 지남 · 이번 주 마감 · 이번 달 완료)이 됐다. 「오늘 할 일」 칸은 **되살리지
   * 않는다**(072 §B) — 같은 이름의 카드가 아래에 있다. 카드는 ④ 가 본다.
   */
  const doing = await tile(page, "진행 중");
  const late = await tile(page, "기한 지남");
  const week = await tile(page, "이번 주 마감");
  const doneM = await tile(page, "이번 달 완료");
  const noTodoTile = await page.locator(".v3-stats .v3-stat").filter({ hasText: "오늘 할 일" }).count();
  chk("①-위-칸-넷이-있다", doing !== null && late !== null && week !== null && doneM !== null && noTodoTile === 0,
      `진행 중 ${doing?.n} · 기한 지남 ${late?.n} · 이번 주 마감 ${week?.n} · 이번 달 완료 ${doneM?.n}` +
      ` · 「오늘 할 일」 칸 ${noTodoTile}개(0 이어야 — 072 §B)`);
  /*
   * **색은 계산된 값으로 본다** — 클래스 이름으로 보면 CSS 가 안 먹어도 통과한다.
   * 무채색은 `--v3-ink`(#16203A) = rgb(22, 32, 58) 이다.
   */
  const GREY = "rgb(22, 32, 58)";
  chk("①짝-기한-지남만-색이다",
      late?.color !== GREY && [doing, week, doneM].every((t) => t?.color === GREY),
      `기한 지남 ${late?.color} · 진행 중 ${doing?.color} · 이번 주 마감 ${week?.color} · 이번 달 완료 ${doneM?.color} (무채색 ${GREY})`);

  /** 그 칸을 **눌러서** 도착한 목록의 행 수를 센다. 주소를 직접 치면 「같은 조건으로
      가는가」가 안 증명된다. */
  const rowsAfterClick = async (label) => {
    await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await page.locator(".v3-stat").filter({ hasText: label }).first().click();
    await page.waitForURL(/\/v3\/tasks/, { timeout: 9000 });
    await page.waitForTimeout(1100);
    const n = await page.locator('.v3-card a[href^="/v3/tasks/"]').count();
    return { n, url: new URL(page.url()).search };
  };

  // ── ② 기한 지남 · ③ 이번 주 마감 — 목록과 같은가 (§D-35) ────────
  const lateList = await rowsAfterClick("기한 지남");
  chk("②-기한-지남-=-목록", late.n === lateList.n && late.n > 0,
      `칸 ${late.n} · 목록 ${lateList.n} · 주소 ${decodeURIComponent(lateList.url)}` +
      `${late.n === 0 ? " — 0이면 아무것도 안 잰 값이다" : ""}`);
  const weekList = await rowsAfterClick("이번 주 마감");
  chk("③-이번-주-마감-=-목록", week.n === weekList.n && week.n > 0,
      `칸 ${week.n} · 목록 ${weekList.n} · 주소 ${decodeURIComponent(weekList.url)}`);

  /*
   * ── ④ 「오늘 할 일」 카드 — 제목 옆 건수 태그가 그 일을 한다 (072 §B-8) ──
   * 칸이 빠졌으니 건수는 카드 제목 옆 「n건」이 말한다. 그 n 이 카드의 줄 수와 같은가.
   */
  await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  const card = page.locator(".v3-card").filter({ has: page.locator("h2", { hasText: "오늘 할 일" }) }).first();
  const cardRows = await card.locator(".v3-row:not(.v3-stale-r)").count();
  const cardSub = (await card.locator(".v3-sub").first().textContent()) ?? "";
  const tagN = Number(cardSub.match(/^(\d+)건/)?.[1] ?? NaN);
  chk("④-오늘-할-일-건수-태그-=-카드", tagN === cardRows && cardRows > 0,
      `제목 옆 "${cardSub.trim().slice(0, 30)}" · 카드 ${cardRows}행`);

  // ── ⑤ 내 업무 다섯 줄 · 「내 업무」는 ?mine=1 (§D-31 · §B-4) ─────
  const mine = page.locator(".v3-card").filter({ has: page.locator("h2", { hasText: "내 업무" }) }).first();
  const mineRows = await mine.locator(".v3-row").count();
  const mineSub = (await mine.locator(".v3-sub").first().textContent()) ?? "";
  const more = mine.locator("a[href*='mine=1']");
  const moreN = await more.count();
  const dbMineOpen = (await sql(
    `SELECT count(*)::int n FROM task
      WHERE is_active AND status IN ('todo','doing','review') AND assignee_id = $1
        AND (visibility = 'team' OR created_by = $1)`, [ME.id]))[0].n;
  chk("⑤-내-업무-다섯-줄", mineRows === Math.min(5, dbMineOpen) && mineRows > 0,
      `${mineRows}줄 · 보조 "${mineSub.trim()}" · DB 내 미완료 ${dbMineOpen}건`);
  chk("⑤짝-더-보기가-?mine=1-로-간다", dbMineOpen <= 5 || moreN > 0,
      dbMineOpen <= 5 ? `내 업무 ${dbMineOpen}건이라 더 보기가 없다 (5건 넘어야 뜬다)`
                      : `더 보기 링크 ${moreN}개 — 「내 업무」는 목록의 ?mine=1 자리다`);

  // ── ⑥ 목표 진척이 집계 화면과 **글자 그대로** 같다 (§D-36) ──────
  const dash = await page.locator(".v3-goalrow").evaluateAll((els) => els.map((e) => ({
    title: (e.querySelector(".v3-goalrow-t")?.textContent ?? "").trim(),
    pct: (e.querySelector(".v3-goalrow-n")?.textContent ?? "").trim(),
  })));
  chk("⑥조건-분기-목표가-있다", dash.length > 0,
      `대시보드 분기 목표 ${dash.length}개 — 0이면 §D-36 은 아무것도 안 잰 값이다`);
  /*
   * 집계 쪽 값은 **제품에게 묻는다.** `/api/goals` 가 화면에 주는 그 값이다 —
   * 검사기가 진척을 따로 세면 제품이 쓰는 값과 갈라진다(v3-detail-walk 의 가오픈
   * 시각에서 같은 일을 겪었다).
   */
  const api = await page.evaluate(async () => {
    const d = await (await fetch("/api/goals")).json();
    const flat = [];
    const walk = (ns) => { for (const g of ns ?? []) { flat.push(g); walk(g.children); } };
    walk(d.tree);
    return flat.map((g) => ({ id: g.id, title: g.title, periodType: g.periodType,
                              progress: g.progress }));
  });
  const mismatch = dash.filter((d) => {
    const g = api.find((x) => x.title === d.title);
    if (!g) return true;
    const want = g.progress === null ? "—" : `${g.progress}%`;
    return want !== d.pct;
  });
  chk("⑥-목표-진척이-글자-그대로-같다", mismatch.length === 0,
      `${dash.map((d) => `${d.title.slice(0, 12)} ${d.pct}`).join(" · ")}` +
      `${mismatch.length ? ` — 다른 것 ${mismatch.map((m) => m.title).join(",")}` : ""}`);

  // ── ⑦ 못 센 진척은 「—」다 — 0% 가 아니다 (§D-34) ────────────────
  const nulls = api.filter((g) => g.periodType === "quarter" && g.progress === null);
  /*
   * **모양만 보면 안 된다.** 처음엔 `\d+%|—` 만 봤는데, 화면이 `progress ?? 0` 으로
   * 지어내게 깨뜨려도 「0%」는 그 모양에 맞아서 **초록으로 지나갔다.**
   * 못 센 목표는 **그 제목이** 「—」 여야 한다.
   */
  const faked = nulls
    .map((g) => dash.find((d) => d.title === g.title))
    .filter((d) => d !== undefined && d.pct !== "—");
  chk("⑦-0%-로-지어내지-않는다",
      dash.every((d) => /^(\d+%|—)$/.test(d.pct)) && faked.length === 0,
      `표기 [${dash.map((d) => d.pct).join(" · ")}] · DB 에서 못 센 분기 목표 ${nulls.length}개` +
      `${faked.length ? ` — 지어낸 것 ${faked.map((d) => `${d.title} ${d.pct}`).join(",")}` : ""}` +
      `${nulls.length === 0 ? " (못 센 목표가 0개라 이 줄은 모양만 봤다)" : ""}`);

  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
} catch (e) {
  fail += 1;
  console.error("\n넘어졌다 —", e.stack ?? e.message);
} finally {
  if (browser) await browser.close();
  for (const id of made) {
    await pool.query(`DELETE FROM activity_log WHERE task_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM task WHERE id = $1`, [id]).catch(() => {});
  }
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const ok = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) process.exitCode = 1;
}
