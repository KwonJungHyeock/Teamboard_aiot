// v3 좁은 화면 **점검** (MD-P-2026-057 §C).
//
// **재기만 한다. 아무것도 안 고친다.** 무엇을 어떻게 고칠지는 지시자가 정한다.
//
// **로컬 전용** (지시 32). 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 재는가 ────────────────────────────────────────────────
//
// 폭 390px(폰) · 768px(태블릿) 에서 v3 일곱 화면을 열고 화면마다
//
//   · 가로 스크롤이 생기는가 — `scrollWidth > clientWidth`
//     그리고 **무엇이 밖으로 나갔는지** 범인까지 적는다. 「생긴다」만 적으면
//     고칠 자리를 못 찾는다
//   · 글자가 잘리거나 겹치는가 — 잘림은 `scrollWidth > clientWidth`,
//     겹침은 형제끼리 사각형이 포개지는지로
//   · 누를 수 없게 된 버튼이 있는가 — 화면 밖 · 크기 0 · 다른 것에 덮임
//   · 표 · 3열 · 캘린더 7칸이 어떻게 되는가
//
// ── 캡처 ─────────────────────────────────────────────────────────
//
// §0 은 검사기가 기본적으로 캡처를 안 찍게 했지만, **여기는 지시서가 캡처를
// 요구한다**(§C). 그래서 이 도구는 `SHOT` 과 무관하게 화면당 한 장 찍는다 —
// 그림 없이 「겹칩니다」만 적으면 읽는 쪽이 확인할 길이 없다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-narrow-survey.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-057/C";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });

const KEY = "ui_v3_enabled";
const WIDTHS = [{ w: 390, h: 844, tag: "390" }, { w: 768, h: 1024, tag: "768" }];

/** 일곱 화면. 상세는 실제 업무 하나가 필요해서 아래에서 id 를 채운다. */
const SCREENS = [
  { key: "오늘", url: "/v3" },
  { key: "업무", url: "/v3/tasks" },
  { key: "상세", url: null },
  { key: "새업무", url: "/v3/new" },
  { key: "캘린더", url: "/v3/calendar" },
  { key: "팀현황", url: "/v3/team" },
  { key: "집계", url: "/v3/stats" },
];

/**
 * 브라우저 안에서 도는 자. **눈으로 안 본다.**
 *
 * 「겹친다」는 형제 두 개의 사각형이 서로 8px 넘게 포개진 경우만 센다. 부모-자식은
 * 원래 포개지고, 1~2px 은 반올림이다.
 */
