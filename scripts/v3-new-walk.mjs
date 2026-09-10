// v3 「새 업무」 실측 (MD-P-2026-045 §B).
//
// **로컬 전용** (지시 32). 스위치와 **만든 업무**를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 카테고리 칸이 **area 수만큼** 있다 (넷이 아니다)
//   ② 카테고리를 안 고르면 **저장 못 하고 이유가 보인다**
//   ③ 제목 + 카테고리 **둘만으로 저장된다** (담당·기한 없이)
//   ④ 저장 후 **그 업무에 도착한다** — 주소가 아니라 화면을 본다(§G)
//   ⑤ 저장된 업무가 목록에 **그 카테고리로** 뜬다
//   ⑥ 기한 없음이 목록에서 **회색**으로 보인다
//      ⑥짝 **담당은 서버가 채운다** — 안 보내면 세션 사용자가 들어간다.
//           담당 없는 업무를 이 API 로는 만들 수 없다(발견 사항). 화면도 그렇게 말한다.
//   ⑦ **project 를 고르는 칸이 없다**
//   ⑧ 기록이 `description` 에 들어간다 (§B-1 — `body` 는 없는 컬럼이다)
//   ⑨ ⌘Enter 로도 저장된다
//   ⑩ 저장이 거부되면 **서버가 준 이유가 화면에 그대로** 나온다
//   ⑪ 콘솔 오류 0
//
// ⑩의 조건은 **만들어서** 만든다 — 제목을 200자 넘게? 그건 잘려서 통과한다.
// 대신 화면이 보내는 것과 같은 모양으로 **빈 제목**을 직접 POST 해 본다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-new-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-045";
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
const MARK = "[045검사]";

