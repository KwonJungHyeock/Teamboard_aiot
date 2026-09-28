// 대시보드 타일 넷 · 영역별 남은 업무 실측 (MD-P-2026-071 §B).
//
// **로컬 전용.** 스위치와 **바꾼 값**을 전부 시작 전으로 되돌린다. 검사가 만든 업무·영역은
// `[071타일]` 로 시작하고 끝나면 지운다. 사람의 업무는 건드리지 않는다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   §B-17 타일 넷과 영역 막대의 숫자가 **각각 목록과 같은 id 집합**이다. 건수로 비교하지 않는다.
//         · 누르는 타일 셋 · 막대 줄 전부 — 눌러서 간 목록의 id 집합 = 제품 규칙(`lib/v3/dash.ts`)의 집합
//         · 「이번 달 완료」 — 누르는 곳이 없으므로 **DB 에 따로 물은 집합**과 맞춘다
//   §B-11 조건을 못 만드는 타일(이번 달 완료)은 **안 눌린다** — 링크가 아니다
//   §B-18 증감을 못 재는 타일 셋에는 증감이 **안 붙는다** · 이번 달 완료의 증감은 DB 로 센 값과 같다
//   §B-19 0 인 영역의 줄이 **남아 있다** — 흐린 글자 · 빈 막대
//   §B-10 기한 지남만 테두리 · 바탕 · 숫자가 지남 색, 나머지 셋은 무채색
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { testUser } from "./test-user.mjs";

