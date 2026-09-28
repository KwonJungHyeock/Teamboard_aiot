// 필수 아홉과 전면 전환 실측 (MD-P-2026-067 §A).
//
//   node scripts/nine-walk.mjs
//
//   §A-1  아홉은 열리고 나머지는 전부 막음 화면인 것 — **개수로**
//   §A-2  **v3 안에서 옛 화면이 열리는 자리 0개** — 이게 「전면 전환」의 숫자다
//   §0-4  레일 세 묶음 · 자물쇠가 **남아 있는** 것
//
// 아홉도 막는 목록도 **제품에게 묻는다**(`lib/v3/nine.ts` · `not-yet.ts` 를
// 컴파일해서 읽는다). 검사기가 목록을 손으로 들고 있으면, 화면이 서서 목록에서
// 줄이 빠진 날 검사기만 옛 목록으로 초록에 남는다(§G 048).
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

requireLocalDb("nine-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HOST = new URL(BASE).hostname;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TMP = "/tmp/nine-walk";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(32)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(32)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[067검사]";
const ME = await testUser("admin");

let browser, swBefore = null, made = [], beforeCount = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "nine.ts"), path.join(REPO, "lib", "v3", "not-yet.ts"),
     path.join(REPO, "lib", "v3", "routes.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { NINE, RAIL } = req(path.join(TMP, "v3", "nine.js"));
  const { NOT_YET } = req(path.join(TMP, "v3", "not-yet.js"));

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  /*
   * 074 §A-8 — **열 번째**가 더해졌다: 새 화면 스위치(`/v3/switch`). 끄는 길이 없는 스위치는
   * 켤 수 없어서 가오픈 필수에 넣었다. 아홉 + 하나 = 열. 목록은 여전히 제품에게 묻는다.
   */
  chk("0조건-아홉이-아홉이다", NINE.length === 10 && NINE.some((s) => s.key === "switch"),
      `${NINE.map((s) => `${s.n}${s.label}`).join(" · ")}`);

  // 상세(3번)는 **업무 하나가 있어야** 열린다. 조건을 만든다.
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const one = (await sql(
    `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id)
     VALUES ($1, 'doing', $2::date, $3, 'team', 'team', $4, $4) RETURNING id`,
    [`${MARK} 상세로 열 업무`, today, areaId, ME.id]))[0].id;
  made.push(one);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(ME) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    if (!ignoredWhy(line)) errs.push(line); });

  /** 그 주소를 열고 **어디에 섰는지**를 돌려준다. 주소만 보면 튕긴 것을 못 본다. */
  const visit = async (url) => {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const u = new URL(page.url());
    return { status: res.status(), path: u.pathname, search: u.search };
  };

  // ── ① 아홉이 **다 열린다** (§A-1) ─────────────────────────────
  const opened = [];
  const shut = [];
  for (const s of NINE) {
    const url = s.prefix && s.key === "detail" ? `/v3/tasks/${one}` : s.path;
    const r = await visit(url);
    // 「열렸다」 = 200 이고 **막음 화면이 아니다.**
    const ok = r.status === 200 && r.path !== "/v3/not-yet";
    (ok ? opened : shut).push(`${s.n}${s.label}${ok ? "" : `(${r.status} ${r.path})`}`);
  }
  chk("①-아홉이-열린다", opened.length === NINE.length,
      `열림 ${opened.length}/${NINE.length} [${opened.join(" · ")}]` +
      `${shut.length ? ` · **막힘 ${shut.length}** [${shut.join(" · ")}]` : ""}`);

  // ── ② 아홉 밖의 v3 주소는 **전부** 막음 화면 (§0-2 · §A-1) ─────
  //    화면이 있는 것(캘린더)과 없는 것(아무 말)을 **둘 다** 본다.
  const OUTSIDE = ["/v3/calendar", "/v3/projects", "/v3/areas", "/v3/없는화면", "/v3/settings"];
  const notBlocked = [];
  for (const u of OUTSIDE) {
    const r = await visit(u);
    if (!(r.status === 200 && r.path === "/v3/not-yet")) notBlocked.push(`${u}→${r.status} ${r.path}`);
  }
  chk("②-아홉-밖은-전부-막음", notBlocked.length === 0,
      `${OUTSIDE.length}곳 중 막힌 곳 ${OUTSIDE.length - notBlocked.length}` +
      `${notBlocked.length ? ` · **안 막힌 것** [${notBlocked.join(" · ")}]` : ""} (404 가 아니라 200 이다)`);

  // ── ③ v3 안에서 **옛 화면이 열리는 자리 0개** (§A-2) ───────────
  /*
   * 아홉을 하나씩 열어 **모든 링크의 목적지**를 센다. v3 밖으로 나가는 것이
   * 하나라도 있으면 그게 「전면 전환」이 아직 아닌 자리다.
   *
   * 빼는 것: `/api/*`(내려받기·로그아웃 같은 것) · 바깥 주소 · `#`.
   * **옛 화면 경로는 안 뺀다** — 그걸 세는 것이 이 줄의 일이다.
   */
  const leaks = [];
  for (const s of NINE) {
    const url = s.prefix && s.key === "detail" ? `/v3/tasks/${one}` : s.path;
    const r = await visit(url);
    if (r.path === "/v3/not-yet") continue;   // 아직 안 선 화면은 ① 이 이미 빨갛다
    const hrefs = await page.locator("a[href]").evaluateAll((els) => els.map((e) => e.getAttribute("href")));
    for (const h of hrefs) {
      if (!h || h.startsWith("#") || h.startsWith("http") || h.startsWith("mailto:")) continue;
      if (h.startsWith("/api/")) continue;
      if (h.startsWith("/v3")) continue;
      leaks.push(`${s.label}→${h}`);
    }
  }
  chk("③-v3-안에서-옛-화면-0개", leaks.length === 0,
      `옛 화면으로 나가는 링크 ${leaks.length}개${leaks.length ? ` [${[...new Set(leaks)].join(" · ")}]` : ""}` +
      ` — 이게 「전면 전환」의 숫자다`);

  // ── ④ 레일 세 묶음 · 자물쇠가 남아 있다 (§0-4 · 066 §B-8) ──────
  await visit("/v3");
  const groups = await page.locator(".v3-rail .v3-railg-t").allTextContents();
  const locks = await page.locator(".v3-rail .v3-navlink.lock").allTextContents();
  const wantLocks = RAIL.flatMap((g) => g.items.filter((i) => i.lock).map((i) => i.label));
  chk("④-레일-세-묶음", groups.map((t) => t.trim()).join("|") === "개인|업무|관리",
      `[${groups.map((t) => t.trim()).join(" · ")}]`);
  chk("④짝-자물쇠가-남는다",
      wantLocks.every((l) => locks.some((t) => t.includes(l))) && locks.length === wantLocks.length,
      `레일 자물쇠 [${locks.map((t) => t.replace(/\s+/g, "").replace("🔒", "")).join(" · ")}]` +
      ` · 있어야 할 것 [${wantLocks.join(" · ")}]`);

  // ── ⑤ 막는 목록이 아홉과 **안 겹친다** ────────────────────────
  //     겹치면 「열려 있어야 하는데 막음 목록에도 있는」 화면이 생긴다.
  const clash = NOT_YET.filter((s) => NINE.some((n) => n.key === s.key));
  chk("⑤-아홉과-막는-목록이-안-겹친다", clash.length === 0,
      `막는 목록 ${NOT_YET.length}개 · 겹치는 것 ${clash.length}개` +
      `${clash.length ? ` [${clash.map((c) => c.label).join(",")}]` : ""}`);

  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
} catch (e) {
  fail += 1;
  console.error("\n넘어졌다 —", e.stack ?? e.message);
} finally {
  rmSync(TMP, { recursive: true, force: true });
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
