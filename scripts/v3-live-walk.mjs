// 대시보드 인터랙션 실측 (MD-P-2026-070 §A~§F).
//
// **로컬 전용.** 스위치와 **바꾼 값**을 전부 시작 전으로 되돌린다. 검사가 만든 업무는
// `[070검사]` 로 시작하고 끝나면 지운다. 사람의 업무·권한은 건드리지 않는다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//  §A 토스트 · 낙관적 업데이트
//   A-5  화면이 **먼저** 바뀐다 — 요청을 1.5초 붙잡아 두고, 그동안 줄이 이미 바뀌었고
//        DB 는 아직 안 바뀌었는지 본다
//   A-8  실패(500) — 줄이 **원래 값으로 돌아오고**(DOM) · 「저장하지 못했습니다 · 다시」 ·
//        DB 는 그대로 · 「다시」를 누르면 저장된다
//   A-9  되돌리기 — DB 가 원래 값으로
//   A-10 토스트 수명 — 버튼 있음 5초 · 없음 2.6초 (화면 안에서 붙은 순간·떨어진 순간을 잰다)
//   A-3  확인 창(dialog) 0번
//
//  §B 줄에서 바로
//   B-21 체크 → done · 해제 → todo (DB)
//   B-22 상태 넷을 하나씩 → DB 가 네 번 다 따라온다 · 고르개 넷 · ✓ · Esc · 바깥
//   B-23 빠른 동작 — 평소 0개 · 호버 3개 · 누르면 토스트
//   B-24 위 넷을 **일부러 깨서** 빨개지는지 (요청을 가짜 200 으로 삼키기 · 칸을 억지로 보이기)
//
//  §C 키보드   J×5 → 다섯째 줄 · X → DB · E → 고르개 · 입력칸 안의 j 는 글자 · 칩 다섯 ·
//              탭은 파란 테두리 · 마우스는 없음
//  §D ⌘K      14% · 흐림 · 묶음 · 없으면 「‘q’로 새 업무 만들기」 맨 위 · ↑↓ · 마우스 · ↵ →
//              토스트 · 닫으면 포커스를 뗀다(J 가 먹는다) · 아랫줄 글
//  §E 타일    누르면 그 조건의 목록 — **id 집합**이 같다 · 호버 「목록 →」 · 1px
//  §F 움직임  0.13초 한 곳 · 세어 올리기 · reduce 면 전부 꺼진다
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

