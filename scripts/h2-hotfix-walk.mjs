// H2 핫픽스 2차 (MD-P-2026-032 §0) — 세 건을 **실측으로** 확인한다.
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32). 만든 것만 지운다.
//
//   ① 새 업무 모달의 속성 팝오버가 **모달 밖으로 나가지 않는다.**
//      짝 — 팝오버를 실제로 연 행이 0개가 아니다(아무것도 안 열면 「안 넘침」도 참이다).
//   ② 모달 규격 720×560 · 고급 닫힘에서 세로 스크롤 0
//   ③ `/projects` 목록의 카드 수 = DB 활성 프로젝트 수
//   ④ `POST /api/projects` 가 성공하고 **`area_id` 가 채워진다**
//      (이 라우트는 area_id 를 안 넣어 항상 실패하던 이력이 있다)
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("h2-hotfix-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const NAME = "[검사] H2 프로젝트 생성";
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(14)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(14)} ${n}`); };

let browser;
try {
  const lead = await one(`SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
                           WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 1`);
  if (!lead) throw new Error("사람 계정이 없다 — 시드부터 하라");

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") jsErrors.push(m.text().slice(0, 160)); });

  // ── ①② 새 업무 모달 ────────────────────────────────────────────
  await page.goto(`${BASE}/tasks?panel=task:new`, { waitUntil: "domcontentloaded" });
  const frn = page.locator(".frn-skip");
  if (await frn.count()) { await frn.first().click().catch(() => {}); }
  await page.waitForSelector(".ntm", { timeout: 10000 });
  await page.waitForSelector(".ntm .prop-row", { timeout: 5000 });

  // 모달은 **열릴 때 `transform: scale()` 로 커지며 들어온다.** 뜨자마자 재면
  // 애니메이션 중간값이 잡힌다 — 705×549 를 재고 「규격이 아니다」는 틀린 FAIL 을 냈다.
  //
  // 「크기가 두 프레임 연속 같으면 끝」으로도 재 봤는데 **719×560** 이 나왔다.
  // 끝자락에서는 프레임당 변화가 0.5px 미만이라 반올림하면 같아 보인다 —
  // **멈춘 것처럼 보이는 것과 멈춘 것은 다르다.**
  //
  // 끝났다는 **진짜 신호**를 기다린다: 진입 transform 이 걷히면 `none` 이 된다.
  await page.waitForFunction(() => {
    const el = document.querySelector(".ntm");
    return !!el && getComputedStyle(el).transform === "none";
  }, { timeout: 5000, polling: "raf" }).catch(() => {});
  const box = await page.evaluate(() => {
    const el = document.querySelector(".ntm");
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height),
             세로스크롤: el.scrollHeight > el.clientHeight + 1,
             화면밖: Math.round(r.bottom) > window.innerHeight || Math.round(r.top) < 0 };
  });
  (box.w === 720 && box.h === 560 && !box.세로스크롤 && !box.화면밖)
    ? ok("②모달", `${box.w}×${box.h} · 세로 스크롤 없음 · 화면 안`)
    : bad("②모달", `규격 720×560 이 아니거나 잘린다 — ${JSON.stringify(box)}`);

  const labels = await page.$$eval(".ntm .prop-row .prop-l", (ls) => ls.map((l) => l.textContent.trim()));
  const opened = [];
  for (let i = 0; i < labels.length; i++) {
    const btn = page.locator(".ntm .prop-row").nth(i).locator("button.prop-v");
    if (await btn.count() === 0) continue;   // 편집기 없는 읽기 전용 행
    await btn.click().catch(() => {});
    // 열렸는지 **사건으로** 확인한다 — 고정 시간으로 넘기면 안 열린 것을 「안 넘침」으로 읽는다.
    const shown = await page.locator(".ntm .prop-pop").waitFor({ state: "visible", timeout: 2000 })
      .then(() => true).catch(() => false);
    if (shown) {
      opened.push({
        label: labels[i],
        ...(await page.evaluate(() => {
          const pop = document.querySelector(".ntm .prop-pop"), modal = document.querySelector(".ntm");
          const p = pop.getBoundingClientRect(), m = modal.getBoundingClientRect();
          return {
            right: Math.round(p.right - m.right), left: Math.round(m.left - p.left),
            bottom: Math.round(p.bottom - m.bottom), top: Math.round(m.top - p.top),
            clipped: pop.scrollWidth > pop.clientWidth + 1,
            w: Math.round(p.width),
          };
        })),
      });
    }
    await btn.click().catch(() => {});
  }
  const spilled = opened.filter((o) => o.right > 1 || o.left > 1 || o.bottom > 1 || o.top > 1 || o.clipped);
  if (opened.length === 0)
    bad("①팝오버", `짝이 깨졌다 — 팝오버를 연 행이 0개다. 「안 넘침」이 공짜로 참이 된다 (속성 행 ${labels.length}개)`);
  else if (spilled.length)
    bad("①팝오버", `모달 밖으로 나가는 팝오버 ${spilled.length}/${opened.length}개 — `
      + spilled.map((o) => `${o.label}(오른쪽 ${o.right}px)`).join(" · "));
  else
    ok("①팝오버", `${opened.length}개 전부 모달 안 (폭 ${opened[0].w}px) — ${opened.map((o) => o.label).join(" · ")}`);

  // ── ③ /projects 목록 ──────────────────────────────────────────
  const dbCount = Number((await one(`SELECT count(*)::int AS n FROM project WHERE is_active`)).n);
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pcard, .empty-state", { timeout: 10000 }).catch(() => {});
  const cards = await page.locator("a[href^='/projects/']").count();
  const empty = await page.$$eval(".empty-state, .sec-empty", (e) => e.map((x) => x.textContent.trim().slice(0, 40)));
  if (dbCount === 0) bad("③목록", "DB 에 활성 프로젝트가 0개다 — 목록이 비어도 판정할 수 없다(미검사)");
  else if (cards !== dbCount) bad("③목록", `DB ${dbCount}개 · 화면 ${cards}개 — 다르다. 빈 상태: ${empty.join("|") || "없음"}`);
  else ok("③목록", `DB ${dbCount}개 = 화면 ${cards}개`);

  // ── ④ POST /api/projects ─────────────────────────────────────
  const res = await page.request.post(`${BASE}/api/projects`, { data: { name: NAME, colorKey: "team" } });
  const body = await res.text();
  if (!res.ok()) bad("④생성", `HTTP ${res.status()} — ${body.slice(0, 140)}`);
  else {
    const made = await one(`SELECT id, area_id FROM project WHERE name = $1`, [NAME]);
    if (!made) bad("④생성", `HTTP 200 인데 DB 에 행이 없다 — ${body.slice(0, 120)}`);
    else if (!made.area_id) bad("④생성", `만들어졌는데 area_id 가 비었다 — 영역 필터에서 영원히 안 보인다 (project #${made.id})`);
    else ok("④생성", `HTTP 200 · project #${made.id} · area_id ${made.area_id} (NOT NULL 만족)`);
  }

  jsErrors.length === 0 ? ok("JS오류", "0건") : bad("JS오류", `${jsErrors.length}건 — ${jsErrors[0]}`);
} catch (e) {
  console.log(String(e && e.stack ? e.stack : e));
  bad("예외", String(e && e.message ? e.message.split("\n")[0] : e));
} finally {
  if (browser) { try { await browser.close(); } catch (e) { console.log(`   브라우저 종료 실패: ${e}`); } }
  const tidy = async (label, text, params) => {
    try { await sql(text, params); }
    catch (e) { console.log(`   정리 실패 ${label}: ${String(e && e.message ? e.message : e)} — 손으로 지워야 한다`); }
  };
  await tidy("activity_log", `DELETE FROM activity_log WHERE message LIKE '%' || $1 || '%'`, [NAME]);
  await tidy("project", `DELETE FROM project WHERE name = $1`, [NAME]);
  try { await pool.end(); } catch { /* 종료 경로 */ }
  const f = rows.filter((r) => r.pass === false).length;
  const p = rows.filter((r) => r.pass === true).length;
  console.log(`\n결과 ${p}/${p + f} 통과`);
  if (rows.length === 0) { console.error("측정된 줄이 0건이다 — 서버가 떠 있는지 확인하라"); process.exit(2); }
  process.exit(f ? 1 : 0);
}
