// 공간 모드 스위치 — 겉모습만 바뀌고, 사람마다이고, 서버에 안 쓴다 (`lib/v3/look.ts`).
//
//   node scripts/space-look-walk.mjs            재기만 한다
//   SHOT=1 node scripts/space-look-walk.mjs     아홉 화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 기본은 꺼짐 — 쿠키가 없으면 지금 화면 그대로(`v3-space` 없음)
//   ② 스위치는 한 화면에 하나 — 넓은 화면 본문 위 · 좁은 화면 위 바
//   ③ 누르면 쿠키만 바뀐다 — **그 사이 /api 요청 0**
//   ④ 다시 열어도 켜진 채 — 서버가 첫 HTML 부터 `v3-space` 로 낸다(번쩍임 없음)
//   ⑤ 주소가 그대로 — 레일의 링크 목록이 켜기 전과 같다
//   ⑥ 아홉 화면이 공간 모드에서 오류 없이 열린다
//   ⑦ 움직임을 줄여 달라면 흐르는 빛이 멈춘다
//   ⑧ 끄면 쿠키가 지워지고 원래 모습
//   ⑨ `app/v3.css` 는 main 과 한 글자도 다르지 않다(토큰을 안 고쳤다)
//
// **로컬 전용.** `ui_v3_enabled` 를 잠깐 켜고 끝나면 원래 값으로 되돌린다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("space-look-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/space-look";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const WIDE = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const SCREENS = ["/v3", "/v3/tasks", "/v3/team", "/v3/goals", "/v3/calendar", "/v3/stats", "/v3/new", "/v3/members", "/v3/me"];

const SHOWN = `(el) => {
  if (el.getClientRects().length === 0) return false;
  const s = getComputedStyle(el);
  return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
}`;