const PROBE = `() => {
  const de = document.documentElement;
  const vw = de.clientWidth;
  const out = {
    scrollW: de.scrollWidth, clientW: vw,
    overflow: de.scrollWidth > vw + 1,
    culprits: [], clipped: [], overlaps: [], dead: [],
    table: null, cols: null, cal: null,
  };
  const vis = (el) => {
    const s = getComputedStyle(el);
    return s.display !== "none" && s.visibility !== "hidden" && Number(s.opacity) > 0;
  };
  const name = (el) => el.tagName.toLowerCase() +
    (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".") : "");

  const all = Array.from(document.querySelectorAll("body *")).filter(vis);

  // ── 무엇이 밖으로 나갔는가 ──
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1) {
      // 부모도 같이 나갔으면 부모만 적는다 — 자식 수십 개가 줄줄이 뜬다
      const p = el.parentElement;
      if (p && p.getBoundingClientRect().right > vw + 1) continue;
      out.culprits.push({ el: name(el), right: Math.round(r.right), over: Math.round(r.right - vw) });
    }
  }

  // ── 글자가 잘렸는가 ── (가로만. 세로 잘림은 줄바꿈이라 정상일 때가 많다)
  for (const el of all) {
    if (el.children.length > 0) continue;              // 글자를 직접 든 것만
    if (!el.textContent || !el.textContent.trim()) continue;
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
      const s = getComputedStyle(el);
      out.clipped.push({ el: name(el), text: el.textContent.trim().slice(0, 24),
                         short: Math.round(el.scrollWidth - el.clientWidth),
                         ell: s.textOverflow === "ellipsis" });
    }
  }

  // ── 겹치는가 ── 형제끼리만
  //
  // 두 가지를 **일부러 뺀다.** 처음엔 안 뺐다가 있지도 않은 겹침을 잔뜩 냈다:
  //  · SVG 안(circle·text) — 고리 그림은 트랙과 획이 **겹치라고** 겹쳐 놓은 것이다
  //  · 「display: inline」 — 줄바꿈된 인라인 요소의 사각형은 두 줄을 감싼 합집합이라
  //    옆 형제와 겹친 것처럼 나온다. 실제로는 한 줄씩 나란히 있다
  const seen = new Set();
  for (const el of all) {
    if (el.namespaceURI && el.namespaceURI.includes("svg")) continue;
    const kids = Array.from(el.children).filter(vis);
    for (let i = 0; i < kids.length; i += 1) {
      for (let j = i + 1; j < kids.length; j += 1) {
        const a = kids[i].getBoundingClientRect(), b = kids[j].getBoundingClientRect();
        if (a.width === 0 || b.width === 0) continue;
        const ca = getComputedStyle(kids[i]), cb = getComputedStyle(kids[j]);
        if (ca.position === "absolute" || cb.position === "absolute") continue;
        if (ca.position === "fixed" || cb.position === "fixed") continue;
        if (ca.display === "inline" || cb.display === "inline") continue;
        if (kids[i].getClientRects().length > 1 || kids[j].getClientRects().length > 1) continue;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 8 && oy > 8) {
          const k = name(kids[i]) + "|" + name(kids[j]);
          if (seen.has(k)) continue;
          seen.add(k);
          out.overlaps.push({ a: name(kids[i]), b: name(kids[j]), x: Math.round(ox), y: Math.round(oy) });
        }
      }
    }
  }

  // ── 누를 수 없게 된 것 ──
  //
  // 「덮임」은 「elementFromPoint」 로 본다. 그런데 그 함수는 **보이는 창** 안의
  // 좌표만 안다. 처음엔 좌표를 창 안으로 밀어 넣고 물었다가, 스크롤해야 보이는
  // 버튼마다 엉뚱한 것이 덮고 있다고 나왔다 — 세로로 화면 밖인 것은 덮인 것이
  // 아니라 **아직 안 내려간 것**이다. 그래서 창 안에 든 것만 묻는다.
  out.deadSkipped = 0;
  for (const el of document.querySelectorAll("a[href], button, input, select, [role=button]")) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) { out.dead.push({ el: name(el), why: "크기 0" }); continue; }
    if (r.right > vw + 1 || r.left < -1) { out.dead.push({ el: name(el), why: "가로로 화면 밖" }); continue; }
    const cy = r.top + r.height / 2;
    if (cy < 1 || cy > de.clientHeight - 1) { out.deadSkipped += 1; continue; }
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
    const top = document.elementFromPoint(cx, cy);
    if (top && top !== el && !el.contains(top) && !top.contains(el)) {
      out.dead.push({ el: name(el), why: "덮임 (" + name(top) + ")" });
    }
  }

  // ── 표 · 3열 · 캘린더 ──
  const tbl = document.querySelector(".v3-tbl");
  if (tbl) {
    const w = tbl.parentElement;
    out.table = { w: Math.round(tbl.getBoundingClientRect().width),
                  boxW: w ? Math.round(w.clientWidth) : null,
                  scrolls: w ? w.scrollWidth > w.clientWidth + 1 : false,
                  boxOverflowX: w ? getComputedStyle(w).overflowX : null };
  }
  const grid = document.querySelector(".v3-team") || document.querySelector(".v3-rings");
  if (grid) {
    const kids = Array.from(grid.children).filter(vis).map((k) => Math.round(k.getBoundingClientRect().top));
    out.cols = { n: kids.length, rows: new Set(kids).size,
                 tmpl: getComputedStyle(grid).gridTemplateColumns,
                 scrolls: grid.scrollWidth > grid.clientWidth + 1 };
  }
  const cal = document.querySelector(".v3-cal");
  if (cal) {
    const cells = Array.from(cal.querySelectorAll(".v3-cal-d")).filter(vis);
    const w0 = cells[0] ? cells[0].getBoundingClientRect().width : 0;
    out.cal = { cells: cells.length, cellW: Math.round(w0),
                tmpl: getComputedStyle(cal).gridTemplateColumns,
                scrolls: cal.scrollWidth > cal.clientWidth + 1 };
  }
  return out;
}`;

