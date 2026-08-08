// 모션 프레임 실측 (MD-P-2026-027 지시 32-e · 32-f).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 32-e 모션마다 시작·중간·끝 3장을 캡처한다. 라벨은 파일명이 아니라
//      **화면에서 읽은 값**(computed style · 실제 transform · 실제 opacity)이다 (§G 캡처 라벨 규격).
// 32-f prefers-reduced-motion: reduce 를 켠 채 21경로를 훑고,
//      transform 애니메이션이 남아 있지 않은지 실측한다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("motion-frames.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-027/motion";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const MARK = "[모션실측]";
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const say = (id, note) => { rows.push({ id, note }); console.log(`  ${id.padEnd(22)} ${note}`); };

const PATHS = ["/", "/tasks", "/goals", "/projects", "/projects/1", "/calendar", "/signals",
  "/signals?tab=decision", "/inbox", "/activity", "/huddle", "/assistant", "/reports", "/handover",
  "/members", "/settings", "/saved", "/notes", "/profile", "/status", "/areas/1"];

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const cookie = { name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" };

  // ══════════════════════════════════════════════════════════════════
  // 32-e — 모션별 프레임 3장 (시작 · 중간 · 끝)
  // ══════════════════════════════════════════════════════════════════
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  /** 세 시점에 찍는다. 라벨은 화면에서 읽은 실제 값이다. */
  async function frames(id, read, act, mid = 90) {
    const t0 = await read();
    await page.screenshot({ path: `${OUT}/${id}-1시작.png` });
    await act();
    await page.waitForTimeout(mid);
    const t1 = await read();
    await page.screenshot({ path: `${OUT}/${id}-2중간.png` });
    await page.waitForTimeout(700);
    const t2 = await read();
    await page.screenshot({ path: `${OUT}/${id}-3끝.png` });
    say(id, `시작 ${t0} → 중간 ${t1} → 끝 ${t2}`);
  }

  console.log("\n── 32-e 모션 프레임 (시작 · 중간 · 끝, 화면에서 읽은 값) ──");

  // H3-⑨⑩ 모달 열림·닫힘 — scale .96 → 1
  await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  await page.locator(".frn-x").first().click().catch(() => {});
  const readModal = async () => {
    const n = await page.locator(".ntm").count();
    if (n === 0) return "모달 없음";
    const m = await page.locator(".ntm").evaluate((el) => getComputedStyle(el).transform);
    const o = await page.locator(".ntm").evaluate((el) => getComputedStyle(el).opacity);
    return `matrix ${m} · opacity ${o}`;
  };
  await frames("H3-09모달열림", readModal, async () => {
    await page.locator(".iti-q").first().fill("");
    await page.keyboard.press("Meta+Enter");
  }, 60);

  const readBg = async () => {
    const n = await page.locator(".ntm-bg").count();
    return n === 0 ? "스크림 없음"
      : `스크림 opacity ${await page.locator(".ntm-bg").evaluate((el) => getComputedStyle(el).opacity)}`;
  };
  await frames("H3-10모달닫힘", readBg, async () => { await page.keyboard.press("Escape"); }, 60);

  // H3-⑪ 탭 밑줄 미끄러짐 — /reports 의 탭 줄
  await page.goto(`${BASE}/reports`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const readLine = async () => {
    const el = page.locator(".pg-tabs .tabline");
    if (await el.count() === 0) return "밑줄 없음";
    const b = await el.boundingBox();
    return b ? `밑줄 x=${Math.round(b.x)} w=${Math.round(b.width)}` : "밑줄 안 보임";
  };
  const tabs = await page.locator(".pg-tab").allTextContents();
  await frames("H3-11탭밑줄", readLine, async () => {
    await page.locator(".pg-tab").nth(1).click();
  }, 90);
  say("H3-11탭목록", `탭 "${tabs.map((t) => t.trim()).join(" · ")}"`);

  // H3-③④⑦ 완료 처리 — 체크 그리기 · 행 흐려짐 · 상태칸 하이라이트
  await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator(".iti-q").first().fill(`${MARK} 완료 모션 대상`);
  await page.locator(".iti-q").first().press("Enter");
  await page.waitForTimeout(1500);
  await page.locator(".tsearch").fill(MARK);
  await page.waitForTimeout(800);
  const row = page.locator("table tbody tr").first();
  const readRow = async () => {
    const op = await row.evaluate((el) => getComputedStyle(el).opacity).catch(() => "?");
    const chk = await page.locator("table tbody tr .chk-draw").first()
      .evaluate((el) => `${el.classList.contains("on") ? "그려짐" : "빈 상태"} dashoffset ${getComputedStyle(el.querySelector("path")).strokeDashoffset}`)
      .catch(() => "없음");
    const hl = await page.locator("table tbody tr td.col-st").first()
      .evaluate((el) => el.classList.contains("hl") ? "하이라이트" : "평소").catch(() => "?");
    return `행 opacity ${op} · 체크 ${chk} · 상태칸 ${hl}`;
  };
  await row.hover();
  await page.waitForTimeout(200);
  await frames("H3-03,04,07완료", readRow, async () => {
    await page.locator("table tbody tr .tt-act.c").first().click();
  }, 120);

  // H3-①② 진척 바 scaleX + 숫자 카운트업 — 상세 패널 슬라이더로 **사람이 값을 바꾼다**
  await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator(".iti-q").first().fill(`${MARK} 진척 모션 대상`);
  await page.locator(".iti-q").first().press("Enter");
  await page.waitForTimeout(1600);
  const made = await sql(`SELECT id FROM task WHERE title=$1 AND is_active`, [`${MARK} 진척 모션 대상`]);
  await page.goto(`${BASE}/tasks?panel=task:${made[0].id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const readProg = async () => {
    const t = await page.locator(".tdp .prop-prog i > b").first()
      .evaluate((el) => getComputedStyle(el).transform).catch(() => "없음");
    const n = await page.locator(".tdp .prop-prog").first().innerText().catch(() => "?");
    return `패널 바 ${t} · 숫자 "${n.replace(/\n+/g, " ")}"`;
  };
  await frames("H3-01,02진척", readProg, async () => {
    // 값을 눌러 편집기를 연 뒤, 슬라이더를 사람이 움직인 것과 같은 이벤트를 보낸다
    await page.locator('.tdp .prop-row:has(.prop-l:text-is("진행률")) .prop-v').click();
    await page.waitForTimeout(300);
    await page.locator('.tdp input[type=range]').first().evaluate((el) => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      set.call(el, "70");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    });
  }, 140);

  // H3-⑫ 카드 hover — --e1 → --e2
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const readCard = async () =>
    `box-shadow ${await page.locator(".pcard").first().evaluate((el) => getComputedStyle(el).boxShadow)}`;
  await frames("H3-12카드hover", readCard, async () => { await page.locator(".pcard").first().hover(); }, 60);

  // H3-⑭ 스켈레톤 shimmer — 응답을 붙잡아 로딩 상태를 만든다
  const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx2.addCookies([cookie]);
  const p2 = await ctx2.newPage();
  await p2.route("**/api/tasks?**", async () => { /* 응답을 주지 않는다 */ });
  await p2.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  await p2.waitForSelector(".sk", { timeout: 8000 }).catch(() => {});
  await p2.waitForTimeout(400);
  const skAnim = await p2.locator(".sk-row").first()
    .evaluate((el) => { const c = getComputedStyle(el); return `${c.animationName} ${c.animationDuration} ${c.animationIterationCount}`; })
    .catch(() => "없음");
  await p2.screenshot({ path: `${OUT}/H3-14스켈레톤-1시작.png` });
  await p2.waitForTimeout(300); await p2.screenshot({ path: `${OUT}/H3-14스켈레톤-2중간.png` });
  await p2.waitForTimeout(300); await p2.screenshot({ path: `${OUT}/H3-14스켈레톤-3끝.png` });
  say("H3-14스켈레톤", `animation ${skAnim} (sk-shimmer 1.2s infinite 이어야 한다)`);
  await ctx2.close();

  // ══════════════════════════════════════════════════════════════════
  // 32-f — reduce 를 켠 채 21경로. transform 애니메이션이 남으면 안 된다.
  // ══════════════════════════════════════════════════════════════════
  console.log("\n── 32-f prefers-reduced-motion: reduce 21경로 ──");
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
  await rctx.addCookies([cookie]);
  const rp = await rctx.newPage();
  const rerrs = []; rp.on("pageerror", (e) => rerrs.push(e.message));

  let bad = 0;
  for (const path of PATHS) {
    const res = await rp.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
    await rp.waitForTimeout(500);
    // 화면의 모든 요소를 훑어 transform 을 움직이는 애니메이션·트랜지션을 찾는다.
    const found = await rp.evaluate(() => {
      const out = [];
      for (const el of Array.from(document.querySelectorAll("*"))) {
        const c = getComputedStyle(el);
        const names = c.animationName;
        if (names && names !== "none") {
          // 이름이 남아 있어도 실제로 transform 을 움직이는지 확인한다
          for (const sheet of Array.from(document.styleSheets)) {
            let rules; try { rules = Array.from(sheet.cssRules); } catch { continue; }
            for (const r of rules) {
              if (r.type !== CSSRule.KEYFRAMES_RULE) continue;
              if (!names.split(",").map((s) => s.trim()).includes(r.name)) continue;
              for (const k of Array.from(r.cssRules)) {
                if (/transform\s*:/.test(k.cssText) && !/transform\s*:\s*none/.test(k.cssText)) {
                  out.push(`${el.className || el.tagName} · @keyframes ${r.name}`);
                }
              }
            }
          }
        }
        if (/(^|,\s*)transform(\s|$)/.test(c.transitionProperty) && parseFloat(c.transitionDuration) > 0) {
          out.push(`${el.className || el.tagName} · transition transform ${c.transitionDuration}`);
        }
      }
      return Array.from(new Set(out));
    });
    if (found.length) bad += 1;
    console.log(`  ${String(res?.status() ?? "?").padEnd(4)} ${path.padEnd(22)} transform 애니메이션 ${found.length}건${found.length ? " — " + found.slice(0, 2).join(" / ") : ""}`);
    await rp.screenshot({ path: `${OUT}/reduce-${path.replace(/[/?=:]/g, "_") || "home"}.png` });
  }
  console.log(`\nreduce 21경로 · transform 애니메이션이 남은 경로 ${bad}개 (0이어야 한다) · JS 오류 ${rerrs.length}건`);
  console.log(`모션 프레임 JS 오류 ${errs.length}건`);
  fs.writeFileSync(`${OUT}/frames.json`, JSON.stringify({ rows, reduceBad: bad }, null, 2));
  await rctx.close();
} finally {
  const t = await sql(`SELECT id FROM task WHERE title LIKE $1`, [`${MARK}%`]);
  if (t.length) {
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [t.map((x) => x.id)]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [t.map((x) => x.id)]);
    await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [t.map((x) => x.id)]);
  }
  console.log(`정리 — 업무 ${t.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
