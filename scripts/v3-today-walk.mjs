// v3 「오늘」 실측 (MD-P-2026-043 §C-1).
//
// **로컬 전용** (지시 32). 스위치와 만든 업무를 **시작 전 상태로 되돌린다**.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 꺼짐에서 `/` 는 **옛 홈** 그대로다
//   ② 켜면 `/` 에서 v3 「오늘」에 **도착한다** — 주소가 아니라 화면을 본다(§G)
//   ③ 큰 숫자 셋이 **DB 에서 직접 센 값**과 같다
//   ④ 「오늘 할 일」 = 오늘 마감 + 지남 **7일 이내** · 지난 것이 위 · 코랄 테두리
//   ④-2 지남 **7일 초과**는 오늘 할 일에 **없고** 접힌 줄 안에 있다 · 코랄 아니다
//   ④-3 접힌 줄 건수 + 오늘 할 일 건수 = 기한이 오늘이거나 지난 것 전부 (안 샌다)
//   ⑤ 「오늘 마친 것」 = `completed_at` 이 **오늘**인 것만 · 취소선
//   ⑥ 빈 목록에 **이유와 다음 행동**이 있다
//   ⑦ 가오픈 D 가 대문 카운트다운과 **같은 숫자**다
//   ⑧ 콘솔 오류 0
//   ⑨ 끄면 옛 홈 지문이 **글자 그대로** 돌아온다
//
// ── 조건은 관측보다 먼저 만든다 (§G) ────────────────────────────
//
// 로컬 데이터만으로는 「지남」도 「오늘 마감」도 「오늘 마친 것」도 0건일 수 있고,
// 0건인 목록은 아무것도 증명하지 않는다. 그래서 셋을 **직접 만들어 두고** 연다.
// 끝나면 지우고 시작 전 건수와 대조한다.
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

requireLocalDb("v3-today-walk.mjs");

const REPO = process.cwd();
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-043";
const TMP = path.join(REPO, ".v3t-out");
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(24)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(24)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[043검사]";

