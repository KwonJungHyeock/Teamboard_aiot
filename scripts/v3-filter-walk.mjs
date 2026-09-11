// v3 「업무」 거르개 실측 (MD-P-2026-051 §B).
//
// **로컬 전용** (지시 32). 스위치와 만든 업무를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 조건 넷을 다 걸고 **새로고침해도 같은 결과** (전부 주소에 담긴다)
//   ② 조건 하나를 × 로 지우면 **그것만** 풀린다
//   ③ 결과 0건일 때 **걸린 조건이 보이고** 「조건 지우기」가 있다
//   ④ 검색과 칩을 함께 걸면 **교집합**이다 (합집합 아님)
//   ⑤ 축이 넷 + 검색뿐이다 — 우선순위·프로젝트·생성일 칸이 없다
//   ⑥ 콘솔 오류 0
//
// ③④ 의 조건은 **만들어서** 만든다 — 서로 안 겹치는 업무 둘을 넣는다.
// 그래야 「교집합이라 0건」과 「원래 0건」이 갈린다.
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

requireLocalDb("v3-filter-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3f-out");
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
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[051검사]";

let browser, swBefore = null, beforeCount = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "tasks.ts"), path.join(REPO, "lib", "v3", "today.ts"),
     path.join(REPO, "lib", "v3", "category.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { applyFilters, activeChips, EMPTY_QUERY, DUE_FILTERS, GROUPS } =
    req(path.join(TMP, "v3", "tasks.js"));

  // 짝조건 — **교집합인지 합집합인지**를 순수 함수에서 먼저 가른다.
  // 화면을 보기 전에 규칙 자체가 어느 쪽인지 값으로 확인한다.
  const sample = [
    { id: 1, title: "알파", status: "doing", dueDate: null, areaId: 1, assigneeId: 10,
      assigneeName: null, completedAt: null, parentTaskId: null, description: "" },
    { id: 2, title: "베타", status: "todo", dueDate: null, areaId: 2, assigneeId: 11,
      assigneeName: null, completedAt: null, parentTaskId: null, description: "" },
  ];
  const both = applyFilters(sample, { ...EMPTY_QUERY, who: new Set([10]), q: "베타" }, "2026-09-11");
  chk("0-짝조건-교집합이다", both.length === 0,
      `담당=10(알파) ∩ 검색="베타" → ${both.length}건 · 합집합이면 2건이 나온다` +
      ` · 축 ${DUE_FILTERS.length}가지 기한 · 상태 ${GROUPS.length}가지`);

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
  const people = await sql(
    `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`);
  const areas = await sql(`SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`);
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;

  /*
   * ── 조건을 만든다 ────────────────────────────────────────────────
   * 서로 **안 겹치는** 업무 둘. 하나는 나 담당·진행 중·기한 지남, 다른 하나는
   * 다른 사람 담당·할 일·기한 없음. ③④ 가 여기서 뜻을 갖는다.
   */
  const other = people.find((p) => p.id !== me.id) ?? people[0];
  const mk = async (title, status, due, who, areaId) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $6, $4, $5::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, areaId, who, status, due, me.id]))[0].id;

  const mine = await mk(`${MARK} 내 지난 것`, "doing", "2026-01-05", me.id, areas[0].id);
  const theirs = await mk(`${MARK} 남의 기한없는 것`, "todo", null, other.id, areas[1].id);
  chk("0-조건을-먼저-만들었다", people.length >= 2 && mine && theirs,
      `#${mine} 나(${me.id})·진행 중·2026-01-05 · #${theirs} 남(${other.id})·할 일·기한 없음` +
      ` · 오늘 ${today}`);

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  const titles = async () =>
    (await page.locator(".v3-row .v3-row-t").allInnerTexts()).map((t) => t.trim());
  const chipTexts = async () =>
    (await page.locator(".v3-acx").allInnerTexts()).map((t) => t.replace(/\s*×\s*$/, "").trim());

  // ── ⑤ 축이 넷 + 검색뿐 ─────────────────────────────────────────
  await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await page.locator(".v3-filters").waitFor({ timeout: 9000 });
  const axes = (await page.locator(".v3-fx-l").allInnerTexts()).map((t) => t.trim());
  const searchN = await page.locator(".v3-search").count();
  const banned = await page.locator(".v3-filters").innerText();
  chk("⑤-축이-넷-+-검색뿐",
      axes.join("|") === "담당|상태|기한" && searchN === 1
      && !/우선순위|프로젝트|생성일/.test(banned),
      `축 [카테고리(칩 줄) · ${axes.join(" · ")}] + 검색 ${searchN}칸` +
      ` · 금지어 ${/우선순위|프로젝트|생성일/.test(banned) ? "**있음**" : "없음"}`);

  // ── ① 조건 넷을 다 걸고 새로고침 ───────────────────────────────
  //
  // 화면에서 눌러서 건다 — 주소를 직접 치면 「주소를 읽는가」만 증명되고
  // 「누르면 주소에 담기는가」는 증명되지 않는다.
  const myName = people.find((p) => p.id === me.id).display_name;
  const mineAreaId = (await sql(`SELECT area_id FROM task WHERE id = $1`, [mine]))[0].area_id;
  const myArea = areas.find((a) => a.id === mineAreaId);
  // **실패를 삼키지 않는다.** 처음엔 담당 클릭에 `.catch(() => {})` 를 달아 뒀는데,
  // 그래서 「안 눌렸다」가 「안 걸렸다」로 조용히 넘어갔다.
  await page.locator(".v3-chips .v3-chip").filter({ hasText: myArea.name }).first().click();
  await page.locator(".v3-fx").filter({ hasText: "담당" })
    .locator(".v3-ichip").filter({ hasText: myName }).first().click();
  await page.locator(".v3-fx").filter({ hasText: "상태" })
    .locator(".v3-ichip").filter({ hasText: "진행 중" }).first().click();
  await page.locator(".v3-fx").filter({ hasText: "기한" })
    .locator(".v3-ichip").filter({ hasText: "지남" }).first().click();
  await page.locator(".v3-search").fill("지난 것");
  await page.waitForTimeout(900);

  const before = await titles();
  const url1 = new URL(page.url());
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".v3-filters").waitFor({ timeout: 9000 });
  await page.waitForTimeout(900);
  const after = await titles();
  const url2 = new URL(page.url());
  // 넷이 **다 담겼는지**까지 본다. 하나만 담겨도 「새로고침해도 같다」는 통과한다 —
  // 실제로 그렇게 통과했고, 연달아 누른 것이 덮어써지고 있었다.
  const has = ["cat", "who", "st", "due", "q"].filter((k) => url1.searchParams.has(k));
  chk("①-새로고침해도-같은-결과",
      before.join("|") === after.join("|") && url1.search === url2.search
      && has.length === 5,
      `주소 ${decodeURIComponent(url1.search)} · 담긴 축 ${has.length}/5 [${has.join(", ")}]` +
      ` · 새로고침 전 ${before.length}행 / 뒤 ${after.length}행` +
      ` [${after.map((t) => t.slice(0, 18)).join(" · ")}]`);

  // ── ④ 검색과 칩이 교집합 ───────────────────────────────────────
  //
  // 위 조건은 「내 지난 것」만 남긴다. 「남의 기한없는 것」은 **모든 축에서** 빠진다.
  chk("④-교집합이다",
      after.length === 1 && after[0].includes("내 지난 것"),
      `${after.length}행 [${after.join(" · ")}] — 합집합이면 「남의 기한없는 것」도 섞인다`);

  // ── ② × 하나로 그것만 풀린다 ───────────────────────────────────
  const chipsBefore = await chipTexts();
  const dueChip = page.locator(".v3-acx").filter({ hasText: "기한" }).first();
  await dueChip.click();
  await page.waitForTimeout(700);
  const chipsAfter = await chipTexts();
  const gone = chipsBefore.filter((c) => !chipsAfter.includes(c));
  const kept = chipsBefore.filter((c) => chipsAfter.includes(c));
  chk("②-×-는-그것만-푼다",
      gone.length === 1 && gone[0].startsWith("기한") && kept.length === chipsBefore.length - 1,
      `지워진 것 [${gone.join(", ")}] · 남은 것 [${kept.join(", ")}]`);

  // ── ③ 0건이면 걸린 조건 + 「조건 지우기」 ───────────────────────
  //
  // 조건을 만든다 — **교집합으로 반드시 0건이 되는** 조합.
  // 「내 지난 것」은 진행 중이고 「남의 기한없는 것」은 할 일이므로,
  // 담당=남 · 상태=진행 중 은 어느 쪽도 안 남긴다.
  await page.goto(`${BASE}/v3/tasks?who=${other.id}&st=doing&q=${encodeURIComponent(MARK)}`,
    { waitUntil: "networkidle" });
  await page.locator(".v3-empty").waitFor({ timeout: 9000 });
  const rows0 = await page.locator(".v3-row").count();
  const why = (await page.locator(".v3-empty p").innerText()).trim();
  const clearBtn = await page.locator(".v3-card .v3-btn").filter({ hasText: "조건 지우기" }).count();
  const zeroChips = await chipTexts();
  chk("③-0건이면-조건과-지우기",
      rows0 === 0 && clearBtn === 1 && zeroChips.length === 3
      && why.includes("담당") && why.includes("상태") && why.includes("검색"),
      `${rows0}행 · 「조건 지우기」 ${clearBtn}개 · 위 칩 [${zeroChips.join(" · ")}]` +
      ` · 이유 "${why.slice(0, 80)}"`);
  await page.screenshot({ path: `${OUT}/B-필터-0건.png`, fullPage: true });

  // 눌러서 실제로 풀리는지도 본다 — 버튼이 있는 것과 듣는 것은 다르다.
  await page.locator(".v3-card .v3-btn").filter({ hasText: "조건 지우기" }).first().click();
  await page.waitForTimeout(800);
  const backRows = await page.locator(".v3-row").count();
  const backChips = await chipTexts();
  chk("③짝-지우면-실제로-풀린다", backRows > 0 && backChips.length === 0,
      `푼 뒤 ${backRows}행 · 남은 조건 ${backChips.length}개 · 주소 ${new URL(page.url()).search || "(없음)"}`);

  chk("⑥-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
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
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
