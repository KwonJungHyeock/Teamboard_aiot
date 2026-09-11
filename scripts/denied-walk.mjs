// 권한이 없어 밀려날 때 **이유를 말하는가** 실측 (MD-P-2026-053 §B-31).
//
// **로컬 전용** (지시 32). 만든 계정과 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 팀원으로 `/members` → 밀려난 화면에 **그 문구가 있다**
//   ② 문구는 **막은 쪽이 낸 것**이다 — `lib/denied.ts` 의 표와 글자까지 같다
//   ③ 막는 자리마다 **제 문장**이 나온다 (구성원 · 설정 · 업무 현황 …)
//   ④ **안 사라진다** — 기다려도 그대로, 닫기를 눌러야 없어진다
//   ⑤ 닫으면 **주소에서도 빠진다** (새로고침해도 다시 안 뜬다)
//   ⑥ 모르는 이름은 **아무 말도 안 만든다** (`?denied=아무거나`)
//   ⑦ 스위치가 켜져도 이유가 **안 떨어진다** (v3 홈으로 다시 보내질 때)
//   ⑧ 콘솔 오류 0
//
// **조건을 먼저 만든다** — 팀원 계정이 없으면 ①이 아무것도 안 잰다.
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

requireLocalDb("denied-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".dn-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-053";
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
const MARK = "[053밀려남]";

let browser, swBefore = null, memberActor = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "denied.ts"), path.join(REPO, "lib", "v3", "routes.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { DENIED_REASON, deniedHref, deniedReason, DENIED_HREF } = req(path.join(TMP, "denied.js"));
  const { v3Destination } = req(path.join(TMP, "v3", "routes.js"));

  // 짝조건 — 모르는 이름은 **아무 말도 안 만든다.** 주소는 손으로 고칠 수 있다.
  chk("⑥-모르는-이름은-말을-안-만든다",
      deniedReason("?denied=아무거나") === null && deniedReason("") === null
      && deniedReason("?denied=members") === DENIED_REASON.members
      && deniedHref("members") === `${DENIED_HREF}?denied=members`,
      `모르는 이름 → ${deniedReason("?denied=아무거나")} · 아는 이름 → "${DENIED_REASON.members}"`);

  // 짝조건 — 스위치가 켜져 다시 보내질 때 **이유가 안 떨어진다**.
  chk("⑦-옮겨-가도-이유가-따라간다",
      v3Destination("/?denied=stats") === "/v3?denied=stats"
      && v3Destination("/") === "/v3",
      `/?denied=stats → ${v3Destination("/?denied=stats")} · 이유 없으면 그대로 ${v3Destination("/")}`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };
  await setSwitch(null);          // 옛 화면에서 먼저 본다

  // ── 조건을 먼저 만든다 — 팀원 계정 ─────────────────────────────
  memberActor = (await sql(
    `INSERT INTO actor (type, display_name, is_active) VALUES ('human', $1, true) RETURNING id`,
    [`${MARK} 팀원`]))[0].id;
  await sql(
    `INSERT INTO account (actor_id, email, password_hash, role, onboarded_at)
     VALUES ($1, $2, 'x', 'member', now())`, [memberActor, `${MARK}@test.local`]);
  chk("0-조건을-먼저-만들었다", !!memberActor,
      `팀원 계정 actor#${memberActor} — 없으면 「팀원은 밀려난다」가 아무것도 안 잰다`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: memberActor, actorId: memberActor, name: "검사팀원",
                 role: "member", adminGrant: false, email: `${MARK}@test.local` }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  const note = () => page.locator(".dnote");
  const noteText = async () => (await note().innerText().catch(() => "")).replace(/\s+/g, " ").trim();

  // ── ①② 구성원 → 이유가 있고, 막은 쪽이 낸 말과 같다 ────────────
  await page.goto(`${BASE}/members`, { waitUntil: "networkidle" });
  await note().waitFor({ timeout: 9000 }).catch(() => {});
  const landed = new URL(page.url());
  const txt = await noteText();
  chk("①②-밀려난-화면에-그-문구가",
      landed.pathname === "/" && txt.includes(DENIED_REASON.members),
      `/members → ${landed.pathname}${landed.search} · 화면 "${txt}"` +
      ` · lib/denied 의 말 "${DENIED_REASON.members}"`);
  await page.screenshot({ path: `${OUT}/B31-밀려난-이유.png`, fullPage: true });

  // ── ③ 막는 자리마다 제 문장 ───────────────────────────────────
  const seen = [];
  for (const [where, key] of [["/settings", "settings"], ["/status", "status"],
                              ["/open-due", "open-due"], ["/admin/agent-usage", "agent-usage"]]) {
    await page.goto(`${BASE}${where}`, { waitUntil: "networkidle" });
    await note().waitFor({ timeout: 9000 }).catch(() => {});
    const t = await noteText();
    seen.push({ where, ok: t.includes(DENIED_REASON[key]), t });
  }
  chk("③-막는-자리마다-제-문장",
      seen.every((s) => s.ok),
      seen.map((s) => `${s.where} ${s.ok ? "맞음" : `**다름: "${s.t}"**`}`).join(" · "));

  // ── ④ 안 사라진다 ────────────────────────────────────────────
  //
  // **기다려 본다.** 「사라지지 않는다」는 기다려야만 재어진다 — 뜨자마자 보면
  // 사라지는 알림도 통과한다.
  await page.goto(`${BASE}/members`, { waitUntil: "networkidle" });
  await note().waitFor({ timeout: 9000 }).catch(() => {});
  const before = await note().count();
  await page.waitForTimeout(6000);
  const after = await note().count();
  chk("④-안-사라진다", before === 1 && after === 1,
      `뜬 직후 ${before}개 → 6초 뒤 ${after}개 (그대로여야 한다)`);

  // ── ⑤ 닫으면 주소에서도 빠진다 ────────────────────────────────
  await note().locator(".dnote-x").click();
  await page.waitForTimeout(700);
  const closed = await note().count();
  const afterUrl = new URL(page.url());
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const afterReload = await note().count();
  chk("⑤-닫으면-주소에서도-빠진다",
      closed === 0 && afterUrl.searchParams.get("denied") === null && afterReload === 0,
      `닫은 뒤 ${closed}개 · 주소 ${afterUrl.search || "(없음)"} · 새로고침 뒤 ${afterReload}개`);

  // ── ⑦짝 스위치를 켜도 이유가 안 떨어진다 ──────────────────────
  //
  // 팀원이 `/members` 에서 막히면 `/?denied=members` 로 가는데, 스위치가 켜져
  // 있으면 옛 홈이 다시 `/v3` 로 보낸다. 그 사이에 이유를 흘리면 **아무 설명
  // 없이 새 홈에 서 있게** 된다 — 고치려던 바로 그 자리다.
  await setSwitch(true);
  await page.goto(`${BASE}/members`, { waitUntil: "networkidle" });
  await note().waitFor({ timeout: 9000 }).catch(() => {});
  const v3Url = new URL(page.url());
  const v3Txt = await noteText();
  chk("⑦짝-스위치-켜도-이유가-산다",
      v3Url.pathname === "/v3" && v3Txt.includes(DENIED_REASON.members),
      `/members → ${v3Url.pathname}${v3Url.search} · 화면 "${v3Txt}"`);
  await page.screenshot({ path: `${OUT}/B31-v3에서도.png`, fullPage: true });
  await setSwitch(null);

  chk("⑧-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  if (memberActor) {
    await pool.query(`DELETE FROM account WHERE actor_id = $1`, [memberActor]).catch((e) => console.error("account 정리 실패", e.message));
    await pool.query(`DELETE FROM actor WHERE id = $1`, [memberActor]).catch((e) => console.error("actor 정리 실패", e.message));
  }
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const actors = (await pool.query(`SELECT count(*)::int n FROM actor WHERE display_name LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && actors === 0;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 사람 ${actors}명${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
