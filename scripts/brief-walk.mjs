// AI 주간 브리핑 — 팀 공개인 것만 보내고, 숫자는 서버가 센 값이고, 다시 만들기는 팀장만.
//
//   node scripts/brief-walk.mjs            재기만 한다
//   SHOT=1 node scripts/brief-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 없으면 null · 팀원이 처음 만들 수 있다 · 숫자가 DB 에서 직접 센 값과 같다
//   ② 이미 있으면 팀원은 403, 팀장은 다시 만든다
//   ③ **새지 않는다** — 이번 주에 끝낸 개인 업무 · 내 기록 한 줄이 브리핑 글에도 사실에도 없다
//   ④ 화면 — 관제에 카드 · 「이번 주」 → 만들기 → 글이 뜬다 · 390px · 콘솔 오류 0
//
// 로컬에는 AI 키가 없어 **데모 글**(사실 나열)로 잰다. 실제 AI 글은 여기서 못 잰다.
// **로컬 전용.** 이번 주 · 지난주 브리핑 값은 시작 전으로 되돌리고, 「[검사]」 업무 · 기록은 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("brief-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/brief";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const MARK = "[검사]";
let browser, saved = [], keys = [], ids = [];
try {
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead || !member) throw new Error("팀장 하나 · 팀원 하나가 필요하다");
  ids = [lead.id, member.id];
  const cookie = (u) => `tb_session=${tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" })}`;
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: cookie(u), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const wThis = (await api(member, "GET", "/api/brief?week=this")).data.week;
  const wLast = (await api(member, "GET", "/api/brief?week=last")).data.week;
  keys = [`weekly_brief:${wThis.start}`, `weekly_brief:${wLast.start}`];
  saved = await sql(`SELECT key, value, updated_by FROM config WHERE key = ANY($1)`, [keys]);
  await sql(`DELETE FROM config WHERE key = ANY($1)`, [keys]);

  // ③ 의 조건 — 이번 주에 끝낸 **개인** 업무 하나, 내 기록 한 줄
  const priv = await api(member, "POST", "/api/tasks", { title: `${MARK} 비밀 개인 업무`, visibility: "private", status: "done" });
  await sql(`UPDATE task SET status = 'done', completed_at = now() WHERE id = $1`, [priv.data?.id]);
  await api(member, "POST", "/api/worklog", { body: `${MARK} 나만 보는 기록` });

  // ── ① ─────────────────────────────────────────────────────────
  const none = await api(member, "GET", "/api/brief?week=this");
  const made = await api(member, "POST", "/api/brief", { week: "this" });
  const f = made.data?.brief?.facts ?? {};
  const doneDb = Number((await sql(
    `SELECT count(*) n FROM (SELECT 1 FROM task t WHERE t.is_active AND t.visibility = 'team' AND t.status = 'done'
        AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date LIMIT 40) x`, [wThis.start, wThis.end]))[0].n);
  const lateDb = Number((await sql(
    `SELECT count(*) n FROM task t WHERE t.is_active AND t.visibility = 'team' AND t.status IN ('todo','doing','review') AND t.due_date <= $1::date`,
    [wThis.end]))[0].n);
  chk("①-만들고-숫자는-DB-값", none.data?.brief === null && made.status === 200 && f.done === doneDb && f.lateTotal === lateDb,
      `없음 ${none.data?.brief === null} · 만들기 ${made.status}${made.data?.brief?.demo ? "(데모)" : ""} · 끝낸 ${f.done}/${doneDb} · 기한 지남 ${f.lateTotal}/${lateDb}`);

  // ── ② ─────────────────────────────────────────────────────────
  const again = await api(member, "POST", "/api/brief", { week: "this" });
  const leadAgain = await api(lead, "POST", "/api/brief", { week: "this" });
  chk("②-다시-만들기는-팀장", again.status === 403 && leadAgain.status === 200 && leadAgain.data?.brief?.by === lead.nm,
      `팀원 ${again.status} · 팀장 ${leadAgain.status} (만든 사람 ${leadAgain.data?.brief?.by})`);

  // ── ③ ─────────────────────────────────────────────────────────
  const text = leadAgain.data?.brief?.text ?? "";
  const row = (await sql(`SELECT value::text v FROM config WHERE key = $1`, [keys[0]]))[0]?.v ?? "";
  chk("③-개인-업무·내-기록은-안-샌다", priv.status === 200 && !text.includes("비밀 개인 업무") && !text.includes("나만 보는 기록")
      && !row.includes("비밀 개인 업무") && !row.includes("나만 보는 기록"),
      `개인 업무 ${text.includes("비밀 개인 업무") ? "**보임**" : "없음"} · 내 기록 ${text.includes("나만 보는 기록") ? "**보임**" : "없음"}`);

  // ── ④ 화면 ───────────────────────────────────────────────────
  await sql(`DELETE FROM config WHERE key = $1`, [keys[0]]);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: member.id, actorId: member.id, name: member.nm, role: member.role, adminGrant: member.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type(); if (t === "error" || t === "warning") errs.push(`[${t}] ${m.text().slice(0, 160)}`); });
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });
  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  await page.locator(".v3-brief").waitFor({ timeout: 9000 });
  await page.getByRole("tab", { name: "이번 주" }).click();
  await page.getByRole("button", { name: "브리핑 만들기" }).click();
  await page.locator(".v3-brief-t h3").first().waitFor({ timeout: 60000 });
  const heads = await page.locator(".v3-brief-t h3").allInnerTexts();
  const again2 = await page.getByRole("button", { name: "다시 만들기" }).count();
  await page.locator(".v3-brief").scrollIntoViewIfNeeded();
  await shot(page, { path: `${OUT}/B1-관제-브리핑.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  chk("④-화면", heads.join("|") === "한 주 요약|끝낸 것|정한 것|밀리는 것|다음 주에 볼 것" && again2 === 0 && over <= 0,
      `제목 [${heads.join(" · ")}] · 팀원에게 다시 만들기 ${again2}개 · 390px 넘침 ${over}`);
  chk("④-콘솔-오류-0", errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "0건");
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  if (keys.length) {
    await sql(`DELETE FROM config WHERE key = ANY($1)`, [keys]).catch(() => {});
    for (const s of saved) await sql(`INSERT INTO config (key, value, updated_by) VALUES ($1, $2, $3)`, [s.key, s.value, s.updated_by]).catch(() => {});
  }
  await sql(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM task WHERE title LIKE $1 || '%'`, [MARK]).catch(() => {});
  if (ids.length) await sql(`DELETE FROM work_log WHERE owner_actor_id = ANY($1) AND body LIKE '%' || $2 || '%'`, [ids, MARK]).catch(() => {});
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
