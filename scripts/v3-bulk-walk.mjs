// v3 「업무」 여러 건 한 번에 + 되돌리기 실측 (MD-P-2026-057 §B).
//
// **로컬 전용** (지시 32). 만든 것과 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 세 건 골라 기한을 바꾸면 **세 건 다** 바뀐다
//   ② 되돌리기를 누르면 **세 건이 각자 원래 값으로** 돌아간다 (같은 값 아님)
//   ③ 한 건이 400 을 받으면 **나머지는 적용되고** 실패 건수와 사유가 보인다
//   ④ 안내 줄은 **6초 뒤에도 그대로** 있다
//   ⑤ 아무것도 안 골랐을 때 작업 줄이 **없다**
//   ⑥ `x` 로도 고른다 · 입력 칸에서는 안 걸린다 (조건을 먼저 만든다)
//   ⑦ 새 API 를 안 만들었다 — 부른 곳이 전부 `PATCH /api/tasks/{id}` 다
//   ⑧ 콘솔 오류 0
//
// ── ② 의 조건 ────────────────────────────────────────────────────
//
// 세 건의 기한을 **서로 다르게** 만들어 둔다. 셋이 같은 값이면 「각자 원래
// 값으로」가 「전부 같은 값으로」와 구별되지 않는다 — 통과해도 아무것도 안 잰다
// (§G 054).
//
// ── ③ 의 조건 ────────────────────────────────────────────────────
//
// 400 을 **제품의 규칙으로** 만든다. 라우트는 시작일 > 마감일이면 400 을 낸다
// (046 §B-1 에서 대조한 그 규칙). 그래서 한 건에만 **먼 미래의 시작일**을
// 심어 두고 과거 기한으로 바꾸면, 그 건만 거부되고 나머지는 들어간다.
// 네트워크를 가로채 만든 가짜 400 이 아니다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";   // 캡처는 SHOT=1 일 때만 (057 §0)