let browser, swBefore = null, beforeCount = null;
try {
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
  const areas = await sql(`SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`);
  chk("0-짝조건", areas.length > 4,
      `활성 area ${areas.length}개 — 넷보다 많아야 ①이 뜻을 가진다 (042 는 넷 고정이었다)`);

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  await page.locator(".frn-skip").first().click({ timeout: 1500 }).catch(() => {});
  await page.locator(".v3-title-in").waitFor({ timeout: 8000 });

  // ── ① 카테고리 칸이 area 수만큼 ────────────────────────────────
  const cats = page.locator(".v3-catbtn");
  const nCat = await cats.count();
  const catNames = [];
  for (let i = 0; i < nCat; i++) catNames.push((await cats.nth(i).innerText()).trim());
  chk("①-카테고리가-area-수만큼", nCat === areas.length
        && areas.every((a) => catNames.includes(a.name)),
      `칸 ${nCat}개 · area ${areas.length}개 [${catNames.join(" · ")}]`);

  // ── ⑦ project 고르는 칸이 없다 ─────────────────────────────────
  const body = await page.locator(".v3-card").innerText();
  const projSel = await page.locator("select, input").evaluateAll((els) =>
    els.filter((e) => /project|프로젝트/i.test(e.id + e.className + (e.getAttribute("aria-label") ?? ""))).length);
  chk("⑦-project-칸이-없다", !body.includes("프로젝트") && projSel === 0,
      `화면 글에 「프로젝트」 없음 · 관련 입력 ${projSel}개`);

  // ── ② 카테고리 안 고르면 저장 못 한다 · 이유가 보인다 ───────────
  await page.locator(".v3-title-in").fill(`${MARK} 제목만`);
  await page.waitForTimeout(200);
  const btn = page.locator(".v3-newfoot button");
  const why = (await page.locator(".v3-newwhy").innerText()).trim();
  chk("②-카테고리-없으면-못-저장", await btn.isDisabled() && why.includes("카테고리"),
      `저장 버튼 비활성 ${await btn.isDisabled()} · 이유 "${why}"`);

  // ── ③ 제목 + 카테고리 둘만으로 저장 ────────────────────────────
  const pickName = areas[0].name;
  await cats.filter({ hasText: pickName }).first().click();
  await page.waitForTimeout(200);
  const why2 = (await page.locator(".v3-newwhy").innerText()).trim();
  chk("③-둘만-채우면-누를-수-있다", !(await btn.isDisabled()) && !why2.includes("카테고리"),
      `저장 버튼 활성 · 옆 문구 "${why2}"`);

  await page.locator(".v3-note-in").fill(`${MARK} 기록이 여기 들어간다`);
  await btn.click();
  await page.waitForTimeout(1200);

  const made = (await sql(
    `SELECT id, title, description, area_id, project_id, due_date, assignee_id
       FROM task WHERE title LIKE $1 ORDER BY id DESC LIMIT 1`, [`${MARK}%`]))[0];

  /*
   * **도착을 화면으로 본다**(§G) — 그리고 **시간이 아니라 상태를 기다린다.**
   * 고정 900ms 로 뒀더니 「불러오는 중」에서 통과 판정을 시도했다.
   * 번호를 알아야 기다릴 수 있으므로 DB 조회를 먼저 한다.
   */
  //
  // 045 에서는 도착지가 **옛 패널**(`aside.tdp`)이었다. 046 §B-3 에서
  // `taskHref()` 가 새 상세로 옮겨 갔으므로 여기가 보는 화면도 옮긴다.
  // 묻는 것은 그대로 「그 업무에 도착했는가」다.
  if (made) {
    await page.locator(".v3-dmeta").filter({ hasText: `#${made.id}` })
      .first().waitFor({ timeout: 10000 }).catch(() => {});
  }
  chk("③-저장됐다", !!made && made.area_id === areas[0].id,
      made ? `#${made.id} "${made.title}" · area ${made.area_id} (${pickName})` : "**저장 안 됨**");

  const panel = (await page.locator(".v3-dmeta").first().innerText().catch(() => "")).replace(/\s+/g, " ");
  chk("④-저장-후-그-업무에-도착", made ? panel.includes(`#${made.id}`) : false,
      `${new URL(page.url()).pathname}${new URL(page.url()).search} · 상세 줄 "${panel.slice(0, 60)}"`);

  // ── ⑧ 기록이 description 에 ────────────────────────────────────
  chk("⑧-기록은-description-에", made?.description?.includes("기록이 여기 들어간다") === true,
      `description = "${(made?.description ?? "").slice(0, 40)}" (컬럼 body 는 없다)`);
  chk("⑦짝-project-가-비어-있다", made?.project_id === null,
      `project_id = ${made?.project_id} · due_date = ${made?.due_date} · assignee = ${made?.assignee_id}`);

  // ── ⑤⑥ 목록에서 그 카테고리로 · 회색 ──────────────────────────
  await page.goto(`${BASE}/v3/tasks?cat=${areas[0].id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const row = page.locator(".v3-row").filter({ hasText: `${MARK} 제목만` }).first();
  const seen = await row.count();
  const dueTxt = (await row.locator(".v3-due").innerText().catch(() => "")).trim();
  const dueColor = await row.locator(".v3-due").evaluate((el) => getComputedStyle(el).color).catch(() => "");
  const avNone = await row.locator(".v3-av.none").count();
  chk("⑤-목록에-그-카테고리로-뜬다", seen === 1, `?cat=${areas[0].id} 에서 ${seen}행`);
  chk("⑥-기한-없음이-회색",
      dueTxt === "기한 없음" && dueColor === "rgb(154, 164, 184)",
      `기한 "${dueTxt}" ${dueColor}`);
  /*
   * ⑥짝 — **담당 없는 업무를 이 API 로는 만들 수 없다.**
   *
   * `POST /api/tasks` 가 `assigneeId` 를 안 보내면 세션 사용자를 넣는다.
   * 「안 정함」을 고를 수 있게 두면 화면이 거짓말을 하게 되므로, 화면은
   * 기본값을 나로 두고 그 사실을 적는다. 여기서는 **그렇게 저장됐는지**를 잰다.
   *
   * 담당 없음 자리(`.v3-av.none`)는 046 §0 에서 아예 거뒀다 — 이 셈은 이제
   * 「0이어야 한다」가 아니라 「그 표시가 없다」를 확인하는 자리다.
   */
  chk("⑥짝-담당은-서버가-채운다", made?.assignee_id === me.id && avNone === 0,
      `담당 = actor#${made?.assignee_id} (세션 ${me.id}) · 담당 없음 자리 ${avNone}개`);

  // ── ⑨ ⌘Enter ──────────────────────────────────────────────────
  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  await page.locator(".v3-title-in").waitFor({ timeout: 8000 });
  await page.locator(".v3-title-in").fill(`${MARK} 단축키`);
  await page.locator(".v3-catbtn").filter({ hasText: areas[0].name }).first().click();
  await page.locator(".v3-title-in").press("Control+Enter");
  await page.waitForTimeout(1600);
  const made2 = (await sql(
    `SELECT id FROM task WHERE title = $1`, [`${MARK} 단축키`]))[0];
  chk("⑨-단축키로도-저장", !!made2, made2 ? `#${made2.id} 저장됨` : "**저장 안 됨**");

  // ── ⑩ 거부되면 서버가 준 이유가 그대로 ─────────────────────────
  //
  // 조건을 만든다 — 화면이 보내는 것과 **같은 모양**으로 제목만 비워 보낸다.
  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  const rej = await page.evaluate(async () => {
    const r = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", areaId: 1, description: "" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  chk("⑩-거부-이유가-서버-그대로", rej.status >= 400 && typeof rej.body?.error === "string",
      `POST ${rej.status} · "${rej.body?.error}" — 화면은 이 문구를 그대로 낸다`);

  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  await page.locator(".v3-title-in").waitFor({ timeout: 8000 });
  await page.locator(".v3-title-in").fill(`${MARK} 캡처용`);
  await page.locator(".v3-catbtn").filter({ hasText: areas[0].name }).first().click();
  // 접힌 입력 칩. 046 §A 에서 `.v3-chip.dashed`(거르개) 와 갈라져 `.v3-ichip` 가 됐다.
  await page.locator(".v3-ichip").filter({ hasText: "기한" }).first().click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/v3-new.png`, fullPage: true });

  chk("⑪-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
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
  await browser?.close();
  await pool.end();
}