requireLocalDb("v3-live-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3live-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[070검사]";

let browser, swBefore = null, beforeCount = null;
try {
  /* ── 제품의 규칙을 그대로 부른다 ─────────────────────────────── */
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "live.ts"), path.join(REPO, "lib", "v3", "list-query.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { TOAST_UNDO_MS, TOAST_PLAIN_MS, STATUS_PICK, SHORTCUTS, FAIL_LINE, changedLine } = req(path.join(TMP, "v3", "live.js"));
  const { parseListQuery, selectRows } = req(path.join(TMP, "v3", "list-query.js"));

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);
  await sql(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]);
  beforeCount = 0;

  const me = await testUser("admin");
  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  const mk = async (title, due, status = "todo") => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $3, $4, $5::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, area, me.id, status, due]))[0].id;
  // 오늘 마감 셋 — 「오늘 할 일」·「내 업무」에 선다
  const ids = [];
  for (let i = 1; i <= 3; i += 1) ids.push(await mk(`${MARK} 줄 ${i}`, today));
  // 이틀 지난 것 여섯 — 「기한 지남」 숫자가 세어 올라가는 것을 보려면 1 보다 커야 한다(§F-47)
  for (let i = 1; i <= 6; i += 1) await mk(`${MARK} 지난 ${i}`, null);
  await sql(`UPDATE task SET due_date = ($1::date - 2) WHERE title LIKE $2`, [today, `${MARK} 지난%`]);
  const statusOf = async (id) => (await sql(`SELECT status FROM task WHERE id = $1`, [id]))[0]?.status;
  /** DB 가 그 값이 될 때까지 (최대 6초). 된 값을 돌려준다 — 안 되면 마지막 값 */
  const dbWait = async (id, want, ms = 6000) => {
    const t0 = Date.now(); let v;
    while (Date.now() - t0 < ms) { v = await statusOf(id); if (v === want) return v; await sleep(150); }
    return v;
  };
  const setDb = (id, s) => sql(`UPDATE task SET status = $2, completed_at = CASE WHEN $2 = 'done' THEN now() END,
                                  resolution = CASE WHEN $2 = 'done' THEN 'done' END WHERE id = $1`, [id, s]);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const mkCtx = async (opt = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...opt });
    await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: tok(me) }]);
    return ctx;
  };
  const ctx = await mkCtx();
  const page = await ctx.newPage();
  const errs = [], dialogs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => {
    const t = m.text();
    if (m.type() !== "error") return;
    // 이 검사기가 **일부러** 만든 500 은 따로 센다
    if (/Failed to load resource.*500/.test(t)) return;
    errs.push(t.slice(0, 140));
  });
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });

  /** 대시보드를 열고 줄이 설 때까지. 토스트 수명 기록기를 심는다 */
  const open = async () => {
    await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    await page.locator("[data-live-row]").first().waitFor({ timeout: 15000 });
    await page.evaluate(() => {
      const host = document.querySelector(".v3-toasts");
      window.__toasts = [];
      const born = new Map();
      new MutationObserver((ms) => {
        for (const m of ms) {
          m.addedNodes.forEach((n) => born.set(n, performance.now()));
          m.removedNodes.forEach((n) => {
            const t = born.get(n);
            if (t !== undefined) window.__toasts.push({ text: n.textContent, ms: performance.now() - t,
              ms0: Number(n.getAttribute("data-toast-ms")) });
          });
        }
      }).observe(host, { childList: true });
    });
    await page.mouse.move(2, 2);
  };
  const todayCard = () => page.locator("section.v3-card").filter({ has: page.locator("h2", { hasText: /^오늘 할 일$/ }) });
  const rowOf = (id) => todayCard().locator(`[data-live-row="${id}"]`).first();
  const isDoneRow = (id) => rowOf(id).evaluate((el) => el.classList.contains("done"));
  const lastToast = () => page.locator(".v3-toast").last();

  await open();

  // ══ §A 낙관적 업데이트 · 토스트 ═════════════════════════════════
  const A = ids[0];
  // A-5 화면 먼저 — PATCH 를 1.5초 붙잡는다
  await page.route("**/api/tasks/*", async (r) => {
    if (r.request().method() === "PATCH") { await sleep(1500); await r.continue(); } else await r.continue();
  });
  await rowOf(A).locator(".v3-cb").click();
  await sleep(200);
  const earlyDom = await isDoneRow(A), earlyDb = await statusOf(A);
  const toastTxt = (await lastToast().innerText().catch(() => "")).replace(/\s+/g, " ");
  const want = changedLine("done", `${MARK} 줄 1`);
  const lateDb = await dbWait(A, "done");
  await page.unroute("**/api/tasks/*");
  chk("A-5-화면이-먼저-바뀐다", earlyDom && earlyDb === "todo" && lateDb === "done",
      `누르고 0.2초: 줄 done=${earlyDom} · DB ${earlyDb} (요청을 붙잡아 둠) → 풀고 나서 DB ${lateDb}`);
  chk("A-4-문구가-무엇이-어떻게", toastTxt.startsWith(`${want.strong}${want.rest}`) && toastTxt.includes("되돌리기"),
      `토스트 "${toastTxt}"`);

  // A-9 되돌리기
  await lastToast().locator("button", { hasText: "되돌리기" }).click();
  const undoDb = await dbWait(A, "todo");
  const undoDom = await isDoneRow(A);
  chk("A-9-되돌리기가-원래대로", undoDb === "todo" && undoDom === false,
      `되돌리기 → DB ${undoDb} · 줄 done=${undoDom}`);

  // A-8 실패 흐름 — 요청이 500 을 내게 만든다
  await page.route("**/api/tasks/*", async (r) => {
    if (r.request().method() === "PATCH") await r.fulfill({ status: 500, contentType: "application/json", body: "{}" });
    else await r.continue();
  });
  await rowOf(A).locator(".v3-cb").click();
  const failToast = page.locator(".v3-toast").filter({ hasText: FAIL_LINE });
  const sawFail = await failToast.first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  const failDom = await isDoneRow(A);
  const failDb = await statusOf(A);
  const failTxt = sawFail ? (await failToast.first().innerText()).replace(/\s+/g, " ") : "(없음)";
  chk("A-8-실패면-줄이-돌아오고-알린다", sawFail && failDom === false && failDb === "todo" && failTxt.includes("다시"),
      `500 → 줄 done=${failDom}(원래 false) · DB ${failDb} · 토스트 "${failTxt}"`);
  await page.unroute("**/api/tasks/*");
  await failToast.first().locator("button", { hasText: "다시" }).click();
  const retryDb = await dbWait(A, "done");
  chk("A-7-다시를-누르면-저장된다", retryDb === "done", `「다시」 → DB ${retryDb}`);
  await setDb(A, "todo");

  /*
   * A-10 토스트 수명 — **아무도 안 누른 토스트**만 잰다. 위에서 생긴 것들은
   * 「되돌리기」·「다시」를 눌러서(또는 실패로 바뀌어서) 일찍 떨어진 것이라 수명이 아니다.
   * 새 화면에서 둘을 만들고 손대지 않는다: 체크(버튼 있음) · 빠른 동작(버튼 없음).
   */
  await open();
  await page.evaluate(() => { window.__toasts = []; });
  await rowOf(A).locator(".v3-cb").click();
  await dbWait(A, "done");
  await rowOf(A).locator(".v3-row-main").hover();
  await rowOf(A).locator(".v3-quick-b").first().click();
  await page.mouse.move(2, 2);
  await sleep(TOAST_UNDO_MS + 800);
  const lives = await page.evaluate(() => window.__toasts);
  await setDb(A, "todo");
  const withBtn = lives.filter((l) => l.ms0 === 5000), plain = lives.filter((l) => l.ms0 === 2600);
  const near = (xs, ms) => xs.length > 0 && xs.every((l) => Math.abs(l.ms - ms) < 350);
  chk("A-10-5초·2.6초에-사라진다", near(withBtn, TOAST_UNDO_MS) && near(plain, TOAST_PLAIN_MS),
      `버튼 있음 ${withBtn.map((l) => Math.round(l.ms)).join("·")}ms · 없음 ${plain.map((l) => Math.round(l.ms)).join("·")}ms`);

  // ══ §B 줄에서 바로 ═════════════════════════════════════════════
  await open();
  const B = ids[1];
  // B-21 체크 → done · 해제 → todo
  await rowOf(B).locator(".v3-cb").click();
  const b1 = await dbWait(B, "done");
  const struck = await rowOf(B).evaluate((el) => ({
    op: getComputedStyle(el).opacity, line: getComputedStyle(el.querySelector(".v3-row-t")).textDecorationLine }));
  await rowOf(B).locator(".v3-cb").click();
  const b2 = await dbWait(B, "todo");
  chk("B-21-체크-done·해제-todo", b1 === "done" && b2 === "todo",
      `체크 → DB ${b1} · 해제 → DB ${b2}`);
  chk("B-12-취소선·0.42", struck.op === "0.42" && struck.line.includes("line-through"),
      `바뀐 줄 불투명도 ${struck.op} · 제목 ${struck.line}`);

  // B-22 상태 넷
  const chip = () => rowOf(B).locator("[data-live-chip]");
  const cvHidden = await chip().locator(".v3-stchip-cv").evaluate((e) => getComputedStyle(e).display);
  await chip().hover();
  const cvHover = await chip().locator(".v3-stchip-cv").evaluate((e) => getComputedStyle(e).display);
  const seq = [];
  for (const s of [...STATUS_PICK.slice(1), STATUS_PICK[0]]) {    // 진행 → 검토 → 완료 → 미착수
    await chip().click();
    const pick = page.locator(".v3-stpick");
    await pick.waitFor({ timeout: 3000 });
    const opts = await pick.locator("[role=option]").allInnerTexts();
    const cur = await statusOf(B);
    const checked = await pick.locator("[role=option][aria-selected=true]").innerText();
    await pick.locator("[role=option]").filter({ hasText: s.label }).click();
    const got = await dbWait(B, s.key);
    const closed = await pick.count() === 0;
    seq.push({ want: s.key, got, n: opts.length, tick: checked.includes("✓") && checked.includes(STATUS_PICK.find((p) => p.key === cur).label), closed });
  }
  chk("B-22-상태-넷이-DB-로", seq.length === 4 && seq.every((x) => x.got === x.want && x.n === 4 && x.tick && x.closed),
      seq.map((x) => `${x.want}→${x.got}${x.tick ? "" : "(✓없음)"}${x.closed ? "" : "(안닫힘)"}`).join(" · ") + ` · 줄 ${seq[0]?.n}개`);
  // 닫기 — Esc · 바깥
  await chip().click(); await page.locator(".v3-stpick").waitFor();
  await page.keyboard.press("Escape");
  const escClosed = await page.locator(".v3-stpick").count() === 0;
  await chip().click(); await page.locator(".v3-stpick").waitFor();
  await page.mouse.click(700, 20);
  const awayClosed = await page.locator(".v3-stpick").count() === 0;
  chk("B-16-Esc·바깥이면-닫힌다", escClosed && awayClosed, `Esc ${escClosed} · 바깥 ${awayClosed}`);
  chk("B-17-⌄-는-올렸을-때만", cvHidden === "none" && cvHover !== "none", `평소 display ${cvHidden} · 올리면 ${cvHover}`);

  // B-23 빠른 동작 — 평소 0 · 호버 3
  await open();
  const visibleQuick = () => page.evaluate(() => [...document.querySelectorAll(".v3-quick-b")]
    .filter((b) => getComputedStyle(b.closest(".v3-quick")).opacity === "1").length);
  await page.mouse.move(2, 2); await sleep(300);
  const q0 = await visibleQuick();
  await rowOf(ids[2]).locator(".v3-row-main").hover(); await sleep(300);
  const q1 = await visibleQuick();
  const qw = await rowOf(ids[2]).locator(".v3-quick").evaluate((e) => e.getBoundingClientRect().width);
  await rowOf(ids[2]).locator(".v3-quick-b").first().click();
  const soonTxt = (await lastToast().innerText().catch(() => "")).replace(/\s+/g, " ");
  chk("B-23-빠른동작-평소0·호버3", q0 === 0 && q1 === 3 && Math.round(qw) === 84,
      `평소 ${q0}개 · 올리면 ${q1}개 · 열 폭 ${Math.round(qw)}px`);
  chk("B-20-누르면-다음-회차", /다음 회차/.test(soonTxt), `토스트 "${soonTxt}"`);

  // B-24 **일부러 깬다** — 요청을 가짜 200 으로 삼키면 DB 가 안 따라와야 하고, 위 단언은 그걸 잡아야 한다
  await open();
  await page.route("**/api/tasks/*", async (r) => {
    if (r.request().method() === "PATCH") await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    else await r.continue();
  });
  const C = ids[2];
  await rowOf(C).locator(".v3-cb").click();
  const brk1 = await dbWait(C, "done", 1500);            // 삼켰으니 todo 그대로여야
  // 해제를 삼키려면 먼저 **진짜로** 체크해 둔다(새로 열면 끝난 줄은 목록에 안 선다)
  await page.unroute("**/api/tasks/*");
  await open();
  await rowOf(C).locator(".v3-cb").click();
  await dbWait(C, "done");
  await page.route("**/api/tasks/*", async (r) => {
    if (r.request().method() === "PATCH") await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    else await r.continue();
  });
  await rowOf(C).locator(".v3-cb").click();
  const brk2 = await dbWait(C, "todo", 1500);             // 삼켰으니 done 그대로여야
  await page.unroute("**/api/tasks/*");
  await setDb(C, "todo"); await open();
  await page.route("**/api/tasks/*", async (r) => {
    if (r.request().method() === "PATCH") await r.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    else await r.continue();
  });
  await rowOf(C).locator("[data-live-chip]").click();
  await page.locator(".v3-stpick [role=option]").filter({ hasText: STATUS_PICK[2].label }).click();
  const brk3 = await dbWait(C, STATUS_PICK[2].key, 1500);
  await page.unroute("**/api/tasks/*");
  await open();
  await page.addStyleTag({ content: ".v3-quick{opacity:1!important}" });
  await page.mouse.move(2, 2); await sleep(300);
  const brk4 = await visibleQuick();
  chk("B-24-깨면-빨개진다(넷)",
      brk1 !== "done" && brk2 !== "todo" && brk3 !== STATUS_PICK[2].key && brk4 !== 0,
      `체크를 삼킴 → DB ${brk1}(B-21 은 done 을 요구) · 해제를 삼킴 → DB ${brk2}(todo 요구) · ` +
      `고르기를 삼킴 → DB ${brk3}(${STATUS_PICK[2].key} 요구) · 칸을 억지로 보임 → 평소 ${brk4}개(0 요구)`);
  await setDb(C, "todo");

  // ══ §C 키보드 ══════════════════════════════════════════════════
  await open();
  const keysTxt = await page.locator(".v3-keys .v3-key").allInnerTexts();
  chk("C-28-단축키-칩-다섯", SHORTCUTS.every((s) => keysTxt.some((t) => t.includes(s.label))) && keysTxt.length === SHORTCUTS.length,
      keysTxt.map((t) => t.replace(/\s+/g, "")).join(" · "));
  for (let i = 0; i < 5; i += 1) await page.keyboard.press("j");
  const selInfo = await page.evaluate(() => {
    const rs = [...document.querySelectorAll("[data-live-row]")];
    return { n: rs.length, at: rs.findIndex((r) => r.getAttribute("data-sel") === "1"),
             id: Number(rs.find((r) => r.getAttribute("data-sel") === "1")?.getAttribute("data-live-row")),
             inView: (() => { const r = rs.find((x) => x.getAttribute("data-sel") === "1")?.getBoundingClientRect();
               return !!r && r.top >= 0 && r.bottom <= innerHeight; })() };
  });
  chk("C-31-J-다섯-번-다섯째-줄", selInfo.at === 4 && selInfo.inView, `줄 ${selInfo.n}개 중 ${selInfo.at + 1}번째 · 화면 안 ${selInfo.inView}`);
  const xBefore = await statusOf(selInfo.id);
  await page.keyboard.press("x");
  const xAfter = await dbWait(selInfo.id, xBefore === "done" ? "todo" : "done");
  await page.keyboard.press("x");
  const xBack = await dbWait(selInfo.id, xBefore === "done" ? "done" : "todo");
  chk("C-31-X-상태가-바뀐다", xAfter !== xBefore && xBack === (xBefore === "done" ? "done" : "todo"),
      `#${selInfo.id} ${xBefore} → X → ${xAfter} → X → ${xBack}`);
  await page.keyboard.press("e");
  const eOpen = await page.locator(".v3-stpick").isVisible().catch(() => false);
  await page.keyboard.press("Escape");
  const eClosed = await page.locator(".v3-stpick").count() === 0;
  await page.keyboard.press("k");
  const kAt = await page.evaluate(() => [...document.querySelectorAll("[data-live-row]")].findIndex((r) => r.getAttribute("data-sel") === "1"));
  chk("C-25-E·Esc·K", eOpen && eClosed && kAt === 3, `E → 고르개 ${eOpen} · Esc → 닫힘 ${eClosed} · K → ${kAt + 1}번째`);
  // C-30 입력칸 안의 j 는 글자다
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "__t"; document.querySelector(".v3-live").prepend(i); });
  await page.locator("#__t").focus();
  const selB = kAt;
  await page.keyboard.type("jkx");
  const typed = await page.locator("#__t").inputValue();
  const selA = await page.evaluate(() => [...document.querySelectorAll("[data-live-row]")].findIndex((r) => r.getAttribute("data-sel") === "1"));
  await page.evaluate(() => document.getElementById("__t")?.remove());
  chk("C-30-입력칸의-j-는-글자", typed === "jkx" && selA === selB, `입력칸 "${typed}" · 고른 줄 ${selB + 1} → ${selA + 1}`);
  // C-29 탭은 파란 테두리 · 마우스는 없음
  await open();
  await page.locator("[data-live-chip]").first().focus();
  await page.keyboard.press("Tab");
  const tabRing = await page.evaluate(() => { const a = document.activeElement; const c = getComputedStyle(a);
    return `${c.outlineStyle} ${c.outlineWidth} ${c.outlineColor}`; });
  await page.mouse.click(2, 2);
  const firstChip = page.locator("[data-live-chip]").first();
  await firstChip.click();
  const mouseRing = await firstChip.evaluate((a) => getComputedStyle(a).outlineStyle);
  await page.keyboard.press("Escape");
  chk("C-29-탭만-파란-테두리", tabRing.startsWith("solid 2px rgb(47, 95, 232)") && mouseRing === "none",
      `탭 → ${tabRing} · 마우스 → ${mouseRing}`);

  // ══ §D ⌘K ═════════════════════════════════════════════════════
  await open();
  await page.keyboard.press("Control+k");
  const find = page.locator(".v3-find");
  await find.waitFor({ timeout: 3000 });
  const geo = await page.evaluate(() => {
    const f = document.querySelector(".v3-find").getBoundingClientRect();
    const s = getComputedStyle(document.querySelector(".v3-find-scrim"));
    return { top: f.top, want: innerHeight * 0.14, blur: s.backdropFilter, bg: s.backgroundColor,
             focus: document.activeElement?.className };
  });
  const groups = await page.locator(".v3-find-gt").allInnerTexts();
  const foot = (await page.locator(".v3-find-foot").innerText()).replace(/\s+/g, " ");
  chk("D-32·36-자리·흐림·아랫줄", Math.abs(geo.top - geo.want) < 2 && /blur/.test(geo.blur) && geo.focus === "v3-find-in"
      && foot.includes("↑↓ 이동") && foot.includes("↵ 열기") && foot.includes("esc 닫기"),
      `위 ${Math.round(geo.top)}px (14% = ${Math.round(geo.want)}) · ${geo.blur} · 포커스 ${geo.focus} · "${foot}"`);
  chk("D-33-묶음-제목", ["업무", "화면", "동작"].every((g) => groups.includes(g)), `묶음 [${groups.join(" · ")}]`);
  await page.keyboard.type("zzqq없는말");
  const firstOpt = (await page.locator(".v3-find [role=option]").first().innerText()).trim();
  chk("D-35-없으면-새-업무-만들기", firstOpt === "‘zzqq없는말’로 새 업무 만들기", `맨 위 "${firstOpt}"`);
  await page.locator(".v3-find-in").fill(`${MARK} 줄`);
  const sel0 = await page.locator(".v3-find [aria-selected=true]").innerText();
  await page.keyboard.press("ArrowDown");
  const sel1 = await page.locator(".v3-find [aria-selected=true]").innerText();
  await page.locator(".v3-find [role=option]").nth(2).hover();
  const sel2 = await page.locator(".v3-find [aria-selected=true]").innerText();
  chk("D-34-↑↓·마우스로-고른다", sel0 !== sel1 && sel2.trim() === (await page.locator(".v3-find [role=option]").nth(2).innerText()).trim(),
      `처음 "${sel0}" → ↓ "${sel1}" → 마우스 "${sel2}"`);
  await page.keyboard.press("Enter");
  const findGone = await find.count() === 0;
  const openToast = (await lastToast().innerText().catch(() => "")).replace(/\s+/g, " ");
  const active = await page.evaluate(() => document.activeElement?.tagName);
  await page.keyboard.press("j");
  const jAfter = await page.evaluate(() => [...document.querySelectorAll("[data-live-row]")].findIndex((r) => r.getAttribute("data-sel") === "1"));
  chk("D-38·39-닫고-포커스를-뗀다", findGone && /다음 회차/.test(openToast) && active === "BODY" && jAfter === 0,
      `↵ → 닫힘 ${findGone} · 토스트 "${openToast}" · 포커스 ${active} · 그다음 j → ${jAfter + 1}번째 줄`);

  // ══ §E 타일 → 목록 ═════════════════════════════════════════════
  await open();
  const tiles = page.locator(".v3-stat.act");
  const nTiles = await tiles.count();
  await tiles.first().hover(); await sleep(300);
  const hov = await tiles.first().evaluate((t) => ({
    go: getComputedStyle(t.querySelector(".v3-stat-go")).opacity, tf: getComputedStyle(t).transform,
    txt: t.querySelector(".v3-stat-go")?.textContent }));
  chk("E-42-목록→·1px", hov.go === "1" && /matrix\(1, 0, 0, 1, 0, -1\)/.test(hov.tf) && hov.txt === "목록 →",
      `「${hov.txt}」 불투명도 ${hov.go} · ${hov.tf}`);
  const apiTasks = await page.evaluate(async () => (await (await fetch("/api/tasks")).json()).tasks);
  const tileRes = [];
  for (let i = 0; i < nTiles; i += 1) {
    await open();
    const t = page.locator(".v3-stat.act").nth(i);
    const href = await t.getAttribute("href");
    const n = Number(await t.locator(".v3-stat-n").getAttribute("data-n"));
    const label = await t.locator(".v3-stat-l").innerText();
    const q = parseListQuery(new URLSearchParams(href.split("?")[1] ?? ""));
    const want = new Set(selectRows(apiTasks, q, me.id, today).map((r) => r.id));
    await t.click();
    await page.waitForURL(/\/v3\/tasks/, { timeout: 10000 });
    await page.waitForLoadState("networkidle");
    /*
     * 목록이 **다 그려진 뒤에** 읽는다 — 줄이 섰거나 빈 목록 안내가 섰을 때.
     * 071 재는 판에서 「이번 주 마감 규칙 3 · 목록 0」이 한 번 나왔다. 목록이 아직
     * 「불러오는 중」일 때 읽은 것이다 — v3-tiles-walk 에서 먼저 찾은 것과 같은 자리.
     */
    await page.locator(".v3-row a.v3-row-t, .v3-empty").first().waitFor({ timeout: 15000 }).catch(() => {});
    await sleep(300);
    const got = new Set(await page.evaluate(() => [...document.querySelectorAll(".v3-row a.v3-row-t")]
      .map((a) => Number((a.getAttribute("href") ?? "").match(/\/v3\/tasks\/(\d+)/)?.[1])).filter(Boolean)));
    const same = want.size === got.size && [...want].every((x) => got.has(x));
    tileRes.push({ label, n, want: want.size, got: got.size, same });
  }
  chk("E-44-타일과-목록이-같은-id-집합", nTiles >= 2 && tileRes.every((r) => r.same && r.n === r.want),
      tileRes.map((r) => `${r.label}: 숫자 ${r.n} · 규칙 ${r.want} · 목록 ${r.got} ${r.same ? "같다" : "**다르다**"}`).join(" / "));

  // ══ §F 움직임 ══════════════════════════════════════════════════
  const sample = async (p) => {
    await p.goto(`${BASE}/v3`, { waitUntil: "commit" });
    return p.evaluate(() => new Promise((res) => {
      const seen = []; const t0 = performance.now();
      const tick = () => {
        const el = document.querySelector(".v3-stat.late .v3-stat-n");
        if (el) { const v = el.textContent; if (seen[seen.length - 1] !== v) seen.push(v); }
        if (performance.now() - t0 < 6000 && !(el && el.getAttribute("data-n") !== "0" && seen.length && seen[seen.length - 1] === el.getAttribute("data-n") && performance.now() - t0 > 1500)) requestAnimationFrame(tick);
        else res({ seen, final: el?.getAttribute("data-n"),
                   motion: getComputedStyle(document.querySelector(".v3")).getPropertyValue("--v3-motion").trim() });
      };
      requestAnimationFrame(tick);
    }));
  };
  const on = await sample(page);
  const ctxR = await mkCtx({ reducedMotion: "reduce" });
  const pR = await ctxR.newPage();
  const off = await sample(pR);
  const mid = (r) => r.seen.filter((v) => v !== "0" && v !== r.final).length;
  await pR.locator("[data-live-row]").first().waitFor();
  await pR.locator("[data-live-row] .v3-cb").first().click();
  const anim = await pR.locator(".v3-toast").last().evaluate((t) => getComputedStyle(t).animationName).catch(() => "?");
  const trans = await pR.locator(".v3-quick").first().evaluate((t) => getComputedStyle(t).transitionDuration).catch(() => "?");
  const undoR = pR.locator(".v3-toast button", { hasText: "되돌리기" }).last();
  await undoR.click().catch(() => {});
  await sleep(800);
  chk("F-45-0.13초-한-곳", /^(0)?\.13s$/.test(on.motion), `--v3-motion = ${on.motion}`);
  chk("F-47-세어-올린다", mid(on) >= 1, `기한 지남 ${on.final} 까지 지난 값 [${on.seen.join("→")}]`);
  chk("F-46-reduce-면-전부-끈다", /^0s?$/.test(off.motion) && mid(off) === 0 && anim === "none" && /^0s/.test(trans),
      `--v3-motion ${off.motion} · 숫자 [${off.seen.join("→")}] · 토스트 애니메이션 ${anim} · 전환 ${trans}`);
  await ctxR.close();

  chk("A-3-확인-창-0번", dialogs.length === 0, `${dialogs.length}번`);
  chk("콘솔-오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""} (일부러 만든 500 은 뺐다)`);

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
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2::jsonb)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, JSON.stringify(swBefore)]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(now === undefined ? null : now.value) === JSON.stringify(swBefore) && left === (beforeCount ?? 0);
    console.log(`\n뒷정리 확인 — 스위치 ${now === undefined ? "(행 없음)" : JSON.stringify(now.value)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)}) · ${MARK} 업무 ${left}건${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) { console.error("뒷정리 실패 —", e.message); process.exitCode = 1; }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
