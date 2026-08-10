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

  // ── 3. 첫 사용 안내 (있으면) ──
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
    if (await done.count()) { await done.click().catch(() => {}); await page.waitForTimeout(600); }
  } else {
    steps.push({ id: "03-firstrun", note: "첫 사용 안내가 뜨지 않았다 — 확인 필요", shot: "" });
    console.log("  ▸ 03-firstrun            뜨지 않음");
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
   * ⚠ **이 단계는 지금 깨끗한 DB 에서 실패한다** (§C3 에서 고친다).
   *
   * 이 검사는 오래전부터 정리에 실패해 매 회차 「신규 팀원」 actor 를 하나씩 흘렸다.
   * 정리를 고쳐 DB 가 깨끗해지자 이 단계가 시간초과하기 시작했다 —
   * 원본은 **이전 회차가 남긴 찌꺼기 덕분에 통과하고 있었다.**
   * 즉 통과가 아니라 **오염된 상태에서의 통과**였다.
   *
   * 그래서 지금 보이는 실패가 진짜 상태다. 셋 다 §C3 에서 함께 본다 —
   * 이 단계 · `32g-화면밖` · §D6 막대 최소 폭.
   * audit:absent — `.tv-quick` 은 없는 갈래인 것을 알고 둔다. 원인 규명 전에 손대지 않는다.
   */
  const title = page.locator(".qc-title, .tdp-title, .tv-quick input").first();
  await title.waitFor({ state: "visible", timeout: 9000 });
  await title.fill("첫 업무 — 개발 환경 세팅");
  await page.waitForTimeout(300);
  await shot(page, "06-new-task-typed", "제목 입력");
  const save = page.getByRole("button", { name: /^만들기$/ }).first();
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
