// 하루 한 줄 · 상태 (0039) — 적으면 팀이 보고, 고치는 것은 내 줄뿐.
//
//   node scripts/daily-walk.mjs            재기만 한다
//   SHOT=1 node scripts/daily-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① API — 한 줄을 적으면 오늘 줄로 읽힌다 · 상태만 보내면 한 줄은 그대로 · 비우면 비워진다
//   ② 막는 것 — 모르는 상태 · 200자 넘는 줄 · 아무것도 안 보냄은 400
//   ③ 남의 줄 — 다른 사람이 적은 줄이 내 PUT 으로 안 바뀐다(주소에 사람을 받지 않는다)
//   ④ 관제 — 「오늘 할 일」 칸에 쓰고 엔터 → 「지금 팀」 내 줄 밑에 뜬다 · 집중을 누르면 칩이 선다
//   ⑤ 남의 줄이 관제에 보인다(팀 공개)
//   ⑥ 390px 에서 옆으로 안 넘친다 · 콘솔 오류 0
//
// **로컬 전용.** 두 사람의 오늘 행을 시작 전 값으로 되돌린다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("daily-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/daily";
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
let browser, before = [], ids = [], today = "";
try {
  const people = await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active ORDER BY (a.role IN ('admin','lead')) DESC, a.actor_id LIMIT 2`);
  if (people.length < 2) throw new Error("활성 계정이 둘 필요하다");
  const [me, other] = people;
  ids = [me.id, other.id];
  today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  before = await sql(`SELECT actor_id, line, state FROM daily_note WHERE day = $1::date AND actor_id = ANY($2)`, [today, ids]);
  await sql(`DELETE FROM daily_note WHERE day = $1::date AND actor_id = ANY($2)`, [today, ids]);

  const cookie = (u) => `tb_session=${tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" })}`;
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: cookie(u), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  // ── ① ─────────────────────────────────────────────────────────
  const w1 = await api(me, "PUT", "/api/daily", { line: `${MARK} 덱 빌더 업로드 마무리` });
  const w2 = await api(me, "PUT", "/api/daily", { state: "focus" });
  const r1 = (await api(other, "GET", "/api/daily")).data?.notes?.[me.id];
  const w3 = await api(me, "PUT", "/api/daily", { state: null });
  const r2 = (await api(other, "GET", "/api/daily")).data?.notes?.[me.id];
  chk("①-적고-읽힌다", w1.status === 200 && w2.status === 200 && w3.status === 200
      && r1?.line?.includes("덱 빌더") && r1?.state === "focus" && r2?.line?.includes("덱 빌더") && r2?.state === null,
      `한 줄 ${w1.status} · 상태 ${w2.status} → 남이 읽음 "${r1?.line}" / ${r1?.state} · 상태 비움 → ${r2?.state} (한 줄 그대로 ${!!r2?.line})`);

  // ── ② ─────────────────────────────────────────────────────────
  const b1 = await api(me, "PUT", "/api/daily", { state: "sleep" });
  const b2 = await api(me, "PUT", "/api/daily", { line: "가".repeat(201) });
  const b3 = await api(me, "PUT", "/api/daily", {});
  chk("②-막는-것", b1.status === 400 && b2.status === 400 && b3.status === 400,
      `모르는 상태 ${b1.status} · 201자 ${b2.status} · 빈 요청 ${b3.status}`);

  // ── ③ ─────────────────────────────────────────────────────────
  await api(other, "PUT", "/api/daily", { line: `${MARK} 남의 줄`, state: "out" });
  await api(me, "PUT", "/api/daily", { line: `${MARK} 내 줄`, actorId: other.id, actor_id: other.id });
  const o = (await api(me, "GET", "/api/daily")).data?.notes?.[other.id];
  chk("③-남의-줄은-안-바뀐다", o?.line === `${MARK} 남의 줄` && o?.state === "out", `남의 줄 "${o?.line}" · ${o?.state}`);

  // ── ④⑤ 화면 ───────────────────────────────────────────────────
  await api(me, "PUT", "/api/daily", { line: null, state: null });
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: me.nm, role: me.role, adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type(); if (t === "error" || t === "warning") errs.push(`[${t}] ${m.text().slice(0, 160)}`); });
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });

  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  await page.locator("#v3-myday").fill(`${MARK} 화면에서 적은 한 줄`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1800);
  await page.getByRole("button", { name: "집중" }).click();
  await page.waitForTimeout(1800);
  const row = (name) => page.locator(".v3-ctl-m").filter({ has: page.locator("b", { hasText: name }) }).first();
  const mine = await row(me.nm).innerText().catch(() => "");
  const theirs = await row(other.nm).innerText().catch(() => "");
  const pressed = await page.getByRole("button", { name: "집중" }).getAttribute("aria-pressed");
  await shot(page, { path: `${OUT}/D1-관제.png`, fullPage: true });
  chk("④-관제에서-적는다", mine.includes("화면에서 적은 한 줄") && mine.includes("집중") && pressed === "true",
      `내 줄 ${mine.includes("화면에서 적은 한 줄") ? "보임" : "안 보임"} · 집중 칩 ${mine.includes("집중")} · 눌림 ${pressed}`);
  chk("⑤-남의-줄이-보인다", theirs.includes("남의 줄") && theirs.includes("외근"), `남의 줄 ${theirs.includes("남의 줄")} · 외근 ${theirs.includes("외근")}`);

  // ── ⑥ ─────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, { path: `${OUT}/D2-좁은화면.png`, fullPage: true });
  chk("⑥-390px", over <= 0, `넘친 폭 ${over}px`);
  chk("⑥-콘솔-오류-0", errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "0건");
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  if (ids.length && today) {
    await sql(`DELETE FROM daily_note WHERE day = $1::date AND actor_id = ANY($2)`, [today, ids]).catch(() => {});
    for (const b of before)
      await sql(`INSERT INTO daily_note (actor_id, day, line, state) VALUES ($1, $2::date, $3, $4)`,
                [b.actor_id, today, b.line, b.state]).catch((e) => console.log(`되돌리기 실패 ${e.message}`));
    console.log(`\n되돌림 — 오늘 행 ${before.length}개를 시작 전 값으로`);
  }
  await pool.end();
  console.log(`합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
