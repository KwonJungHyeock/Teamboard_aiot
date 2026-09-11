// 팀원 권한 경계 실측 (MD-P-2026-026 §C-4).
//
// **지시 28 형식** — 부재 단언 하나에 짝이 되는 존재 단언을 붙인다.
//   "팀원에게는 안 보인다" 만 확인하면, 선택자가 틀려서 못 찾은 것과
//   실제로 없는 것을 구별할 수 없다. 같은 선택자로 **팀장에게는 보인다**를
//   함께 확인해야 그 단언이 살아 있는 단언이 된다.
//
//   node scripts/member-boundary.mjs
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { scryptSync, randomBytes } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("member-boundary.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-026/member";
const HOST = new URL(BASE).hostname;
const SECRET = process.env.AUTH_SECRET;
const DSN = process.env.DATABASE_URL;
if (!SECRET || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`;
};

const LEAD = { id: 1, actorId: 1, name: "권정혁", role: "lead", email: "lead@local" };
const MEMBER = { id: 3, actorId: 3, name: "박주희", role: "member", email: "member@local" };

/**
 * 각 항목: 팀장에게는 보이고 팀원에게는 보이면 안 되는 것.
 *   check(page) → true = 보인다
 */
const CASES = [
  { id: "members-issue", path: "/members", what: "계정 발급 폼",
    check: (p) => p.getByRole("button", { name: /계정 발급/ }).count().then((n) => n > 0) },
  { id: "settings-demo", path: "/settings", what: "데모 시드 주입 · 데모 데이터 비우기",
    check: (p) => p.getByRole("button", { name: /데모 시드 주입/ }).count().then((n) => n > 0) },
  { id: "reports-approval", path: "/reports", what: "승인 보고서 탭",
    check: (p) => p.getByRole("tab", { name: /승인 보고서/ }).count().then((n) => n > 0) },
  { id: "projects-new", path: "/projects", what: "새 프로젝트 만들기 폼",
    check: (p) => p.locator("input[placeholder*='프로젝트']").count().then((n) => n > 0) },
  { id: "goals-snapshot", path: "/goals", what: "스냅샷 메뉴 (목표 적립)",
    check: (p) => p.locator(".snapm, [class*=snapm]").count().then((n) => n > 0) },
  // "＋ 새 목표" 버튼 자체는 팀원에게도 보인다 — **개인 목표는 만들 수 있어야** 하기 때문이다.
  // 경계는 그 안의 "팀 목표" 선택이다. 버튼 존재로 판정하면 정상 동작을 누출로 잘못 잡는다.
  { id: "goals-team-scope", path: "/goals", what: "새 목표 모달의 '팀 목표' 범위 선택",
    check: async (p) => {
      const open = p.getByRole("button", { name: /＋ 새 목표/ }).first();
      if (!(await open.count())) return false;
      await open.click().catch(() => {});
      await p.waitForTimeout(600);
      // 페이지 탭에도 "팀 목표"가 있다 — **모달 안으로 좁히지 않으면 탭을 잡는다**
      // 페이지 탭에도 "팀 목표"가 있으므로 **모달 안으로** 좁힌다.
      // `.ngm, [class*=ngm]` 로 좁히면 여러 요소에 걸려 strict 위반으로 조용히 false 가 된다.
      const team = p.locator('[role="dialog"][aria-label="새 목표"] .ma-seg button', { hasText: /^팀 목표$/ }).first();
      if (!(await team.count())) return false;
      return !(await team.isDisabled());     // 비활성이면 "쓸 수 없다" = 안 보이는 것과 같다
    } },
  // MD-P-2026-027 §D1 — 프로젝트 콤보박스의 "새 프로젝트로 만들기".
  // POST /api/projects 는 팀장 전용이므로, 팀원에게 이 줄을 보여 주면
  // 눌러도 403 이 나는 버튼을 보여 주는 셈이다. 아예 그리지 않는다.
  /*
   * MD-P-2026-027 §D1 — 프로젝트 콤보박스의 "새 프로젝트로 만들기".
   * POST /api/projects 는 팀장 전용이므로, 팀원에게 이 줄을 보여 주면
   * 눌러도 403 이 나는 버튼을 보여 주는 셈이다. 아예 그리지 않는다.
   *
   * ── 053 에서 고친 것 ──────────────────────────────────────────
   *
   * 선택자가 `.ntm-side`(고급 패널) 안을 보고 있었다. 그런데 027 §B 에서
   *   ① 고급은 **언제나 닫힌 채로 시작**하게 됐고,
   *   ② 프로젝트 고르개는 고급에서 **본문으로 옮겨졌다**(`ProjectPicker`).
   * 그래서 팀장에게도 안 보였고 — 단언이 죽어 있었다.
   *
   * 그리고 「새 프로젝트로 만들기」는 프로젝트가 여덟을 넘어 **콤보가 될 때만**
   * 나타난다(`VISIBLE_PROJECT_BUTTON_LIMIT`). 그 아래면 버튼 줄이라 아무에게도
   * 안 보인다 — 그래서 **조건을 먼저 만든다**(setup 에서 프로젝트를 채운다).
   */
  { id: "combo-new-project", path: "/tasks?panel=task:new", what: "프로젝트 콤보박스의 '새 프로젝트로 만들기'",
    check: async (p) => {
      await p.waitForTimeout(1200);
      // 본문의 프로젝트 줄. 고급을 열 필요가 없다 — 거기 있던 시절의 선택자였다.
      const row = p.locator('.ntm-main .ntm-f:has(.ntm-fl:text-is("프로젝트")) .pcb-v');
      if (await row.count() === 0) return false;
      await row.click();
      await p.waitForTimeout(300);
      await p.locator(".pcb-q").fill("존재하지않을이름ZZZ");
      await p.waitForTimeout(300);
      return (await p.locator(".pcb-new").count()) > 0;
    } },
  { id: "huddle-review", path: "/huddle", what: "새 리뷰 세션 시작",
    check: (p) => p.getByRole("button", { name: /새 리뷰 세션 시작/ }).count().then((n) => n > 0) },
];

/** 서버 차단 — 화면이 아니라 API 가 막는가 (§A3 형식) */
const API = [
  { id: "api-seed-demo", method: "POST", url: "/api/admin/seed-demo", what: "데모 시드 주입" },
  { id: "api-clear-demo", method: "POST", url: "/api/admin/clear-demo", what: "데모 데이터 비우기" },
  { id: "api-members-post", method: "POST", url: "/api/members", what: "계정 발급",
    body: { displayName: "무단생성", email: "x@x.test", role: "member" } },
  { id: "api-projects-post", method: "POST", url: "/api/projects", what: "프로젝트 생성",
    body: { name: "무단 프로젝트" } },
];

fs.mkdirSync(OUT, { recursive: true });

/*
 * ── 조건을 먼저 만든다 (053 §B-30) ───────────────────────────────
 *
 * 「새 프로젝트로 만들기」는 프로젝트가 여덟을 넘어 **콤보가 될 때만** 나타난다
 * (`VISIBLE_PROJECT_BUTTON_LIMIT = 8`). 그 아래면 버튼 줄이라 팀장에게도 안
 * 보이고, 그러면 「팀원에게 안 보인다」는 단언이 죽는다 — 아무것도 안 재게 된다.
 *
 * 그래서 문턱을 넘을 만큼 채운다. 뒷정리에서 **이 표시가 붙은 것만** 지운다.
 */
const PMARK = "[경계검사]";
const BUTTON_LIMIT = 8;
const seeded = [];
{
  /*
   * ── 시작할 때 먼저 쓸어낸다 (054) ────────────────────────────
   *
   * 뒷정리는 **이번에 만든 id** 만 지운다. 그런데 Postgres 가 검사 도중 죽으면
   * 뒷정리가 DB 에 닿지 못해 행이 남고, 남은 채로 다음 회차를 돌면 「몇 개가
   * 있는가」를 오염된 바탕에서 세게 된다. 실제로 6건이 남았다.
   *
   * 그래서 시작에서도 **이 표시가 붙은 것**을 지운다. 뒷정리가 못 돈 날에도
   * 다음 회차가 깨끗한 바탕에서 시작한다.
   */
  const stale = await sql(`DELETE FROM project WHERE name LIKE $1 RETURNING id`, [`${PMARK}%`]);
  if (stale.length) console.log(`(정리) 지난 회차가 남긴 ${PMARK} ${stale.length}건을 먼저 지웠다`);

  /*
   * **버튼 수는 행 수가 아니다** (`lib/project-buttons.ts`).
   *   버튼 = goal 프로젝트 전부 + 내 소속 영역마다 상시 하나.
   * 처음엔 활성 행 수로 셌더니 9건인데도 버튼은 5개라 콤보가 안 됐다 —
   * 문턱을 넘기려면 **goal 프로젝트**를 채워야 한다.
   */
  const goals = (await sql(
    `SELECT count(*)::int n FROM project WHERE is_active AND type = 'goal'`))[0].n;
  const need = Math.max(0, BUTTON_LIMIT + 1 - goals);
  for (let i = 1; i <= need; i += 1) {
    const r = await sql(
      `INSERT INTO project (name, type, area_id, color_key, is_active)
       VALUES ($1, 'goal', (SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1), 'team', true)
       RETURNING id`, [`${PMARK} ${i}`]);
    seeded.push(r[0].id);
  }
  console.log(`(조건) goal 프로젝트 ${goals}건 + ${need}건 = ${goals + need}건` +
              ` — 버튼이 ${BUTTON_LIMIT}개를 넘어야 콤보가 되고, 콤보라야 「새 프로젝트로 만들기」가 있다`);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});

/**
 * 첫 사용 안내를 먼저 닫는다.
 * onboarded_at 이 NULL 인 계정은 로그인 직후 `.frn-bg` 가 화면 전체를 덮는다.
 * 그 상태에서 "안 보인다"를 재면 **모달이 가려서 안 보인 것**과
 * 실제로 없는 것을 구별할 수 없다 — 실제로 그렇게 한 번 잘못 쟀다.
 */
async function dismissFirstRun(page) {
  const bg = page.locator(".frn-bg");
  if (!(await bg.count())) return false;
  const skip = page.getByRole("button", { name: /건너뛰기/ }).first();
  if (await skip.count()) await skip.click().catch(() => {});
  await page.waitForTimeout(500);
  return true;
}

async function look(user, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok(user), domain: HOST, path: "/" }]);
  const page = await ctx.newPage();
  const out = {};
  let sawFirstRun = false;
  for (const c of CASES) {
    await page.goto(BASE + c.path, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    if (await dismissFirstRun(page)) sawFirstRun = true;
    out[c.id] = await c.check(page).catch(() => false);
    if (tag === "member") await page.screenshot({ path: `${OUT}/${tag}-${c.id}.png` });
  }
  await ctx.close();
  out.__firstRun = sawFirstRun;
  return out;
}

const lead = await look(LEAD, "lead");
const member = await look(MEMBER, "member");

console.log("── 화면 (지시 28 형식: 존재 단언 + 부재 단언) ──");
const rows = [];
for (const c of CASES) {
  const ok = lead[c.id] === true && member[c.id] === false;
  const why = lead[c.id] !== true ? "팀장에게도 안 보임 — **단언이 죽어 있다**"
    : member[c.id] !== false ? "팀원에게 보인다 — **누출**" : "";
  rows.push({ ...c, lead: lead[c.id], member: member[c.id], ok, why });
  console.log(`${ok ? "OK  " : "FAIL"} ${c.id.padEnd(18)} 팀장 ${lead[c.id] ? "보임" : "안보임"} · 팀원 ${member[c.id] ? "보임" : "안보임"}  ${why}`);
}

// ── API 차단 ──
console.log("\n── 서버 차단 (팀원 토큰으로 직접 호출) ──");
const apiRows = [];
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "tb_session", value: tok(MEMBER), domain: HOST, path: "/" }]);
const page = await ctx.newPage();
await page.goto(BASE + "/tasks", { waitUntil: "domcontentloaded" });   // 상대 경로 fetch 의 기준이 필요하다
for (const a of API) {
  const res = await page.evaluate(async ({ url, method, body }) => {
    const r = await fetch(url, {
      method, headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    let msg = "";
    try { msg = (await r.json())?.error ?? ""; } catch { /* 본문 없음 */ }
    return { status: r.status, msg };
  }, a);
  const blocked = res.status === 401 || res.status === 403 || res.status === 404;
  apiRows.push({ ...a, ...res, blocked });
  console.log(`${blocked ? "OK  " : "FAIL"} ${a.id.padEnd(18)} ${a.method} ${a.url} → ${res.status} ${res.msg}`);
}
await ctx.close();
await browser.close();

// 만든 프로젝트를 되돌린다. **이 표시가 붙은 것만** 지운다 — 실데이터는 안 건드린다.
if (seeded.length) {
  await sql(`DELETE FROM project WHERE id = ANY($1::int[])`, [seeded]).catch((e) => {
    console.error("프로젝트 정리 실패 —", e.message);
    process.exitCode = 1;
  });
  const left = (await sql(`SELECT count(*)::int n FROM project WHERE name LIKE $1`, [`${PMARK}%`]))[0].n;
  console.log(`정리 — 만든 프로젝트 ${seeded.length}건 지움 · ${PMARK} 남은 것 ${left}건 (0이어야 한다)`);
  if (left !== 0) process.exitCode = 1;
}

// 부작용이 없었는지 확인 — 차단은 "막았다"이지 "만들고 숨겼다"가 아니다
const leaked = await sql(`SELECT count(*)::int n FROM project WHERE name = '무단 프로젝트'`);
const leakedAcc = await sql(`SELECT count(*)::int n FROM account WHERE email = 'x@x.test'`);
console.log(`\n부작용 확인 — 무단 프로젝트 ${leaked[0].n}건 · 무단 계정 ${leakedAcc[0].n}건 (둘 다 0이어야 한다)`);

fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ rows, apiRows, sideEffects: { project: leaked[0].n, account: leakedAcc[0].n } }, null, 2));
const fail = rows.filter((r) => !r.ok).length + apiRows.filter((r) => !r.blocked).length;
console.log(`\n첫 사용 안내 — 팀장 ${lead.__firstRun ? "떴음(닫고 측정)" : "없음"} · 팀원 ${member.__firstRun ? "떴음(닫고 측정)" : "없음"}`);
console.log(`화면 ${rows.length} · API ${apiRows.length} · 실패 ${fail}`);
await pool.end();