let browser, swBefore = null;
try {
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role = 'admin' OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const errs = [];
  const open = async (viewport, extra = {}) => {
    const c = await browser.newContext({ viewport, ...extra });
    await c.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
      value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                   adminGrant: me.admin_grant, email: "x@x" }) }]);
    const p = await c.newPage();
    p.on("pageerror", (e) => errs.push(`${p.url()} ${e.message}`));
    return { c, p };
  };
  const state = (p) => p.evaluate(`(() => {
    const shown = ${SHOWN};
    const root = document.querySelector(".v3");
    const looks = Array.from(document.querySelectorAll(".v3-look")).filter(shown);
    return {
      space: root ? root.classList.contains("v3-space") : null,
      looks: looks.length,
      checked: looks[0] ? looks[0].getAttribute("aria-checked") : null,
      links: Array.from(document.querySelectorAll(".v3-rail a")).map((a) => a.getAttribute("href")).join(" "),
      cookie: document.cookie.split("; ").find((c) => c.startsWith("v3_look=")) ?? "",
    };
  })()`);

  // ── 넓은 화면 ────────────────────────────────────────────────
  const w = await open(WIDE);
  await w.p.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  const off0 = await state(w.p);
  chk("①-기본은-꺼짐", off0.space === false && off0.checked === "false" && off0.cookie === "",
      `v3-space ${off0.space} · aria-checked ${off0.checked} · 쿠키 "${off0.cookie}"`);
  chk("②-넓은-화면-스위치-하나", off0.looks === 1, `보이는 스위치 ${off0.looks}개`);

  const api = [];
  const onReq = (r) => { if (new URL(r.url()).pathname.startsWith("/api")) api.push(`${r.method()} ${r.url()}`); };
  w.p.on("request", onReq);
  await w.p.locator(".v3-look-top").click();
  await w.p.waitForTimeout(600);
  w.p.off("request", onReq);
  const on1 = await state(w.p);
  chk("③-누르면-쿠키만", on1.space === true && on1.checked === "true" && on1.cookie === "v3_look=space" && api.length === 0,
      `v3-space ${on1.space} · 쿠키 "${on1.cookie}" · 그 사이 /api 요청 ${api.length}개 ${api.join(", ")}`);

  // 서버가 낸 첫 HTML 에 이미 들어 있는가 — 자바스크립트가 돌기 전
  const html = await (await w.c.request.get(`${BASE}/v3/tasks`)).text();
  const firstPaint = /class="v3 v3-space/.test(html);
  await w.p.reload({ waitUntil: "networkidle" });
  const on2 = await state(w.p);
  chk("④-다시-열어도-켜짐", firstPaint && on2.space === true,
      `첫 HTML 에 v3-space ${firstPaint} · 다시 연 뒤 ${on2.space}`);
  chk("⑤-주소가-그대로", on2.links === off0.links && off0.links.length > 0,
      `레일 링크 ${off0.links.split(" ").length}개 — 켜기 전과 ${on2.links === off0.links ? "같다" : "다르다"}`);

  if (process.env.SHOT === "1") mkdirSync(OUT, { recursive: true });
  const before = errs.length;
  const bad = [];
  for (const s of SCREENS) {
    const r = await w.p.goto(`${BASE}${s}`, { waitUntil: "networkidle" });
    await w.p.waitForTimeout(700);
    const st = await state(w.p);
    if (!r || r.status() >= 400 || !st.space) bad.push(`${s}(${r?.status()} space=${st.space})`);
    await shot(w.p, { path: `${OUT}/wide-${s.replace(/\//g, "_") || "_"}.png`, fullPage: false });
  }
  chk("⑥-아홉-화면-오류-없음", bad.length === 0 && errs.length === before,
      `${SCREENS.length}곳 · 막힘 ${bad.join(" ") || "0"} · 페이지 오류 ${errs.length - before}개 ${errs.slice(before).join(" | ")}`);

  // ── 좁은 화면 ────────────────────────────────────────────────
  const ph = await open(PHONE);
  await ph.c.addCookies([{ name: "v3_look", value: "space", domain: new URL(BASE).hostname, path: "/" }]);
  await ph.p.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  const pOn = await state(ph.p);
  await shot(ph.p, { path: `${OUT}/phone-tasks.png` });
  await ph.p.locator(".v3-look-bar").click();
  await ph.p.waitForTimeout(400);
  const pOff = await state(ph.p);
  chk("②-좁은-화면-스위치-하나", pOn.looks === 1 && pOn.space === true && pOff.space === false,
      `보이는 스위치 ${pOn.looks}개 · 켜짐 ${pOn.space} → 누른 뒤 ${pOff.space}`);

  // ── 움직임 줄이기 ────────────────────────────────────────────
  const rm = await open(WIDE, { reducedMotion: "reduce" });
  await rm.c.addCookies([{ name: "v3_look", value: "space", domain: new URL(BASE).hostname, path: "/" }]);
  await rm.p.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  const anim = await rm.p.evaluate(`(() => {
    const b = document.querySelector(".v3-sp-blob");
    const m = document.querySelector(".v3-main > *:last-child");
    return { blob: b ? getComputedStyle(b).animationName : "없음", rise: m ? getComputedStyle(m).animationName : "없음" };
  })()`);
  chk("⑦-움직임-줄이면-멈춤", anim.blob === "none" && anim.rise === "none",
      `흐르는 빛 animation ${anim.blob} · 떠오르기 ${anim.rise}`);

  // ── 끄기 ─────────────────────────────────────────────────────
  await w.p.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await w.p.locator(".v3-look-top").click();
  await w.p.waitForTimeout(400);
  await w.p.reload({ waitUntil: "networkidle" });
  const off2 = await state(w.p);
  chk("⑧-끄면-원래-모습", off2.space === false && off2.cookie === "",
      `v3-space ${off2.space} · 쿠키 "${off2.cookie}"`);

  let same = true;
  try { execFileSync("git", ["diff", "--quiet", "origin/main", "--", "app/v3.css"]); } catch { same = false; }
  chk("⑨-v3.css-그대로", same, `app/v3.css 가 origin/main 과 ${same ? "같다" : "다르다"}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 ${e.stack ?? e}`);
} finally {
  await browser?.close();
  if (swBefore === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
  else await sql(`UPDATE config SET value = $2 WHERE key = $1`, [KEY, JSON.stringify(swBefore)]);
  await pool.end();
  console.log(`\n${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