requireLocalDb("v3-tiles-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3tiles-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };
const same = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const fmt = (s) => `{${[...s].sort((x, y) => x - y).join(",")}}`;

const KEY = "ui_v3_enabled";
const MARK = "[071타일]";

let browser, swBefore = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "dash.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const { dashTiles, areaBars } = createRequire(path.join(TMP, "noop.cjs"))(path.join(TMP, "v3", "dash.js"));

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);
  await sql(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]);
  await sql(`DELETE FROM area WHERE name LIKE $1`, [`${MARK}%`]);

  const me = await testUser("admin");
  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;

  /*
   * ── 조건을 만든다 ────────────────────────────────────────────────
   * · 진행 중 하나 — 「진행 중」이 0 이면 id 집합 비교가 공(空)끼리의 비교가 된다
   * · 이번 달에 마친 것 둘 · 지난달 같은 기간에 마친 것 하나 — 증감이 0 이 아니게
   * · **0 인 영역 하나** — 업무가 하나도 없는 영역을 만든다. 있는 영역의 업무를 치워서
   *   0 을 만들지 않는다(남의 업무를 건드린다)
   */
  const mk = async (title, status, completedSql = null) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active,
                       completed_at, resolution)
     VALUES ($1, '', $2, $3, $3, $4, NULL, 'mid', 'human', 'team', 'team', 'manual', true,
             ${completedSql ?? "NULL"}, ${completedSql ? "'done'" : "NULL"})
     RETURNING id`, [title, area, me.id, status]))[0].id;
  await mk(`${MARK} 진행`, "doing");
  // 이번 주 마감 하나 — 없으면 「이번 주 마감」 비교가 {} = {} 가 된다(071 첫 판에서 그랬다)
  const soonId = await mk(`${MARK} 이번 주`, "todo");
  await sql(`UPDATE task SET due_date = $2::date WHERE id = $1`, [soonId, today]);
  await mk(`${MARK} 이번 달 완료 1`, "done", "now()");
  await mk(`${MARK} 이번 달 완료 2`, "done", "now()");
  await mk(`${MARK} 지난달 완료`, "done", `((date_trunc('month', now() AT TIME ZONE 'Asia/Seoul') - interval '1 month') AT TIME ZONE 'Asia/Seoul')`);
  const zeroArea = (await sql(
    `INSERT INTO area (name, sort_order, is_active) VALUES ($1, 999, true) RETURNING id`,
    [`${MARK} 빈 영역`]))[0].id;

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: tok(me) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text().slice(0, 140)); });

  const open = async () => {
    await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    await page.locator(".v3-stats .v3-stat").nth(3).waitFor({ timeout: 15000 });
    await page.locator(".v3-abar").first().waitFor({ timeout: 15000 });
    await page.waitForTimeout(700);       // 숫자 세어 올리기가 끝나게
  };
  /** 목록 화면에 선 업무 id 들 */
  const listIds = async () => {
    await page.waitForURL(/\/v3\/tasks/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    /*
     * 목록이 **다 그려진 뒤에** 읽는다 — 줄이 섰거나 빈 목록 안내가 섰을 때.
     * 071 둘째 판에서 「플랫폼 6 · 목록 {}」가 한 번 나왔다. 첫 판은 같았고,
     * 목록이 아직 「불러오는 중」일 때 읽은 것이었다(제품이 아니라 읽는 때가 틀렸다).
     */
    await page.locator(".v3-row a.v3-row-t, .v3-empty").first().waitFor({ timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);
    return new Set(await page.evaluate(() => [...document.querySelectorAll(".v3-row a.v3-row-t")]
      .map((a) => Number((a.getAttribute("href") ?? "").match(/\/v3\/tasks\/(\d+)/)?.[1])).filter(Boolean)));
  };

  await open();
  const apiTasks = await page.evaluate(async () => (await (await fetch("/api/tasks")).json()).tasks);
  const apiAreas = await sql(`SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`);
  const rule = dashTiles(apiTasks, me.id, today);
  const ruleBars = areaBars(apiTasks, apiAreas, me.id, today);

  // ── 타일 넷 ────────────────────────────────────────────────────
  const tileView = await page.evaluate(() => [...document.querySelectorAll(".v3-stats .v3-stat")].map((t) => {
    const c = getComputedStyle(t), n = t.querySelector(".v3-stat-n");
    return { label: t.querySelector(".v3-stat-l")?.textContent ?? "", n: Number(n?.getAttribute("data-n")),
             link: t.tagName === "A", href: t.getAttribute("href"), sub: t.querySelector(".v3-stat-s")?.textContent ?? "",
             border: c.borderTopColor, bg: c.backgroundColor, color: getComputedStyle(n).color,
             late: t.classList.contains("late") };
  }));
  chk("B-8-타일-넷", tileView.length === 4 && rule.every((r, i) => tileView[i]?.label === r.label),
      tileView.map((t) => `${t.label} ${t.n}`).join(" · "));

  const res = [];
  for (let i = 0; i < rule.length; i += 1) {
    const r = rule[i], v = tileView[i];
    const want = new Set(r.ids);
    if (r.href === null) {
      // 누르는 곳이 없다 — DB 에 **따로** 물은 집합과 맞춘다(같은 규칙을 SQL 로 다시 적은 것)
      const db = new Set((await sql(
        `SELECT id FROM task WHERE is_active AND status = 'done'
            AND (visibility = 'team' OR created_by = $1)
            AND to_char(completed_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') = $2`, [me.id, today.slice(0, 7)])).map((x) => x.id));
      res.push({ label: r.label, n: v.n, got: db, want, ok: same(want, db) && v.n === want.size && !v.link, how: "DB" });
    } else {
      await open();
      await page.locator(".v3-stats .v3-stat").nth(i).click();
      const got = await listIds();
      res.push({ label: r.label, n: v.n, got, want, ok: same(want, got) && v.n === want.size && v.link, how: "목록" });
    }
  }
  chk("B-17-타일-넷-id-집합", res.every((x) => x.ok),
      res.map((x) => `${x.label}: 숫자 ${x.n} · 규칙 ${fmt(x.want)} · ${x.how} ${fmt(x.got)} ${x.ok ? "같다" : "**다르다**"}`).join(" / "));
  // 공집합끼리의 비교는 아무것도 안 잰다 — 넷 다 **하나 이상**을 센 판이어야 위 줄이 뜻을 갖는다
  chk("B-17짝-넷-다-비어-있지-않다", res.every((x) => x.want.size > 0),
      res.map((x) => `${x.label} ${x.want.size}`).join(" · "));
  chk("B-11-못-만드는-타일은-안-눌린다", tileView[3] && !tileView[3].link && tileView.slice(0, 3).every((t) => t.link),
      tileView.map((t) => `${t.label} ${t.link ? "링크" : "칸"}`).join(" · "));

  // ── 증감 ────────────────────────────────────────────────────────
  const [{ now: nowN, prev: prevN }] = await sql(
    `WITH k AS (SELECT (now() AT TIME ZONE 'Asia/Seoul')::date d)
     SELECT count(*) FILTER (WHERE to_char(completed_at AT TIME ZONE 'Asia/Seoul','YYYY-MM') = to_char(k.d,'YYYY-MM'))::int now,
            count(*) FILTER (WHERE (completed_at AT TIME ZONE 'Asia/Seoul')::date
                                   BETWEEN (date_trunc('month', k.d) - interval '1 month')::date
                                       AND LEAST((k.d - interval '1 month')::date,
                                                 (date_trunc('month', k.d) - interval '1 day')::date))::int prev
       FROM task, k WHERE is_active AND status = 'done' AND (visibility = 'team' OR created_by = $1)`, [me.id]);
  const d = nowN - prevN;
  const wantLine = d === 0 ? "변동 없음" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}`;
  const noDelta = tileView.slice(0, 3).filter((t) => /대비|▲|▼/.test(t.sub));
  chk("B-18-못-재는-자리엔-증감이-없다", noDelta.length === 0,
      tileView.slice(0, 3).map((t) => `${t.label} "${t.sub}"`).join(" · "));
  chk("B-9-이번-달-완료-증감", tileView[3].sub.startsWith(wantLine) && tileView[3].sub.includes("지난달 같은 기간 대비"),
      `화면 "${tileView[3].sub}" · DB 이번 달 ${nowN} − 지난달 같은 기간 ${prevN} = ${d}`);

  // ── 지남 색은 하나만 ────────────────────────────────────────────
  const lateT = tileView.find((t) => t.late), others = tileView.filter((t) => !t.late);
  const LATE = "rgb(224, 82, 79)", LATE_BG = "rgb(253, 237, 236)";
  chk("B-10-기한-지남만-지남-색", lateT && lateT.border === LATE && lateT.bg === LATE_BG && lateT.color === LATE
      && others.every((t) => t.border !== LATE && t.bg === "rgb(255, 255, 255)" && t.color !== LATE),
      `기한 지남 테두리 ${lateT?.border} · 바탕 ${lateT?.bg} · 숫자 ${lateT?.color} / 나머지 바탕 ` +
      [...new Set(others.map((t) => t.bg))].join(","));

  // ── 영역 막대 ───────────────────────────────────────────────────
  await open();
  const barView = await page.evaluate(() => [...document.querySelectorAll(".v3-abar")].map((b) => ({
    area: Number(b.getAttribute("data-area")), n: Number(b.getAttribute("data-n")), zero: b.classList.contains("zero"),
    name: b.querySelector(".v3-abar-l")?.textContent, fill: b.querySelector(".v3-bar span")?.getBoundingClientRect().width,
    color: getComputedStyle(b.querySelector(".v3-abar-n")).color,
    fillBg: getComputedStyle(b.querySelector(".v3-bar span")).backgroundColor })));
  const zero = barView.find((b) => b.area === zeroArea);
  chk("B-19-0-인-영역도-줄이-남는다", !!zero && zero.zero && zero.n === 0 && zero.fill === 0 && zero.color === "rgb(154, 164, 184)",
      zero ? `「${zero.name}」 ${zero.n}건 · 흐림 ${zero.zero} (${zero.color}) · 막대 ${zero.fill}px` : "**줄이 없다**");
  chk("B-13-막대-색은-하나", new Set(barView.filter((b) => b.n > 0).map((b) => b.fillBg)).size === 1,
      `채운 막대 색 [${[...new Set(barView.filter((b) => b.n > 0).map((b) => b.fillBg))].join(" · ")}] (영역 색이 아니다)`);
  const barRes = [];
  for (const rb of ruleBars) {
    await open();
    const v = barView.find((b) => b.area === rb.areaId);
    await page.locator(`.v3-abar[data-area="${rb.areaId}"]`).click();
    const got = await listIds();
    const want = new Set(rb.ids);
    barRes.push({ name: rb.name, n: v?.n, want, got, ok: same(want, got) && v?.n === want.size });
  }
  chk("B-17-영역-막대-id-집합", barRes.length === apiAreas.length && barRes.every((x) => x.ok),
      barRes.map((x) => `${x.name} ${x.n}${x.ok ? "" : ` **다르다** 규칙 ${fmt(x.want)} · 목록 ${fmt(x.got)}`}`).join(" · "));

  chk("콘솔-오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]).catch((e) => console.error("업무 정리 실패", e.message));
  await pool.query(`DELETE FROM area WHERE name LIKE $1`, [`${MARK}%`]).catch((e) => console.error("영역 정리 실패", e.message));
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`UPDATE config SET value = $2::jsonb WHERE key = $1`, [KEY, JSON.stringify(swBefore)]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const lt = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const la = (await pool.query(`SELECT count(*)::int n FROM area WHERE name LIKE $1`, [`${MARK}%`])).rows[0].n;
    const ok = JSON.stringify(now === undefined ? null : now.value) === JSON.stringify(swBefore) && lt === 0 && la === 0;
    console.log(`\n뒷정리 확인 — 스위치 ${now === undefined ? "(행 없음)" : JSON.stringify(now.value)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)}) · ${MARK} 업무 ${lt} · 영역 ${la}${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
  } catch (e) { console.error("뒷정리 실패 —", e.message); process.exitCode = 1; }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
