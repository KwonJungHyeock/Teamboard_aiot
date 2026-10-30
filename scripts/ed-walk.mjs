// 디자인 v1.0 전 화면 점검 (2026-10 리디자인) — 로컬 DB 전용.
//
//   node scripts/ed-walk.mjs            (BASE 기본 http://127.0.0.1:3000, 개발 서버가 떠 있어야 한다)
//
// 화면마다 · 라이트/다크 · 폭 980 / 1100 / 1440 · 높이 900 / 700 에서:
//   ① 콘솔 오류 0    ② 가로 넘침 0    ③ 상단 메뉴 아홉(팀장 기준)이 전부 캡슐 안에 보인다
//   ④ 계속 움직이는 것(무한 반복 애니메이션)은 배경 층을 빼고 화면당 1곳 이하
//   ⑤ animation-fill-mode 에 both · forwards 가 없다    ⑥ 테마가 html[data-theme] 로 바뀐다
// 그리고 한 번씩: 로그인 화면 · 등록창 한글 조합 중 Enter 무시 · ?task= 드로어 열고 Esc 닫기.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("ed-walk.mjs");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(34)} ${n}`); } else { fail++; console.log(`FAIL ${id.padEnd(34)} ${n}`); } };

const SCREENS = ["/v3/control", "/v3/my", "/v3/log", "/v3/report", "/v3/tasks", "/v3/goals", "/v3/stats", "/v3/calendar", "/v3/room", "/v3/me", "/v3/settings"];
const SIZES = [[1440, 900], [1100, 900], [980, 700]];
const MARK = "[검사]";
let browser;
try {
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead) throw new Error("팀장 계정이 하나 필요하다");
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-proxy-server", "--no-sandbox"] });

  for (const theme of ["light", "dark"]) {
    for (const [w, h] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
        value: tok({ id: lead.id, actorId: lead.id, name: lead.nm, role: lead.role, adminGrant: lead.admin_grant, email: "x@x" }) }]);
      await ctx.addInitScript((t) => { try { localStorage.setItem("eduino-theme", t); } catch { /* */ } }, theme);
      const page = await ctx.newPage();
      for (const path of SCREENS) {
        const errs = [];
        // 다음 화면으로 넘어가며 끊긴 미리 불러오기(RSC prefetch)는 화면 오류가 아니다
        const onC = (m) => { if (m.type() === "error" && !m.text().startsWith("Failed to fetch RSC payload")) errs.push(m.text().slice(0, 140)); };
        const onE = (e) => errs.push(String(e).slice(0, 140));
        page.on("console", onC); page.on("pageerror", onE);
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90000 });
        await page.waitForTimeout(1200);
        const r = await page.evaluate(() => {
          const over = document.documentElement.scrollWidth - window.innerWidth;
          const nav = document.querySelector(".ed-nav");
          const nr = nav?.getBoundingClientRect();
          const items = [...(nav?.querySelectorAll("a") ?? [])];
          // 캡슐 안에서 가려진 메뉴 = 캡슐 밖으로 삐져나간 것
          const hidden = items.filter((a) => { const b = a.getBoundingClientRect(); return !nr || b.left < nr.left - 1 || b.right > nr.right + 1; }).map((a) => a.textContent);
          let loops = 0, bad = 0; const loopWho = [];
          for (const el of document.querySelectorAll("body *")) {
            if (el.closest(".ed-bg")) continue;
            const cs = getComputedStyle(el);
            if (cs.animationName === "none") continue;
            const vis = el.getClientRects().length > 0 && cs.visibility !== "hidden";
            if (vis && cs.animationIterationCount.split(",").some((x) => x.trim() === "infinite")) { loops++; loopWho.push(`${el.className}`.slice(0, 30)); }
            if (cs.animationFillMode.split(",").some((x) => /both|forwards/.test(x))) bad++;
          }
          return { over, menus: items.length, hidden, loops, loopWho, bad, theme: document.documentElement.dataset.theme };
        });
        page.off("console", onC); page.off("pageerror", onE);
        const id = `${path.replace("/v3/", "")}·${theme}·${w}x${h}`;
        chk(id, errs.length === 0 && r.over <= 0 && r.menus === 9 && r.hidden.length === 0 && r.loops <= 1 && r.bad === 0 && r.theme === theme,
          `오류 ${errs.length}${errs[0] ? ` (${errs[0]})` : ""} · 넘침 ${r.over} · 메뉴 ${r.menus} 가림 [${r.hidden}] · 반복 ${r.loops}${r.loops > 1 ? ` [${r.loopWho}]` : ""} · fill ${r.bad} · ${r.theme}`);
      }
      await ctx.close();
    }
  }

  // ── 한 번씩 ───────────────────────────────────────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const lp = await ctx.newPage();
  await lp.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  chk("로그인-화면", (await lp.locator(".lg-card input").count()) === 2 && (await lp.locator(".lg-card .go").innerText()).includes("로그인"), "입력 2 · 로그인 버튼");
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: lead.id, actorId: lead.id, name: lead.nm, role: lead.role, adminGrant: lead.admin_grant, email: "x@x" }) }]);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/v3/my`, { waitUntil: "networkidle" });
  const input = p.locator(".ed-comp input").first();
  await input.click();
  // 조합 중 Enter — isComposing 이 참인 keydown 은 등록하지 않는다
  const before = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1 AND is_active`, [`${MARK} 조합%`]))[0].n;
  await input.fill(`${MARK} 조합 시험`);
  await p.evaluate(() => {
    const el = document.querySelector(".ed-comp input");
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }));
  });
  await p.waitForTimeout(1200);
  const mid = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1 AND is_active`, [`${MARK} 조합%`]))[0].n;
  await input.press("Enter");
  await p.waitForTimeout(2000);
  const made = await sql(`SELECT id FROM task WHERE title LIKE $1 AND is_active`, [`${MARK} 조합%`]);
  chk("등록창-한글-조합", mid === before && made.length === before + 1, `조합 중 Enter 뒤 ${mid - before}건 · 끝난 뒤 Enter ${made.length - before}건`);
  if (made[0]) {
    await p.goto(`${BASE}/v3/tasks?task=${made[0].id}`, { waitUntil: "networkidle" });
    await p.waitForTimeout(800);
    const open = await p.locator(".ed-drawer").count();
    await p.keyboard.press("Escape");
    await p.waitForTimeout(800);
    chk("드로어-열고-Esc", open === 1 && (await p.locator(".ed-drawer").count()) === 0 && !p.url().includes("task="), `열림 ${open} · 닫힌 뒤 주소 ${new URL(p.url()).search || "(없음)"}`);
  }
  await ctx.close();
} catch (e) {
  fail++; console.log("FAIL 실행 중 오류", e?.message ?? e);
} finally {
  await pool.query(`UPDATE task SET is_active = false WHERE title LIKE $1`, [`${MARK} 조합%`]).catch(() => {});
  await browser?.close();
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
