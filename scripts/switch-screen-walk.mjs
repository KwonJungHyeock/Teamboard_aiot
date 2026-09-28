// 새 화면 스위치 — 화면으로 켜고 끄기 (MD-P-2026-074 §A · §B).
//
// **로컬 전용.** 스위치를 켰다 껐다 하므로 **시작 전 값으로 되돌린다.** 프로덕션 `config` 에는
// 쓰지 않는다(074 §E-27) — `requireLocalDb` 가 막는다. 사람 줄은 시작 전과 대조한다(074 §C-19).
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   A-9   관리자 레일에 「새 화면 스위치」가 **있고**, 팀원 레일에는 **없다** · 팀원이 주소로 오면
//         밀려남(404 아님) · 팀원 쪽에서 설정 API 를 **한 번도 안 부른다**(규약 6-3)
//   A-5   누르면 **바로 안 바뀐다** — 확인 한 줄이 먼저 선다(문구 그대로) · 「취소」면 그대로
//   A-10  켬 → 끔 → 켬 을 **화면만으로** 한 바퀴 — 매 단계 DB 가 따라온다
//   A-11  끈 직후 간 곳이 **막음 화면이 아니다**(옛 「설정」)
//   A-7   꺼진 상태에서도 관리자는 **같은 자리**(`/v3/switch`)에서 켠다 — 레일 없이
//   B-12  켠 상태에서 옛 주소가 **옛 화면을 여는 자리 0개** — `/admin/agent-usage` 도 막음 화면
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
import { peopleSnapshot, peopleDiff } from "./people-guard.mjs";

requireLocalDb("switch-screen-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".swscreen-out");
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

const KEY = "ui_v3_enabled";
const sw = async () => { const r = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0]; return r === undefined ? null : r.value; };
const setSw = async (v) => {
  if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
  else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
};

