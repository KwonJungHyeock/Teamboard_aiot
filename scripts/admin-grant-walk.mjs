// 정체와 권한을 가른다 — 실측 (MD-P-2026-039 §C).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
//   ① role='lead' + grant=true  → 구성원 화면에 들어간다 · 역할 변경 칸이 보인다
//   ② 같은 계정의 이름표가 「팀장」+「관리자 권한」 (「관리자」가 **아니다**)
//   ③ role='lead' + grant=false → 구성원 진입 불가 · API 403
//   ④ role='admin'             → 권한 칸을 안 그리고 **이유가 보인다**
//   ⑤ 관리자 둘 → 하나 끄기 200 · 마지막 하나 끄기 400 (자기 자신이라도)
//   ⑥ role='admin' 계정으로 프로젝트 생성 · 팀 목표 보관 200 (hasLead 확인)
//   ⑦ grant 를 켠 lead 계정으로도 같은 것 200
//
// ── 왜 이렇게 재는가 ─────────────────────────────────────────────
//
// ②가 없으면 ①은 「권한만 맞으면 됐다」로 끝난다. 그런데 039 의 요지는
// **권한이 맞아도 정체는 그대로여야 한다**는 것이다. 화면 글자를 읽어서 본다.
//
// ⑤는 한 번만 재면 「막았다」와 「원래 못 했다」가 안 갈린다. 그래서 **짝**으로
// 잰다 — 둘일 때는 통과하고 하나일 때만 막힌다.
//
// ⑥⑦은 `hasLead` 를 안 건드렸다는 확인이다. 「고칠 것이 없었다」도 확인을
// 낸 것이다(§G) — 안 봤으면 안 본 것이지 괜찮은 것이 아니다.
//
// 조건(권한 · 역할)은 전부 **관측보다 먼저** 만들고, 끝나면 시작 전 지문과
// 글자 그대로 맞춰 되돌린다. 절대값(「grant 켜진 사람 0명」)을 기대하지 않는다.
// 이름은 넣지 않는다 — 검사가 만드는 것은 전부 `[039검사]` 로 시작한다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("admin-grant-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-039/admin-grant";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const MARK = "[039검사]";
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(24)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(24)} ${n}`); } };

/** account 전체의 역할·권한 지문 — 되돌렸는지 이걸로 대조한다. */
const fp = async () => (await sql(
  `SELECT a.actor_id, ac.display_name, a.role, a.admin_grant FROM account a
     JOIN actor ac ON ac.id = a.actor_id ORDER BY a.actor_id`))
  .map((r) => `${r.actor_id}:${r.role}${r.admin_grant ? "+G" : ""}`).join(" ");

let browser, before = null, made = { projects: [], goals: [] };
try {
  before = await fp();
  const madeBefore = (await sql(
    `SELECT (SELECT count(*)::int FROM project WHERE name LIKE $1) p,
            (SELECT count(*)::int FROM goal    WHERE title LIKE $1) g`, [`${MARK}%`]))[0];
  console.log(`   (시작 전) 역할·권한 ${before}`);
  console.log(`   (시작 전) ${MARK} 프로젝트 ${madeBefore.p} · 목표 ${madeBefore.g}`);

  // 세 사람을 쓴다. 누가 누구인지는 **역할로만** 고른다 — 이름으로 판정하지 않는다(§G).
  const humans = await sql(
    `SELECT a.actor_id id, a.role FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active = true ORDER BY a.actor_id`);
  const L1 = humans.find((h) => h.role === "lead");
  const L2 = humans.find((h) => h.role === "lead" && h.id !== L1?.id);
  const M1 = humans.find((h) => h.role === "member");
  chk("0-짝조건", !!(L1 && L2 && M1),
      `팀장 둘(${L1?.id}·${L2?.id}) · 팀원 하나(${M1?.id}) — 셋이라야 ①③⑤가 뜻을 가진다`);
  if (!(L1 && L2 && M1)) throw new Error("검사에 필요한 계정 구성이 없다");

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const host = new URL(BASE).hostname;
  const open = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.addCookies([{ name: "tb_session", value: tok(u), domain: host, path: "/" }]);
    const page = await ctx.newPage();
    // 먼저 한 번 연다 — about:blank 에서는 상대 경로 fetch 가 URL 조차 못 만든다.
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    page.api = (path, init) => page.evaluate(async ([p, i]) => {
      const r = await fetch(p, i);
      return { status: r.status, body: await r.json().catch(() => null) };
    }, [path, init]);
    page.put = (id, body) => page.api(`/api/members/${id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ctx, page };
  };
  // 쿠키의 role 은 화면 이름표가 읽는 값이다. DB 와 **같게** 넣는다 —
  // 다르게 넣으면 이 검사가 재는 것이 무엇인지 알 수 없어진다.
  const asUser = (h, role, grant) => ({ id: h.id, actorId: h.id, name: "검사", role, adminGrant: grant, email: "x@x" });

  // ══ ③ 먼저 — **권한을 켜기 전** 상태다. 조건은 관측보다 먼저 만든다 ══
  await sql(`UPDATE account SET admin_grant = false WHERE actor_id = $1`, [L2.id]);
  {
    const { ctx, page } = await open(asUser(L2, "lead", false));
    await page.goto(`${BASE}/members`, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    const where = new URL(page.url()).pathname;
    const api = await page.api("/api/members");
    chk("③-권한없는팀장-진입불가", where !== "/members", `열면 → ${where}`);
    chk("③-권한없는팀장-403", api.status === 403, `API ${api.status} · ${api.body?.error ?? "—"}`);
    await ctx.close();
  }

  // ══ ①② 권한을 켠다 ═══════════════════════════════════════════════
  await sql(`UPDATE account SET admin_grant = true WHERE actor_id = $1`, [L1.id]);
  const g1 = await open(asUser(L1, "lead", true));
  await g1.page.goto(`${BASE}/members`, { waitUntil: "networkidle" });
  await g1.page.locator(".frn-skip").first().click({ timeout: 2000 })
    .catch(() => console.log("   (첫 실행 안내 없음 — 닫을 것이 없다)"));
  await g1.page.locator("table tbody tr").first().waitFor({ timeout: 8000 });
  chk("①-권한켠팀장-진입", new URL(g1.page.url()).pathname === "/members",
      `열면 → ${new URL(g1.page.url()).pathname}`);
  chk("①-역할변경칸-보임", await g1.page.locator(".role-sel").count() > 0,
      `역할 셀렉트 ${await g1.page.locator(".role-sel").count()}개`);

  // ② 이름표 — 「관리자」가 아니라 「팀장」 + 「관리자 권한」
  const nameplate = (await g1.page.locator(".acctblk .acct > div").innerText()).trim();
  chk("②-이름표-팀장", /팀장/.test(nameplate) && !/(^|\n|\s)관리자(\s|$)/.test(nameplate.replace("관리자 권한", "")),
      `이름표 "${nameplate.replace(/\n/g, " · ")}"`);
  chk("②-이름표-권한배지", await g1.page.locator(".acct-g").count() === 1,
      `「관리자 권한」 배지 ${await g1.page.locator(".acct-g").count()}개`);

  // ══ ④ role='admin' 인 사람의 권한 칸 ═════════════════════════════
  await sql(`UPDATE account SET role = 'admin' WHERE actor_id = $1`, [M1.id]);
  await g1.page.reload({ waitUntil: "networkidle" });
  await g1.page.locator("table tbody tr").first().waitFor({ timeout: 8000 });
  // 행은 이름이 아니라 **화면에 그려진 역할**로 찾는다 — 이름으로 판정하지 않는다(§G).
  const adminRow = g1.page.locator("table tbody tr").filter({ has: g1.page.locator(".role-sel.role-admin") });
  chk("④-관리자행-권한칸없음",
      await adminRow.locator(".mbr-grant input").count() === 0,
      `역할=관리자 행의 체크박스 ${await adminRow.locator(".mbr-grant input").count()}개 (0이어야 한다)`);
  const whyEl = adminRow.locator(".mbr-grant-why").first();
  const why = (await whyEl.innerText().catch(() => "")).trim();
  // `innerText` 는 **잘려도 전문을 준다.** 실제로 그래서 이 검사가 통과하는데
  // 화면에서는 "…항상 권한이 있습니" 로 잘려 있었다. 값이 있는 것과 읽히는 것은
  // 다르다 — 넘치는지도 함께 잰다.
  const clipped = await whyEl.evaluate((el) => el.scrollWidth > el.clientWidth + 1).catch(() => true);
  chk("④-이유가보인다", why.includes("역할이 관리자라") && !clipped,
      `"${why}"${clipped ? " — **열 폭에서 잘렸다**" : ""}`);
  // 화면이 안 그린다고 API 가 열려 있으면 안 된다 — **막은 것을 API 에서도 확인한다.**
  const forced = await g1.page.put(M1.id, { adminGrant: false });
  chk("④짝-API도-막힌다", forced.status === 400, `PUT ${forced.status} · ${forced.body?.error ?? "—"}`);

  await g1.page.screenshot({ path: `${OUT}/members-grant.png`, fullPage: true });

  // ══ ⑥ role='admin' 계정으로 팀장 자리 (hasLead 를 안 건드렸다는 확인) ══
  const teamWork = async (page, who) => {
    const p = await page.api("/api/projects", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `${MARK} ${who} 프로젝트` }) });
    if (p.body?.id) made.projects.push(p.body.id);
    const g = await page.api("/api/goals", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "team", periodType: "month", title: `${MARK} ${who} 목표`,
                             periodStart: "2027-03-01" }) });
    const gid = g.body?.id ?? g.body?.goal?.id;
    if (gid) made.goals.push(gid);
    const arch = gid ? await page.api(`/api/goals/${gid}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }) }) : { status: 0 };
    return { project: p.status, goal: g.status, archive: arch.status };
  };
  {
    const { ctx, page } = await open(asUser(M1, "admin", false));
    const r = await teamWork(page, "관리자");
    chk("⑥-관리자도-팀장자리", r.project === 200 && r.goal === 200 && r.archive === 200,
        `프로젝트 ${r.project} · 목표 생성 ${r.goal} · 보관 ${r.archive}`);
    await ctx.close();
  }
  // ⑦ 권한을 켠 팀장도 같은 것 — 원래 팀장이라 되는 게 맞다. 그걸 확인해 둔다.
  {
    const r = await teamWork(g1.page, "권한팀장");
    chk("⑦-권한켠팀장도-팀장자리", r.project === 200 && r.goal === 200 && r.archive === 200,
        `프로젝트 ${r.project} · 목표 생성 ${r.goal} · 보관 ${r.archive}`);
  }

  // ══ ⑤ 마지막 관리자 차단 — **짝으로 잰다** ════════════════════════
  //
  // 조건을 먼저 만든다: 역할 관리자를 내리고, 권한 관리자를 둘로 만든다.
  // 그래야 「둘일 때 통과 · 하나일 때 차단」이 같은 축에서 비교된다.
  await sql(`UPDATE account SET role = 'lead' WHERE actor_id = $1`, [M1.id]);
  await sql(`UPDATE account SET admin_grant = true WHERE actor_id = $1`, [L2.id]);
  const cnt = async () => (await sql(
    `SELECT count(*)::int n FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE (a.role = 'admin' OR a.admin_grant = true) AND ac.is_active = true`))[0].n;
  chk("⑤-조건", await cnt() === 2, `관리자 ${await cnt()}명 (2라야 ⑤가 짝이 된다)`);

  const off2 = await g1.page.put(L2.id, { adminGrant: false });
  chk("⑤-둘일때-끄기200", off2.status === 200, `PUT ${off2.status} · 남은 관리자 ${await cnt()}명`);

  const offSelf = await g1.page.put(L1.id, { adminGrant: false });
  chk("⑤-마지막하나-끄기400", offSelf.status === 400,
      `PUT ${offSelf.status} · ${offSelf.body?.error ?? "—"} (자기 자신이라도 막힌다)`);
  chk("⑤짝-막혔으면-안바뀐다", await cnt() === 1, `관리자 ${await cnt()}명 (여전히 1)`);

  await g1.ctx.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  // ── 뒷정리 ── 만든 것을 지우고, 역할·권한을 **시작 전 지문과 대조해** 되돌린다.
  for (const id of made.goals) await pool.query(`DELETE FROM goal WHERE id = $1`, [id]).catch(() => {});
  for (const id of made.projects) await pool.query(`DELETE FROM project WHERE id = $1`, [id]).catch(() => {});
  if (before) {
    for (const part of before.split(" ")) {
      const [id, rest] = part.split(":");
      await pool.query(`UPDATE account SET role = $2, admin_grant = $3 WHERE actor_id = $1`,
        [Number(id), rest.replace("+G", ""), rest.endsWith("+G")]).catch((e) => console.error("되돌리기 실패", e.message));
    }
    const after = await fp().catch(() => "(못 읽음)");
    const left = (await pool.query(
      `SELECT (SELECT count(*)::int FROM project WHERE name LIKE $1) p,
              (SELECT count(*)::int FROM goal WHERE title LIKE $1) g`, [`${MARK}%`])
      .catch(() => ({ rows: [{ p: -1, g: -1 }] }))).rows[0];
    console.log(`\n뒷정리 확인 — 역할·권한 ${after === before ? "시작 전과 같음" : `**다름**\n     전 ${before}\n     후 ${after}`}`);
    console.log(`             ${MARK} 잔여 프로젝트 ${left.p} · 목표 ${left.g} (둘 다 0이어야 한다)`);
    if (after !== before || left.p !== 0 || left.g !== 0) process.exitCode = 1;
  }
  await browser?.close();
  await pool.end();
}
