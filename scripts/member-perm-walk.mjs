// 팀원에게 **못 하는 일을 시키지 않는다** (MD-P-2026-062 §B-8).
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 팀원 토큰으로 화면을 다 열어도 **권한으로 막힌 응답이 0건**
//      짝 — 화면을 실제로 읽었다(요청이 돌았고 글자가 있다). 빈 화면이면 0도 참이다.
//   ② /reports 에서 **승인 보고서 자리가 팀원에게 없다**
//      짝 — 팀장에게는 **있다.** 아무에게도 없으면 ② 는 늘 통과한다(§G 053).
//   ③ 서버는 여전히 막는다 — 팀원 토큰으로 `GET /api/reports` → 403
//      화면이 가리는 건 편의고 서버가 막는 건 보증이다(§G 061).
//   ④ 콘솔 오류·경고 0 (무시 목록은 scripts/console-ignore.mjs 한 곳)
//
// ── 왜 응답 코드로 세는가 ────────────────────────────────────────
// 콘솔 글자(`Failed to load resource … 403`)로 세면 브라우저가 문구를 바꾸는
// 날 검사가 조용히 아무것도 안 세게 된다. **응답 코드**는 우리가 읽는 값이고
// 그 값을 만든 쪽(서버)에서 온다(§G 048).
//
// **로컬 전용** — 아래 requireLocalDb 가 강제한다. 데이터를 안 만든다(읽기만).
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";   // 안 세는 것은 한 파일에 (061 §D-14)

requireLocalDb("member-perm-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(28)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(28)} ${n}`); } };

/** 팀원이 열 수 있는 화면. /settings 처럼 페이지가 통째로 막힌 곳은 뺀다. */
const ROUTES = ["/", "/tasks", "/goals", "/projects", "/calendar", "/signals", "/inbox",
  "/activity", "/huddle", "/reports", "/handover", "/members", "/saved", "/notes",
  "/profile", "/status", "/areas/1"];

let browser;
try {
  const member = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name n
       FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE a.role = 'member' AND NOT a.admin_grant AND ac.is_active
      ORDER BY a.actor_id LIMIT 1`))[0];
  const lead = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name n
       FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE (a.role IN ('admin','lead') OR a.admin_grant) AND ac.is_active
      ORDER BY a.actor_id LIMIT 1`))[0];
  if (!member || !lead) throw new Error("팀원·팀장 계정이 둘 다 있어야 한다 — 조건을 못 만든다");
  console.log(`팀원 #${member.id} ${member.n} (${member.role}) · 팀장 #${lead.id} ${lead.n} (${lead.role})\n`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctxFor = async (u) => {
    const c = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await c.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
      value: tok({ id: u.id, actorId: u.id, name: u.n, role: u.role, adminGrant: u.admin_grant, email: "x@x" }) }]);
    return c;
  };

  const errs = [], ignored = [];
  const watch = (p) => {
    p.on("pageerror", (e) => (ignoredWhy(e.message) ? ignored : errs).push(e.message.slice(0, 160)));
    p.on("console", (m) => { const k = m.type();
      if (k !== "error" && k !== "warning") return;
      const line = `[${k}] ${m.text().slice(0, 160)}`;
      (ignoredWhy(line) ? ignored : errs).push(line); });
  };

  // ── ① 팀원으로 다 열어 본다 ───────────────────────────────────
  const mCtx = await ctxFor(member);
  const denied = [];            // { route, line }
  let reqs = 0, chars = 0;
  for (const r of ROUTES) {
    const p = await mCtx.newPage();
    watch(p);
    p.on("request", () => reqs++);
    p.on("response", (res) => {
      const s = res.status();
      if (s === 401 || s === 403)
        denied.push(`${r} ← ${s} ${res.request().method()} ${new URL(res.url()).pathname}`);
    });
    await p.goto(`${BASE}${r}`, { waitUntil: "networkidle" }).catch(() => {});
    await p.waitForTimeout(800);
    chars += (await p.locator("body").innerText().catch(() => "")).length;
    await p.close();
  }
  chk("①-팀원에게-막힌-응답-0건", denied.length === 0,
      `화면 ${ROUTES.length}개 · 401/403 ${denied.length}건${denied.length ? ` [${denied.join(" · ")}]` : ""}` +
      ` — 콘솔 글자가 아니라 응답 코드로 셌다`);
  chk("①짝-화면을-실제로-읽었다", reqs > 100 && chars > 2000,
      `요청 ${reqs}건 · 본문 글자 ${chars}자 (빈 화면이면 위 0건은 뜻이 없다)`);

  // ── ② 승인 보고서 자리가 팀원에게 없다 ────────────────────────
  //
  // 「탭이 없다」만 물으면 화면이 통째로 안 뜬 경우도 통과한다. 팀원에게
  // **보여야 하는** 탭(성과 리포트 쪽)이 그려졌는지를 같이 본다.
  const seeReports = async (ctx) => {
    const p = await ctx.newPage();
    watch(p);
    await p.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
    await p.waitForTimeout(700);
    const r = { tabs: await p.locator(".pg-tab").allInnerTexts(),
                text: await p.locator("body").innerText().catch(() => "") };
    await p.close();
    return r;
  };
  const asMember = await seeReports(mCtx);
  const lCtx = await ctxFor(lead);
  const asLead = await seeReports(lCtx);
  const hasApproval = (v) => v.tabs.some((t) => t.includes("승인 보고서"));
  chk("②-팀원에겐-승인-보고서-자리가-없다",
      !hasApproval(asMember) && asMember.text.length > 200,
      `팀원이 본 탭 [${asMember.tabs.join(" | ") || "(없음)"}] · 본문 ${asMember.text.length}자`);
  chk("②짝-팀장에겐-있다", hasApproval(asLead),
      `팀장이 본 탭 [${asLead.tabs.join(" | ") || "(없음)"}]` +
      ` — 아무에게도 없으면 ②는 늘 통과한다`);

  // ── ③ 서버는 여전히 막는다 ────────────────────────────────────
  const direct = await mCtx.request.get(`${BASE}/api/reports`);
  const body = await direct.text();
  chk("③-서버는-그대로-막는다", direct.status() === 403,
      `팀원 토큰으로 GET /api/reports → ${direct.status()} ${body.slice(0, 60)}` +
      ` — 화면이 안 부르는 건 편의고 이쪽이 보증이다`);

  await mCtx.close();
  await lCtx.close();

  chk("④-콘솔오류", errs.length === 0,
      `${errs.length}건${errs.length ? ` [${errs[0]}]` : ""} · 무시 목록에 걸린 것 ${ignored.length}건은 따로 셌다`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  await browser?.close();
  await pool.end();
}