let browser, swBefore = null;
try {
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const one = (await sql(`SELECT id FROM task WHERE is_active ORDER BY id LIMIT 1`))[0];
  SCREENS[2].url = `/v3/tasks/${one.id}`;

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });

  const report = [];
  for (const { w, h, tag } of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
      value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                   adminGrant: me.admin_grant, email: "x@x" }) }]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });

    for (const s of SCREENS) {
      await page.goto(BASE + s.url, { waitUntil: "networkidle" });
      await page.waitForTimeout(900);
      // 문자열을 그대로 주면 **식으로 평가만** 되고 안 불린다 — 함수 객체는
      // 직렬화가 안 돼서 undefined 가 돌아온다. 괄호로 싸서 부른다.
      const r = await page.evaluate(`(${PROBE})()`);
      // 지시서가 캡처를 요구하는 자리다 (§C) — SHOT 과 무관하게 찍는다.
      await page.screenshot({ path: `${OUT}/${tag}-${s.key}.png`, fullPage: true });
      report.push({ width: w, screen: s.key, url: s.url, ...r });

      const line = [];
      line.push(r.overflow ? `가로 스크롤 O (+${r.scrollW - r.clientW}px)` : "가로 스크롤 X");
      if (r.culprits.length) line.push(`밖으로 나간 것 ${r.culprits.length}개 [${r.culprits.slice(0, 3).map((c) => `${c.el} +${c.over}px`).join(" · ")}]`);
      if (r.clipped.length) line.push(`잘린 글자 ${r.clipped.length}개 [${r.clipped.slice(0, 3).map((c) => `"${c.text}" -${c.short}px${c.ell ? " (…처리)" : ""}`).join(" · ")}]`);
      if (r.overlaps.length) line.push(`겹침 ${r.overlaps.length}쌍 [${r.overlaps.slice(0, 2).map((o) => `${o.a}×${o.b}`).join(" · ")}]`);
      if (r.dead.length) line.push(`못 누르는 것 ${r.dead.length}개 [${r.dead.slice(0, 3).map((d) => `${d.el} ${d.why}`).join(" · ")}]`);
      if (r.table) line.push(`표 ${r.table.w}px / 칸 ${r.table.boxW}px · 가로스크롤 ${r.table.scrolls ? "O" : "X"}(overflow-x: ${r.table.boxOverflowX})`);
      if (r.cols) line.push(`열 ${r.cols.n}개 → ${r.cols.rows}줄 · ${r.cols.tmpl}`);
      if (r.cal) line.push(`캘린더 ${r.cal.cells}칸 · 칸폭 ${r.cal.cellW}px · ${r.cal.tmpl}`);
      console.log(`\n[${w}px] ${s.key}  ${s.url}`);
      for (const l of line) console.log(`   ${l}`);
    }
    if (errs.length) console.log(`\n[${w}px] 콘솔 오류 ${errs.length}건 — ${errs[0]}`);
    await ctx.close();
  }

  writeFileSync(`${OUT}/survey.json`, JSON.stringify(report, null, 2));
  console.log(`\n재기만 했습니다. 아무것도 안 고쳤습니다. 캡처 ${WIDTHS.length * SCREENS.length}장 · ${OUT}/survey.json`);
} finally {
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    console.log(`뒷정리 확인 — 스위치 ${now ? JSON.stringify(now.value) : "(행 없음)"}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})`);
  } finally {
    await browser?.close();
    await pool.end();
  }
}
