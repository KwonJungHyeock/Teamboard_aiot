// 첫 진입 경험 실측 (MD-P-2026-026 §C).
//
// **새 계정을 실제로 만들고, 로그인 화면부터 첫 업무 생성까지 밟는다.**
// 스크린샷은 각 단계에서 찍고, 끝나면 만든 것을 전부 지운다.
//
// 데이터를 만들고 지우므로 §G "백업·복원을 갖추기 전에 실행하지 않는다" 규칙을 따른다 —
// 여기서는 **이 스크립트가 만든 행만** 지운다. 기존 데이터는 건드리지 않는다.
//
//   node scripts/first-run-walk.mjs
//
// ⚠ `| head` 로 파이프하지 말 것. head 가 파이프를 닫으면 SIGPIPE 로 프로세스가 죽고,
//   finally 의 정리(계정·업무 삭제, 팀 데이터 복원)가 실행되지 않는다.
//   출력을 줄이고 싶으면 파일로 받아서 보거나 `| cat` 을 거친다.
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { scryptSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { purgeActor, purgeReport } from "./purge-actor.mjs";

requireLocalDb("first-run-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-026/first-run";
const DSN = process.env.DATABASE_URL;
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;

/** lib/auth.ts 의 hashPassword 와 같은 형식 — "salt:hash" (scrypt 64B) */
function hashPassword(pw) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}

const EMAIL = `firstrun.${Date.now()}@local.test`;
const PW = "FirstRun!2026";
const NAME = "신규 팀원";

/**
 * ZERO=1 로 실행하면 **팀 데이터까지 비운 진짜 빈 워크스페이스**를 본다 (§C-2).
 * 비우기 전에 되돌릴 방법을 갖춘다 — §G 규칙.
 * 팀 데이터가 남아 있으면 "새 사람이 처음 보는 화면"이 아니라
 * "기존 팀에 합류한 사람의 화면"을 재는 것이 된다. 둘은 다르다.
 */
const ZERO = process.env.ZERO === "1";
const TEAM_TABLES = ["task", "goal", "signal", "project", "note", "handover"];

fs.mkdirSync(OUT, { recursive: true });
const steps = [];
let actorId = null;
let browser;
let emptied = false;
const turnedOff = new Map();   // 표 → 이 스크립트가 끈 id 목록

async function shot(page, id, note) {
  const path = `${OUT}/${id}.png`;
  await page.screenshot({ path });
  steps.push({ id, note, shot: path });
  console.log(`  ▸ ${id.padEnd(22)} ${note}`);
}

try {
  // ── 계정 생성 (팀원 권한) ──
  const [actor] = await sql(
    `INSERT INTO actor (type, display_name, is_active) VALUES ('human', $1, true) RETURNING id`, [NAME]);
  actorId = actor.id;
  await sql(
    `INSERT INTO account (actor_id, email, password_hash, role, must_change_pw)
     VALUES ($1, $2, $3, 'member', false)`, [actorId, EMAIL, hashPassword(PW)]);
  console.log(`계정 생성 — actor ${actorId} · ${EMAIL} (role=member)`);

  if (ZERO) {
    // 되돌릴 때 `SET is_active = true` 를 통째로 걸면 **원래 꺼져 있던 행까지 켜진다**.
    // 그건 복원이 아니라 소프트 삭제 취소다. 껐던 id 만 적어 두고 그것만 되돌린다.
    for (const t of TEAM_TABLES) {
      const ids = (await sql(`SELECT id FROM ${t} WHERE is_active`)).map((r) => r.id);
      turnedOff.set(t, ids);
      if (ids.length) await sql(`UPDATE ${t} SET is_active = false WHERE id = ANY($1::int[])`, [ids]);
    }
    emptied = true;
    console.log(`팀 데이터 비움 — ${TEAM_TABLES.map((t) => `${t} ${turnedOff.get(t).length}`).join(" · ")}`);
  }

  browser = await chromium.launch({
    executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();
  const jsErr = [];
  page.on("pageerror", (e) => jsErr.push(e.message));

  // ── 1. 로그인 화면 ──
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await shot(page, "01-login", `쿠키 없이 / 로 들어가면 ${page.url().replace(BASE, "")} 로 보낸다`);

  // ── 2. 로그인 ──
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PW);
  await shot(page, "02-login-filled", "이메일·비밀번호 입력");
  await page.click('button[type="submit"], button:has-text("로그인")');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(900);

  // ── 3. 첫 사용 안내 ──
  //
  // **고정 시간 뒤에 세지 않는다.** 예전에는 로그인 후 900ms 를 기다렸다가 `.frn-bg` 를
  // 셌고, 그때는 아직 `FirstRun` 이 `/api/onboarding` 응답을 못 받아 0개였다.
  // 그래서 「안내가 뜨지 않았다」로 적고 **닫는 단계를 통째로 건너뛰었다.**
  // 안내는 그 뒤에 떴고, 5단계에서 `.frn-bg` 가 클릭을 먹어 시간초과로 죽었다.
  // (오래된 회차가 통과하던 이유도 이것이다 — 흘린 actor 는 이미 `onboarded_at` 이 있어
  //  안내가 아예 안 떴다. **오염된 상태에서의 통과**였다.)
  //
  // 서버에게 먼저 묻는다. 「봐야 한다」면 안내가 뜨는 것이 **단언**이고,
  // 「안 봐도 된다」면 안 뜨는 것이 정상이다. 둘을 구분해 적는다.
  const shouldShow = await page.evaluate(async () => {
    const r = await fetch("/api/onboarding");
    return r.ok ? (await r.json()).show === true : null;
  });
  if (shouldShow === true) {
    // 사건을 기다린다 — 시간을 기다리지 않는다.
    await page.waitForSelector(".frn-bg", { timeout: 9000 });
  } else {
    console.log(`  ▸ 03-firstrun            서버가 show=${shouldShow} 라고 답했다 (안내를 안 띄우는 것이 맞다)`);
  }
  const frn = await page.locator(".frn-bg").count();
  if (frn > 0) {
    // 클릭은 **모달 안으로 좁힌다.** 페이지 전체에서 /다음|시작/ 을 찾으면
    // 본문의 다른 버튼을 눌러 슬라이드가 그대로인데도 넘어간 줄 안다 — 실제로 그렇게 틀렸다.
    const card = page.locator(".frn");
    for (const n of [1, 2, 3]) {
      const label = await card.locator(".frn-eyebrow, [class*=frn]").first().innerText().catch(() => "");
      const step = (await card.innerText()).slice(0, 6).replace(/\s+/g, " ").trim();
      await shot(page, `03-firstrun-${n}`, `첫 사용 안내 — 화면에 표시된 쪽수 "${step}" (${label ? "" : ""}계정당 1회)`);
      if (n === 3) break;
      const next = card.getByRole("button", { name: /^다음$/ }).first();
      if (!(await next.count())) break;
      await next.click();
      await page.waitForTimeout(450);
    }
    const done = card.getByRole("button", { name: /시작하기|건너뛰기/ }).first();
    if (!(await done.count())) throw new Error("안내를 닫을 버튼(시작하기·건너뛰기)이 없다 — 닫지 못하면 뒤 단계가 전부 막힌다");
    // **빈 catch 를 두지 않는다.** 여기서 조용히 실패하면 안내가 남고,
    // 그 다음 실패는 「새 업무 버튼을 못 찾는다」로 나타나 엉뚱한 곳을 고치게 된다.
    //
    // 「봤음」 기록은 화면을 닫은 **뒤에** 날아가는 POST 다(fire-and-forget).
    // 그래서 닫자마자 GET 으로 물으면 아직 안 끝난 것을 「안 남았다」로 읽는다 —
    // 실제로 그렇게 재서 「서버는 아직 show=true」라는 **틀린 결함 보고**를 냈다.
    // 응답을 기다린다. 고정 시간이 아니라 **그 요청**을 기다린다.
    const posted = page.waitForResponse(
      (r) => r.url().includes("/api/onboarding") && r.request().method() === "POST", { timeout: 9000 });
    await done.click();
    const res = await posted;
    if (!res.ok()) throw new Error(`안내 「봤음」 기록이 실패했다 — POST /api/onboarding HTTP ${res.status()}`);
    // 닫혔는지 **확인한다.** 닫는 시늉과 닫힘은 다르다.
    await page.locator(".frn-bg").waitFor({ state: "detached", timeout: 5000 });
    // 서버에도 남았는가 — 안 남으면 화면을 옮길 때마다 다시 뜬다.
    const still = await page.evaluate(async () => {
      const r = await fetch("/api/onboarding");
      return r.ok ? (await r.json()).show : "조회실패";
    });
    if (still !== false) throw new Error(`안내를 닫았는데 서버는 아직 show=${still} 다 — 화면을 옮기면 다시 뜬다`);
    console.log("  ▸ 03-firstrun            닫았다 · POST 200 · 서버 show=false 확인");
  } else if (shouldShow === true) {
    throw new Error("서버는 안내를 보여줘야 한다고 했는데 화면에 `.frn-bg` 가 없다");
  } else {
    steps.push({ id: "03-firstrun", note: `첫 사용 안내를 띄우지 않는 계정 (서버 show=${shouldShow})`, shot: "" });
  }

  // ── 4. 데이터 0 상태의 각 화면 (C-2) ──
  const ROUTES = ["/", "/tasks", "/goals", "/notes", "/calendar", "/saved", "/inbox", "/activity",
                  "/projects", "/signals", "/huddle", "/handover", "/reports"];
  for (const r of ROUTES) {
    await page.goto(BASE + r, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const m = await page.evaluate(() => ({
      full: document.querySelectorAll(".empty-state").length,
      sec: document.querySelectorAll(".sec-empty").length,
      err: document.querySelectorAll(".err-note").length,
      sk: document.querySelectorAll(".sk").length,
    }));
    await shot(page, `04-zero${r.replace(/[^\w]+/g, "_") || "_home"}`,
      `${r} · 전체빈 ${m.full} · 섹션빈 ${m.sec} · 오류 ${m.err} · 로딩 ${m.sk}`);
  }

  // ── 5. 첫 업무 만들기 (C-1) ──
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const cta = page.getByRole("button", { name: /새 업무/ }).first();
  await cta.waitFor({ state: "visible", timeout: 9000 });
  await cta.click();
  await page.waitForTimeout(900);
  await shot(page, "05-new-task-open", "빈 상태 CTA 를 눌러 새 업무 입력을 연다");

  /**
   * **원인 규명 완료** (§C3 ⑦).
   *
   * 이 단계는 깨끗한 DB 에서 시간초과로 죽었다. 원인은 새 업무 입력이 아니라
   * **3단계에서 첫 사용 안내를 못 닫은 것**이었다 — 고정 시간(900ms) 뒤에 `.frn-bg` 를
   * 세는 바람에 아직 안 뜬 것을 「안 뜬다」로 읽고 닫는 단계를 건너뛰었다.
   * 안내는 그 뒤에 떴고 `.frn-bg` 가 여기서 클릭을 먹었다.
   *
   * 오래된 회차가 통과하던 이유도 같다. 흘린 actor 는 이미 `onboarded_at` 이 있어
   * 안내가 아예 안 떴다 — **오염된 상태에서의 통과**였다. 정리를 고치자 드러났다.
   *
   * 남은 실패는 **선택자였다.** `.qc-title, .tdp-title, .tv-quick input` 셋 중
   * 화면에 있는 것이 하나도 없었다 — 새 업무 입력은 `NewTaskModal` 의 `.ntm-title` 이다.
   * 셋 다 죽은 선택자였고, 셋을 `,` 로 묶어 두어서 **어느 것이 잡혔는지 물을 수조차 없었다.**
   * 하나로 좁히고, 못 찾으면 무엇이 떴는지 적는다 (§G 「선택자를 짐작하지 않는다」).
   */
  const title = page.locator(".ntm-title");
  await title.waitFor({ state: "visible", timeout: 9000 }).catch(async (e) => {
    const open = await page.evaluate(() => ({
      modal: !!document.querySelector(".ntm"),
      dialogs: [...document.querySelectorAll('[role="dialog"]')].map((d) => d.getAttribute("aria-label")),
      inputs: [...document.querySelectorAll("input[type=text], input:not([type])")].map((i) => i.className || i.placeholder),
    }));
    throw new Error(`새 업무 제목 입력(.ntm-title)을 못 찾았다 — 화면 상태: ${JSON.stringify(open)}`);
  });
  await title.fill("첫 업무 — 개발 환경 세팅");
  await page.waitForTimeout(300);
  await shot(page, "06-new-task-typed", "제목 입력");
  // 버튼 안에 단축키 배지(`<em>⌘↵</em>`)가 들어 있어 접근성 이름이 "만들기 ⌘↵" 다.
  // `/^만들기$/` 로는 절대 안 잡힌다. **모달 안으로 좁히고** 앵커를 풀어 잡는다 —
  // 페이지 전체에서 /만들기/ 를 찾으면 본문의 다른 버튼을 누를 수 있다.
  const save = page.locator(".ntm-foot .btn-primary");
  await save.waitFor({ state: "visible", timeout: 5000 });
  await save.click();
  await page.waitForTimeout(1600);
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const made = await sql(`SELECT id, title, visibility FROM task WHERE created_by = $1`, [actorId]);
  await shot(page, "07-after-first-task", `첫 업무 생성 결과 — DB ${made.length}건 ${made.map((t) => `#${t.id} ${t.visibility}`).join(", ")}`);

  fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify({ email: EMAIL, actorId, steps, jsErrors: jsErr, created: made }, null, 2));
  console.log(`\nJS 오류 ${jsErr.length}건${jsErr.length ? ": " + jsErr[0].slice(0, 100) : ""}`);
} finally {
  if (browser) await browser.close();
  if (emptied) {
    for (const t of TEAM_TABLES) {
      const ids = turnedOff.get(t) ?? [];
      if (ids.length) await sql(`UPDATE ${t} SET is_active = true WHERE id = ANY($1::int[])`, [ids])
        .catch((e) => console.error(`${t} 복원 실패`, e.message));
    }
    const back = [];
    for (const t of TEAM_TABLES) {
      const r = (await sql(`SELECT count(*) FILTER (WHERE is_active)::int a, count(*)::int n FROM ${t}`))[0];
      back.push(`${t} ${r.a}/${r.n}`);
    }
    console.log(`팀 데이터 복원 — ${back.join(" · ")}`);
  }
  // ── 정리 — 이 스크립트가 만든 것만 지운다 ──
  if (actorId) {
    // 지울 테이블을 손으로 나열하지 않는다 — `read_marker` 하나가 빠져 있어서 정리가 죽었고,
    // 정리가 죽으니 계정이 매 회차 하나씩 남았다(실제로 셋이 쌓였다).
    // 스키마에 물어보고 지운다. 참조 테이블이 늘어도 여기는 안 바뀐다.
    console.log(purgeReport(actorId, await purgeActor(sql, actorId)));
  }
  await pool.end();
}