requireLocalDb("v3-bulk-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3b-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-057";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[057묶음]";

let browser, swBefore = null, beforeCount = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "bulk.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { patchFor, undoPatch, needsChange, resultNote, emptyResult } =
    req(path.join(TMP, "v3", "bulk.js"));

  /*
   * 짝조건 — **되돌리기 몸통이 건마다 다르다.** 규칙 자체를 먼저 묻는다.
   * 화면을 열기 전에 여기서 걸리면 화면 탓이 아니다.
   */
  const b1 = { id: 1, title: "a", status: "todo", assigneeId: null, dueDate: "2026-01-01" };
  const b2 = { id: 2, title: "b", status: "doing", assigneeId: 3, dueDate: null };
  chk("0-짝조건-되돌리기가-건마다-다르다",
      undoPatch(b1, "due").dueDate === "2026-01-01" && undoPatch(b2, "due").dueDate === ""
      && patchFor({ field: "due", value: null }).dueDate === ""
      && needsChange(b1, { field: "due", value: "2026-02-02" }) === true
      && needsChange(b1, { field: "due", value: "2026-01-01" }) === false
      && resultNote(emptyResult("due")) === "기한 — 바꿀 것이 없었습니다",
      `되돌리기 [${JSON.stringify(undoPatch(b1, "due"))} · ${JSON.stringify(undoPatch(b2, "due"))}]` +
      ` — 기한 없던 건은 ""(지우기)로 돌아간다 · 이미 그 값이면 안 보낸다`);

  /*
   * ⑦ 새 API 를 안 만들었다 — **소스로** 확인한다.
   * 화면이 어디를 부르는지는 눌러 봐서 아는 것보다 코드를 세는 것이 정확하다.
   */
  const view = readFileSync(path.join(REPO, "components/v3/TasksView.tsx"), "utf-8");
  const calls = [...view.matchAll(/fetch\(\s*[`"']([^`"'$]*)/g)].map((m) => m[1]);
  const apiFiles = execFileSync("git", ["ls-files", "app/api"], { encoding: "utf-8" })
    .split("\n").filter((f) => f.includes("bulk") || f.includes("batch"));
  chk("⑦-새-API-를-안-만들었다",
      calls.every((c) => c === "/api/tasks" || c === "/api/tasks/") && apiFiles.length === 0,
      `부르는 곳 [${calls.join(" · ")}] — 목록 읽기와 건별 PATCH 뿐 · ` +
      `bulk/batch 라우트 ${apiFiles.length}개`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;

  /*
   * ── 조건을 먼저 만든다 ──────────────────────────────────────────
   *
   * 기한이 **서로 다른** 세 건. ② 가 뜻을 가지려면 셋이 달라야 한다.
   * 그리고 넷째 — 시작일이 먼 미래라 기한을 당기면 **400 이 나는** 건(③).
   */
  const mk = async (title, due, start = null) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       start_date, priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $3, 'todo', $4::date, $5::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, areaId, me.id, due, start]))[0].id;

  const DUES = ["2026-03-03", "2026-04-04", "2026-05-05"];
  const ids = [];
  for (let i = 0; i < 3; i += 1) ids.push(await mk(`${MARK} 셋 ${i}`, DUES[i]));
  // 넷째 — 시작일 2027-01-01. 기한을 2026-12-24 로 당기면 시작일>마감일이라 400.
  const badId = await mk(`${MARK} 시작일이먼것`, "2027-06-06", "2027-01-01");

  chk("0-조건을-먼저-만들었다",
      new Set(DUES).size === 3,
      `기한이 서로 다른 세 건 [${DUES.join(" · ")}] — 같으면 ②가 「각자 원래 값」을 못 잰다` +
      ` · 시작일 2027-01-01 인 넷째(${badId})는 기한을 당기면 제품 규칙으로 400 이 난다`);

  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  /*
   * ③ 이 **일부러** 400 을 만든다. 그때 브라우저가 「Failed to load resource …
   * 400」을 콘솔에 적는 것은 고장이 아니라 우리가 만든 조건이다. 그래서 그
   * 구간에서만, 그 문장만 따로 센다 — 400 전부를 눈감으면 진짜 400 도 놓친다.
   */
  let expect400 = false;
  const errs = [], wanted = [];
  const take = (t) => {
    if (expect400 && /Failed to load resource.*400/.test(t)) { wanted.push(t); return; }
    errs.push(t);
  };
  page.on("pageerror", (e) => take(e.message));
  page.on("console", (m) => { if (m.type() === "error") take(m.text()); });

  /** 검사용 세 건만 보이게 거른다 — 다른 업무를 건드리지 않는다. */
  const goList = async (q = MARK) => {
    await page.goto(`${BASE}/v3/tasks?q=${encodeURIComponent(q)}`, { waitUntil: "networkidle" });
    await page.locator(".v3-row").first().waitFor({ timeout: 9000 });
  };
  const rowOf = (id) => page.locator(`.v3-row:has(a[href="/v3/tasks/${id}"])`);
  const dbDue = async (id) => (await sql(`SELECT due_date::text d FROM task WHERE id = $1`, [id]))[0].d;

  await goList();

  // ── ⑤ 아무것도 안 골랐을 때 작업 줄이 없다 ────────────────────
  chk("⑤-안-고르면-작업-줄이-없다", (await page.locator(".v3-bulk").count()) === 0,
      `작업 줄 ${await page.locator(".v3-bulk").count()}개 (0이라야 한다 — 흐리게 두면 고장으로 읽힌다)`);

  // ── ⑥ `x` 로도 고른다 · 입력 칸에서는 안 걸린다 ────────────────
  {
    await rowOf(ids[0]).locator(".v3-row-t").focus();
    await page.keyboard.press("x");
    const one = await page.locator(".v3-row.picked").count();

    /*
     * 짝조건 — 검색 칸에서 x 는 **글자로 들어가고** 고르기를 안 건드린다.
     *
     * 처음엔 검색어에 x 를 붙여 두고 쟀다가 틀렸다. 검색이 바뀌면 그 행이
     * 목록에서 빠지고, 화면은 **제대로** 안 보이는 행의 선택을 푼다 — 내가
     * 만든 적 없는 고장을 잰 것이었다. 그래서 x 를 쳤다가 곧바로 지운다.
     * 검색은 300ms 뒤에 주소로 가므로 그 사이에 지우면 거르개는 그대로다.
     */
    const search = page.locator(".v3-search");
    await search.click();
    await search.press("x");
    const typed = await search.inputValue();
    await search.press("Backspace");
    await page.waitForTimeout(450);
    const still = await page.locator(".v3-row.picked").count();
    chk("⑥-x-로도-고른다", one === 1 && typed.endsWith("x") && still === one,
        `행에 초점 두고 x → 고른 행 ${one}개 · 검색 칸에서 x → 칸 값 "${typed}" (글자가 들어갔다) · ` +
        `고른 행 그대로 ${still}개 (단축키가 입력을 잡아먹으면 고장이다)`);
    await goList();   // 다시 읽어 선택을 비운다 — 눌러서 지우면 ⑥이 실패했을 때 같이 죽는다
  }

  // ── ① 세 건 골라 기한을 바꾸면 세 건 다 바뀐다 ─────────────────
  const NEW_DUE = "2026-10-10";
  {
    for (const id of ids) await rowOf(id).locator(".v3-pick").check();
    const n = await page.locator(".v3-bulk-n").innerText();
    await page.locator('.v3-bulk-f input[type="date"]').fill(NEW_DUE);
    await page.locator(".v3-bulkr").waitFor({ timeout: 15000 });
    const db = [];
    for (const id of ids) db.push(await dbDue(id));
    const note = (await page.locator(".v3-bulkr-t").innerText()).trim();
    chk("①-세-건-다-바뀐다",
        n.trim() === "3건 선택" && db.every((d) => d === NEW_DUE),
        `"${n.trim()}" → 화면 "${note}" · DB [${db.join(" · ")}] (셋 다 ${NEW_DUE} 이라야 한다)`);
    await shot(page, { path: `${OUT}/B-바꾼뒤.png`, fullPage: true });
  }

  // ── ④ 안내 줄은 6초 뒤에도 그대로 ─────────────────────────────
  {
    const before = (await page.locator(".v3-bulkr-t").innerText()).trim();
    await page.waitForTimeout(6200);
    const after = (await page.locator(".v3-bulkr").count()) === 1
      ? (await page.locator(".v3-bulkr-t").innerText()).trim() : "(사라짐)";
    chk("④-안내-줄이-6초-뒤에도-있다", after === before,
        `6초 전 "${before}" → 6초 뒤 "${after}" · 닫기 버튼 ` +
        `${await page.locator(".v3-bulkr-x").count()}개 (눌러야 없어진다)`);
  }

  // ── ② 되돌리면 각자 원래 값으로 ────────────────────────────────
  {
    await page.locator(".v3-bulkr button", { hasText: "되돌리기" }).click();
    await page.waitForTimeout(2500);
    const db = [];
    for (const id of ids) db.push(await dbDue(id));
    const same = db.every((d, i) => d === DUES[i]);
    const allEqual = new Set(db).size === 1;
    chk("②-각자-원래-값으로",
        same && !allEqual,
        `DB [${db.join(" · ")}] · 원래 [${DUES.join(" · ")}] — ` +
        `${same ? "각자 제 값으로 돌아왔다" : "안 맞는다"} · 셋이 같은 값이 아니다(${!allEqual})`);
  }

  // ── ③ 한 건이 400 이어도 나머지는 적용된다 ─────────────────────
  {
    await page.locator(".v3-bulkr-x").click();          // 결과 줄 닫고 다시
    await goList();
    expect400 = true;
    for (const id of [...ids, badId]) await rowOf(id).locator(".v3-pick").check();
    const PULL = "2026-12-24";                           // 넷째의 시작일(2027-01-01)보다 이르다
    await page.locator('.v3-bulk-f input[type="date"]').fill(PULL);
    await page.locator(".v3-bulkr").waitFor({ timeout: 15000 });
    const okDb = [];
    for (const id of ids) okDb.push(await dbDue(id));
    const badDb = await dbDue(badId);
    const note = (await page.locator(".v3-bulkr-t").innerText()).trim();
    const why = (await page.locator(".v3-bulkr-why").allInnerTexts()).map((t) => t.trim());
    chk("③-한-건-실패해도-나머지는-간다",
        okDb.every((d) => d === PULL) && badDb === "2027-06-06"
        && note.includes("3건 바꿨습니다") && note.includes("1건은 안 됐습니다")
        && why.length === 1 && why[0].includes("시작일"),
        `성공 [${okDb.join(" · ")}] · 실패한 건 DB ${badDb}(그대로) · ` +
        `화면 "${note}" · 사유 "${why[0] ?? "(없음)"}"`);
    await shot(page, { path: `${OUT}/B-일부실패.png`, fullPage: true });

    // 뒷정리 — 되돌려 놓는다. 검사기가 남긴 값으로 다음 검사기가 틀리면 안 된다.
    await page.locator(".v3-bulkr button", { hasText: "되돌리기" }).click();
    await page.waitForTimeout(2500);
    expect400 = false;

    // 짝조건 — 우리가 만든 400 이 **실제로 났는가**. 0이면 ③ 은 400 없이
    // 통과한 것이고, 그럼 「실패해도 나머지는 간다」가 아무것도 안 잰 것이다.
    chk("③짝-400-이-실제로-났다", wanted.length >= 1,
        `우리가 만든 400 ${wanted.length}건 (1건 이상이라야 ③ 이 뜻을 가진다)`);
  }

  chk("⑧-콘솔오류", errs.length === 0,
      `${errs.length}건${errs.length ? ` [${errs[0]}]` : ""}` +
      ` (③ 이 일부러 만든 400 ${wanted.length}건은 따로 셌다)`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  try {
    await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]);
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    console.log(`\n뒷정리 확인 — 스위치 ${now ? JSON.stringify(now.value) : "(행 없음)"}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
    await browser?.close();
    await pool.end();
  }
}