let browser, swBefore, guard = null, logMark = null, adminId = null;
try {
  // 문구는 **제품에서** 가져온다 — 검사기가 옮겨 적으면 둘이 갈릴 때 옮겨 적은 쪽을 정답으로 삼는다
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "not-yet.ts"), path.join(REPO, "lib", "v3", "nine.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { NOT_YET } = req(path.join(TMP, "v3", "not-yet.js"));
  const { SWITCH_PATH } = req(path.join(TMP, "v3", "nine.js"));
  const OFF_LINE = "새 화면이 꺼지고 모두가 옛 화면으로 돌아갑니다";   // 074 §A-5 지시서 문구 그대로

  swBefore = await sw();
  guard = await peopleSnapshot(pool);
  logMark = (await sql(`SELECT coalesce(max(id), 0) AS m FROM activity_log`))[0].m;
  const ADMIN = await testUser("admin");
  const MEMBER = await testUser("member");
  adminId = ADMIN.id;

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const as = async (who) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: tok(who) }]);
    const page = await ctx.newPage();
    const calls = [];
    page.on("request", (r) => { if (r.url().includes("/api/settings/platform")) calls.push(`${r.method()} ${new URL(r.url()).pathname}`); });
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    return { ctx, page, calls, errs };
  };

  // ══ A-9 팀원에게는 안 보이고 부르지도 않는다 ══════════════════════
  await setSw(true);
  const m = await as(MEMBER);
  await m.page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  const mRail = await m.page.locator(".v3-rail a", { hasText: "새 화면 스위치" }).count();
  await m.page.goto(`${BASE}${SWITCH_PATH}`, { waitUntil: "networkidle" });
  const mLanded = new URL(m.page.url());
  const mBody = await m.page.locator("body").innerText();
  const a = await as(ADMIN);
  await a.page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  const aRail = await a.page.locator(".v3-rail a", { hasText: "새 화면 스위치" }).count();
  chk("A-9-관리자만-보인다", aRail === 1 && mRail === 0, `관리자 레일 ${aRail}개 · 팀원 레일 ${mRail}개`);
  chk("A-9-팀원은-밀려나고-안-부른다",
      mLanded.searchParams.get("denied") === "v3-switch" && /관리자만/.test(mBody) && m.calls.length === 0,
      `팀원 → ${mLanded.pathname}${mLanded.search} · 「관리자만」 ${/관리자만/.test(mBody)} · 설정 API 호출 ${m.calls.length}번`);
  await m.ctx.close();

  // ══ A-5 · A-10 · A-11 — 켠 상태에서 **화면으로** 끄기 ═════════════
  await a.page.locator(".v3-rail a", { hasText: "새 화면 스위치" }).click();
  await a.page.waitForURL(`**${SWITCH_PATH}`);
  await a.page.locator("[data-switch-act]").click();
  const askTxt = (await a.page.locator(".v3-switch-ask").innerText()).replace(/\s+/g, " ");
  const stillOn = await sw();
  await a.page.getByRole("button", { name: "취소" }).click();
  const afterCancel = await sw();
  chk("A-5-바로-안-끄고-확인을-받는다", askTxt.includes(OFF_LINE) && stillOn === true && afterCancel === true,
      `누른 뒤 "${askTxt.slice(0, 40)}…" · 그때 DB ${JSON.stringify(stillOn)} · 취소 뒤 ${JSON.stringify(afterCancel)}`);
  await a.page.locator("[data-switch-act]").click();
  await a.page.locator("[data-switch-yes]").click();
  await a.page.waitForURL((u) => !u.pathname.startsWith("/v3"), { timeout: 15000 });
  await a.page.waitForLoadState("networkidle");
  const offAt = new URL(a.page.url());
  const offDb = await sw();
  const offBody = await a.page.locator("body").innerText();
  chk("A-11-끈-뒤-막음-화면이-아니다", offDb === false && offAt.pathname === "/settings" && !/not-yet/.test(offAt.href)
      && /지금 꺼짐/.test(offBody),
      `끈 뒤 DB ${JSON.stringify(offDb)} · 간 곳 ${offAt.pathname}${offAt.search} · 옛 설정의 「지금 꺼짐」 ${/지금 꺼짐/.test(offBody)}`);

  // ══ A-7 — 꺼진 상태에서 **같은 자리**에서 켠다 ═══════════════════
  await a.page.goto(`${BASE}${SWITCH_PATH}`, { waitUntil: "networkidle" });
  const bareAt = new URL(a.page.url()).pathname;
  const bareRail = await a.page.locator(".v3-rail").count();
  const bareState = await a.page.locator("[data-switch-state]").getAttribute("data-switch-state").catch(() => null);
  await a.page.locator("[data-switch-act]").click();
  await a.page.locator("[data-switch-yes]").click();
  await a.page.waitForURL((u) => u.pathname === "/v3", { timeout: 15000 });
  const onDb = await sw();
  chk("A-7-꺼져도-같은-자리에서-켠다", bareAt === SWITCH_PATH && bareRail === 0 && bareState === "off" && onDb === true,
      `꺼진 채 ${bareAt} (레일 ${bareRail}개 · 상태 ${bareState}) → 켜기 → /v3 · DB ${JSON.stringify(onDb)}`);
  // 팀원은 꺼진 상태에서도 그 자리가 **안 열린다** — 예외는 관리자뿐이다
  await setSw(null);
  const m2 = await as(MEMBER);
  await m2.page.goto(`${BASE}${SWITCH_PATH}`, { waitUntil: "networkidle" });
  const m2At = new URL(m2.page.url());
  chk("A-7짝-꺼진-동안-팀원은-안-열린다", m2At.searchParams.get("denied") === "v3-off" && m2.calls.length === 0,
      `팀원 → ${m2At.pathname}${m2At.search} · 설정 API 호출 ${m2.calls.length}번`);
  await m2.ctx.close();

  // ── A-10 한 바퀴를 **화면만으로** — 켬 → 끔 → 켬 ────────────────
  await setSw(true);
  const trail = [];
  for (const want of [false, true]) {
    await a.page.goto(`${BASE}${SWITCH_PATH}`, { waitUntil: "networkidle" });
    await a.page.locator("[data-switch-act]").click();
    await a.page.locator("[data-switch-yes]").click();
    await a.page.waitForURL((u) => (want ? u.pathname === "/v3" : u.pathname === "/settings"), { timeout: 15000 });
    trail.push(`${want ? "켬" : "끔"}→DB ${JSON.stringify(await sw())} · ${new URL(a.page.url()).pathname}`);
  }
  chk("A-10-켬→끔→켬-화면만으로", trail[0].startsWith("끔→DB false") && trail[1].startsWith("켬→DB true"),
      `켬(시작) → ${trail.join(" → ")}`);

  // ══ B-12 — 켠 상태에서 옛 화면이 열리는 자리 0 ═══════════════════
  const OLD = ["/", "/tasks", "/goals", "/members", "/profile", "/calendar", "/projects", "/projects/1", "/areas/1",
    "/signals", "/inbox", "/activity", "/huddle", "/reports", "/handover", "/saved", "/notes", "/status",
    "/open-due", "/settings", "/notifications", "/timeline", "/admin/agent-usage"];
  const cookie = `tb_session=${tok(ADMIN)}`;
  const opened = [], agent = [];
  for (const p of OLD) {
    const r = await fetch(`${BASE}${p}`, { headers: { cookie }, redirect: "manual" }); await r.arrayBuffer();
    if (r.status === 200) opened.push(p);
    if (p === "/admin/agent-usage") agent.push(`${r.status} → ${(r.headers.get("location") ?? "").replace(BASE, "")}`);
  }
  const inList = NOT_YET.some((s) => s.old === "/admin/agent-usage");
  chk("B-12-옛-화면이-열리는-자리-0", opened.length === 0 && inList && /not-yet\?k=agent-usage/.test(agent[0] ?? ""),
      `옛 주소 ${OLD.length}곳 중 옛 화면(200) ${opened.length}곳${opened.length ? ` [${opened.join(", ")}]` : ""} · ` +
      `/admin/agent-usage ${agent[0]} · 막음 목록 ${NOT_YET.length}줄`);

  chk("콘솔-오류", a.errs.length === 0, `${a.errs.length}건${a.errs.length ? ` — ${a.errs[0]}` : ""}`);
  await a.ctx.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  try {
    await setSw(swBefore ?? null);
    // 이 검사기가 화면으로 켜고 끈 기록 — **관리자 · 이번 판 · 스위치 문장**으로 고를 수 있는 것만 지운다
    if (logMark !== null && adminId !== null) {
      const gone = await sql(
        `DELETE FROM activity_log WHERE id > $1 AND user_id = $2 AND message LIKE '%플랫폼 설정 변경 — v3 화면%' RETURNING id`,
        [logMark, adminId]);
      console.log(`정리 — 스위치를 켜고 끈 기록 ${gone.length}줄 지움`);
    }
    const now = await sw();
    const same = JSON.stringify(now) === JSON.stringify(swBefore ?? null);
    console.log(`뒷정리 확인 — 스위치 ${now === null ? "(행 없음)" : JSON.stringify(now)} (시작 전 ${swBefore == null ? "(행 없음)" : JSON.stringify(swBefore)})${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
    if (guard) {
      const diff = await peopleDiff(pool, guard);
      console.log(`사람 줄 대조 — 시작 전과 다른 것 ${diff.length}건${diff.length ? ` **[${diff.slice(0, 6).join(" · ")}]**` : ""}`);
      if (diff.length) process.exitCode = 1;
    }
  } catch (e) { console.error("뒷정리 실패 —", e.message); process.exitCode = 1; }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