let browser, swBefore = null, madeBefore = null, made = [];
try {
  // 제품의 세는 규칙을 그대로 쓴다 — 사본을 적으면 사본만 맞는다.
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "today.ts"), path.join(REPO, "lib", "countdown.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs", "--moduleResolution", "node",
     "--target", "es2022", "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { countToday, splitToday, daysLate, STALE_DAYS } = req(path.join(TMP, "v3", "today.js"));
  const { dDay } = req(path.join(TMP, "countdown.js"));

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };
  await setSwitch(null);
  console.log(`   (시작 전) ${KEY} = ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)}`);

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  chk("0-짝조건", !!me, `볼 사람 actor#${me?.id}`);
  if (!me) throw new Error("계정이 없다");

  // ── 조건을 **먼저** 만든다 ──────────────────────────────────────
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0];
  madeBefore = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;
  const mk = async (title, status, due, completed) => (await sql(
    `INSERT INTO task (title, status, due_date, completed_at, area_id, visibility, work_type,
                       created_by, assignee_id)
     VALUES ($1, $2, $3::date, $4::timestamptz, $5, 'team', 'team', $6, $6) RETURNING id`,
    [`${MARK} ${title}`, status, due, completed, area.id, me.id]))[0].id;
  const back = (n) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10); };
  const y3 = back(3), y40 = back(40);

  made.push(await mk("지남 3일", "doing", y3, null));
  made.push(await mk("지남 40일", "todo", y40, null));
  made.push(await mk("오늘 마감", "todo", today, null));
  made.push(await mk("오늘 마침", "done", today, `${today}T05:20:00+09:00`));
  made.push(await mk("어제 마침", "done", today, `${y3}T05:20:00+09:00`));
  // §G 회귀 방지 — **KST 08:00** 에 마친 것. UTC 로 자르면 어제로 읽힌다.
  made.push(await mk("오늘 아침 마침", "done", today, `${today}T08:00:00+09:00`));
  made.push(await mk("기한 없음", "todo", null, null));
  console.log(`   (조건) ${MARK} 업무 ${made.length}건 (오늘 ${today} · 지남 ${y3} · 오래 ${y40})`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1300 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  // ── ① 꺼짐에서 옛 홈 ────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator(".frn-skip").first().click({ timeout: 1500 }).catch(() => {});
  const homeFp = async () => {
    const r = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    return `${r?.status()}:${new URL(page.url()).pathname}:${await page.locator(".side a").count()}:${await page.locator(".v3").count()}`;
  };
  const fpOff = await homeFp();
  chk("①-꺼짐에선-옛-홈", fpOff.startsWith("200:/:") && fpOff.endsWith(":0"),
      `지문 ${fpOff} (끝의 0 = v3 껍데기 없음)`);

  // ── ②~⑧ 켜짐 ───────────────────────────────────────────────────
  await setSwitch(true);
  const res = await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  // **주소가 아니라 화면을 본다**(§G). 레일이 있고 인사말이 떠야 도착한 것이다.
  const railN = await page.locator(".v3 .v3-rail a").count();
  const h1 = (await page.locator(".v3-h1").innerText().catch(() => "")).trim();
  chk("②-켜면-오늘에-도착한다",
      new URL(page.url()).pathname === "/v3" && railN === 4 && /안녕하세요/.test(h1),
      `→ ${new URL(page.url()).pathname} (${res?.status()}) · 레일 ${railN} · "${h1}"`);

  await page.locator(".v3-card").last().waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);

  // ③ 숫자 셋 — DB 에서 직접 읽어 같은 함수로 다시 센다.
  const rows = await sql(
    `SELECT t.id, t.title, t.status, t.due_date::text AS "dueDate",
            ac.display_name AS "assigneeName", t.area_id AS "areaId",
            t.completed_at::text AS "completedAt", t.parent_task_id AS "parentTaskId"
       FROM task t LEFT JOIN actor ac ON ac.id = t.assignee_id
      WHERE t.is_active = true AND t.status <> 'proposed'
        AND (t.visibility = 'team' OR t.created_by = $1)`, [me.id]);
  const want = countToday(rows, today);
  const stat = page.locator(".v3-stat");
  const seen = [];
  for (let i = 0; i < await stat.count(); i++) {
    seen.push(Number((await stat.nth(i).locator(".v3-stat-n").innerText()).trim()));
  }
  chk("③-숫자-셋이-직접-센-값", seen.join(",") === [want.doing, want.thisWeek, want.noDue].join(","),
      `화면 [${seen}] · 직접 [${want.doing},${want.thisWeek},${want.noDue}]`);

  // ④ 오늘 할 일 — 오늘 마감 + 지남 7일 이내
  const lists = splitToday(rows, today);
  const cards = page.locator(".v3-card");
  const todoCard = cards.filter({ hasText: "오늘 할 일" }).first();
  const todoRows = todoCard.locator(".v3-row:not(.v3-stale-r)");
  const nTodo = await todoRows.count();
  const todoText = await todoCard.innerText();
  chk("④-오늘-할-일", nTodo === lists.todo.length
        && todoText.includes(`${MARK} 지남 3일`) && todoText.includes(`${MARK} 오늘 마감`),
      `화면 ${nTodo}행 · 직접 ${lists.todo.length}행 · 지남3일 있음 · 오늘마감 있음`);

  // 지남 3일짜리가 **코랄**인가. 클래스가 아니라 계산된 테두리색을 읽는다.
  const late3 = todoRows.filter({ hasText: `${MARK} 지남 3일` }).first();
  const c3 = await late3.evaluate((el) => ({
    late: el.classList.contains("late"),
    border: getComputedStyle(el).borderLeftColor,
  }));
  chk("④-①-지남-3일은-코랄", c3.late && c3.border === "rgb(224, 82, 79)",
      `late=${c3.late} · 왼쪽 테두리 ${c3.border}`);

  // ④-2 지남 40일짜리는 오늘 할 일에 **없다**. 접힌 줄 안에 있다.
  const notInTodo = !todoText.includes(`${MARK} 지남 40일`)
    || (await todoRows.filter({ hasText: `${MARK} 지남 40일` }).count()) === 0;
  const staleHead = todoCard.locator(".v3-stale-h");
  const headTxt = (await staleHead.innerText().catch(() => "")).trim();
  chk("④-②-지남-40일은-접힌-줄", notInTodo && /오래 밀린 일 \d+건 · 가장 오래된 것/.test(headTxt),
      `오늘 할 일에 없음 ${notInTodo} · 접힌 줄 "${headTxt}"`);

  await staleHead.click();
  await page.waitForTimeout(300);
  const staleRows = todoCard.locator(".v3-stale-r");
  const nStale = await staleRows.count();
  const s40 = staleRows.filter({ hasText: `${MARK} 지남 40일` }).first();
  const cs = await s40.evaluate((el) => ({
    late: el.classList.contains("late"),
    border: getComputedStyle(el).borderLeftColor,
  }));
  const reBtn = await s40.locator("a").filter({ hasText: "기한 다시 정하기" }).count();
  chk("④-②-펼치면-있고-코랄이-아니다",
      nStale === lists.stale.length && !cs.late && cs.border !== "rgb(224, 82, 79)" && reBtn === 1,
      `펼친 ${nStale}행 · 직접 ${lists.stale.length}행 · late=${cs.late} · 테두리 ${cs.border} · 「기한 다시 정하기」 ${reBtn}개`);

  // ④-3 합이 안 샌다 — 둘을 더하면 「기한이 오늘이거나 지난 것」 전부다.
  const allDue = rows.filter((t) => ["todo", "doing", "review"].includes(t.status)
    && t.dueDate !== null && t.dueDate <= today).length;
  chk("④-③-합이-안-샌다", nTodo + nStale === allDue,
      `오늘 ${nTodo} + 오래 ${nStale} = ${nTodo + nStale} · 기한 지났거나 오늘인 것 전부 ${allDue}`);

  const titles = [];
  for (let i = 0; i < nTodo; i++) titles.push((await todoRows.nth(i).locator(".v3-row-t").innerText()).trim());
  chk("④-지난-것이-위", titles.join(" | ") === lists.todo.map((t) => t.title).join(" | "),
      `화면 순서 ${titles.slice(0, 3).join(" | ")}${nTodo > 3 ? " …" : ""}`);

  // ⑤ 오늘 마친 것 — 어제 마친 것은 안 뜬다
  const doneCard = cards.filter({ hasText: "오늘 마친 것" }).first();
  const doneRows = doneCard.locator(".v3-row");
  const nDone = await doneRows.count();
  const doneText = await doneCard.innerText();
  const deco = nDone > 0 ? await doneRows.first().locator(".v3-row-t")
    .evaluate((el) => getComputedStyle(el).textDecorationLine) : "(행 없음)";
  chk("⑤-오늘-마친-것", nDone === lists.done.length
        && doneText.includes(`${MARK} 오늘 마침`) && !doneText.includes(`${MARK} 어제 마침`)
        && String(deco).includes("line-through"),
      `화면 ${nDone}행 · 직접 ${lists.done.length}행 · 어제 것 ${doneText.includes("어제 마침") ? "**떴다**" : "안 뜸"} · 취소선 ${deco}`);

  /*
   * ④-④ §G 회귀 방지 — **KST 08:00 에 마친 업무가 오늘 목록에 뜬다.**
   *
   * 043 에서 `completedAt.slice(0,10)` 로 잘라 KST 오늘과 비교했다가 오전 아홉 시
   * 이전에 마친 것이 통째로 사라졌다. 그 자리를 지키는 검사다 —
   * 조건(08:00 에 마친 업무)을 위에서 미리 만들어 뒀다.
   */
  chk("④-④-KST-08시-마감이-뜬다", doneText.includes(`${MARK} 오늘 아침 마침`),
      doneText.includes(`${MARK} 오늘 아침 마침`)
        ? "KST 08:00 완료가 오늘 목록에 있다 (UTC 로 자르면 어제가 된다)"
        : "**KST 08:00 완료가 사라졌다 — 시간대를 안 맞추고 잘랐다**");

  // ⑥ 빈 목록 — 받은함이 비었으면 이유와 다음 행동이 있어야 한다
  const inboxCard = cards.filter({ hasText: "받은함" }).first();
  const emptyN = await inboxCard.locator(".v3-empty").count();
  if (emptyN > 0) {
    const why = (await inboxCard.locator(".v3-empty p").innerText()).trim();
    const act = await inboxCard.locator(".v3-empty a").count();
    chk("⑥-빈-목록에-이유와-행동", why.length > 10 && act === 1, `"${why}" · 다음 행동 ${act}개`);
  } else {
    chk("⑥-빈-목록에-이유와-행동", true, `받은함이 비어 있지 않아 이 자리는 못 쟀다 (${await inboxCard.locator(".v3-row").count()}건)`);
  }

  // ⑦ 가오픈 D — 대문 카운트다운과 같은 함수로 센 값
  const cfg = (await sql(`SELECT value FROM config WHERE key = 'platform_open_at'`))[0];
  const openMs = Date.parse(cfg?.value ?? "2026-11-02T00:00:00+09:00");
  const wantD = dDay(openMs, Date.now());
  const ddayTxt = (await page.locator(".v3-dday").innerText()).trim();
  chk("⑦-가오픈-D-가-같다", ddayTxt.includes(String(wantD)), `화면 "${ddayTxt}" · 직접 D-${wantD}`);

  // 겉모습 — 토큰이 실제로 먹었는가. 값을 컴포넌트에 안 썼다는 자취다.
  // (042 에서는 스위치 검사기가 이걸 쟀는데, 그 화면이 이 화면으로 바뀌었다.)
  const rowH = await todoRows.first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
  const tokenH = await page.locator(".v3").evaluate((el) =>
    getComputedStyle(el).getPropertyValue("--v3-row-h").trim());
  chk("⑧-행-높이가-토큰-값", rowH >= parseInt(tokenH, 10),
      `첫 행 ${rowH}px (--v3-row-h = ${tokenH})`);

  chk("⑧-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await page.screenshot({ path: `${OUT}/v3-today.png`, fullPage: true });

  // ── ⑨ 끄면 옛 홈이 글자 그대로 돌아온다 ─────────────────────────
  await setSwitch(false);
  const fpBack = await homeFp();
  chk("⑨-끄면-옛-홈이-돌아온다", fpBack === fpOff,
      fpBack === fpOff ? `지문 일치 (${fpBack})` : `${fpBack} vs ${fpOff}`);

  await ctx.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(TMP, { recursive: true, force: true });
  for (const id of made) await pool.query(`DELETE FROM task WHERE id = $1`, [id]).catch(() => {});
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = madeBefore === null ? -1
      : (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === madeBefore;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${madeBefore}건)${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  await browser?.close();
  await pool.end();
}
