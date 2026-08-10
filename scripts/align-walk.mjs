// MD-P-2026-031 §A3 — 세로 정렬 실측 검사기.
//
// **읽기 전용이다.** 고치지 않고 재기만 한다. 031 준비 조사(docs/audit/031/align.json,
// 549건)와 **같은 판정식**을 쓰되, 두 가지를 더 잰다.
//
//   ① 그 셀이 실제로 **여러 줄인가** — §A3 은 "여러 줄 텍스트 셀은 상단 정렬이 맞다"고 했다.
//      줄 수를 안 재면 전부 중앙으로 밀게 되고, 그건 지시서가 하지 말라고 한 것이다.
//   ② 컨테이너에 **아래쪽 여백이 따로 있는가** — 밑줄 자리(padding-bottom)를 컨테이너에
//      포함해서 재면 글자는 항상 위로 치우친 것으로 나온다. 그건 결함이 아니라 측정의 함정이다.
//
//   AUTH_SECRET=... node scripts/align-walk.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

// 준비 조사와 **같은 21경로**. 목록이 갈리면 "전 화면"이 뜻을 잃는다.
const ROUTES = [
  "/", "/tasks", "/goals", "/projects", "/projects/1", "/calendar", "/signals",
  "/signals?tab=decision", "/inbox", "/activity", "/huddle", "/assistant",
  "/reports", "/handover", "/members", "/settings", "/saved", "/notes",
  "/profile", "/status", "/areas/1",
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{
  name: "tb_session",
  value: tok({ id: 1, actorId: 1, name: "권정혁", role: "lead", email: "l@l" }),
  domain: new URL(BASE).hostname, path: "/",
}]);
const page = await ctx.newPage();

/**
 * **관측 도구부터 확인한다** (§G · MD-P-2026-031 §C).
 * 화면이 반응하지 않을 때 코드를 의심하기 전에 화면이 살아 있는지 본다.
 * dev 서버 청크가 404 인 상태로 잰 값은 값이 아니다 — 실제로 그렇게 한 번 헛짚었다.
 * 콘솔 오류가 하나라도 있으면 **측정 자체를 실패로 끝낸다.**
 */
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
// 페이지를 떠나며 취소된 요청은 오류가 아니다 — 그것까지 세면 검사가 늘 실패한다.
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "";
  if (/ABORTED/i.test(why)) return;
  consoleErrors.push(`요청 실패 ${r.url().slice(-50)} (${why})`);
});

// 100% 배율 캡처 — §H A1 이 요구하는 근거다. 125%에서 잘 보이는 것은 근거가 아니다.
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-031/A";
const SHOT = new Set(["/", "/tasks", "/goals", "/reports", "/members", "/areas/1"]);
fs.mkdirSync(OUT, { recursive: true });

const bad = [];      // 진짜 위반
const clip = [];     // 가로로 잘리는 칸 (상자가 밖으로 나간 것)
const small = [];    // 11px 미만 글자 (§A1 하한 위반)
const sizes = {};    // 계산된 font-size 분포 (화면 UI)
const printSizes = {}; // 인쇄 미리보기(.prep) 분포 — 하한이 다르다
const printPx = [];  // 인쇄 규칙인데 px 로 적힌 것 = 예외 자격 없음
const multi = [];    // 여러 줄 → 상단 정렬이 맞다 (예외 목록)
const gutter = [];   // 아래 여백이 따로 있는 자리 (예외 목록)
let seen = 0;

try {
  for (const route of ROUTES) {
    const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" }).catch(() => null);
    if (!res) { console.log(`SKIP ${route}`); continue; }
    await page.waitForTimeout(500);

    const found = await page.evaluate(() => {
      const sel = (el) => {
        const cls = (el.className || "").toString().trim().split(/\s+/).filter(Boolean).slice(0, 3);
        return el.tagName.toLowerCase() + (cls.length ? "." + cls.join(".") : "");
      };
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      /** 글자가 실제로 차지한 줄 상자. Range 로 재야 padding 을 안 섞는다.
       *
       * **줄 수는 top 값의 가짓수로 세면 안 된다.** 한 줄 안에 칩·아이콘처럼
       * 기준선이 1~2px 다른 인라인 요소가 있으면 top 이 달라져 두 줄로 잡힌다.
       * (실제로 그렇게 세었다가 `.prep-t` 52행 전부를 "여러 줄"로 오판했다.)
       * 세로로 **겹치면 같은 줄**이다. 겹침으로 판정한다. */
      const textBox = (el) => {
        const r = document.createRange();
        r.selectNodeContents(el);
        const rects = Array.from(r.getClientRects())
          .filter((x) => x.width > 0 && x.height > 0)
          .sort((a, b) => a.top - b.top);
        if (!rects.length) return null;
        const top = Math.min(...rects.map((x) => x.top));
        const bottom = Math.max(...rects.map((x) => x.bottom));
        let lines = 1, cur = rects[0].bottom;
        for (const rc of rects.slice(1)) {
          if (rc.top >= cur - 2) { lines++; cur = rc.bottom; }   // 겹치지 않음 = 다음 줄
          else cur = Math.max(cur, rc.bottom);                    // 겹침 = 같은 줄
        }
        return { top, bottom, lines };
      };

      const out = { bad: [], multi: [], gutter: [], clip: [], small: [], sizes: {}, printSizes: {}, printPx: [], seen: 0 };

      // ── §A1 하한 ────────────────────────────────────────────────
      // 화면 UI 는 11px, **인쇄 미리보기(.prep)는 7.5pt(=10px)** 가 하한이다.
      // pt 는 물리 크기이고 px 는 화면 크기다. 같은 하한을 걸면 종이를 망가뜨린다.
      // 예외를 "검사 안 함"으로 두지 않는다 — 매체별 하한을 **둘 다 잰다.**
      // 소스를 grep 하는 것으로는 못 증명한다. 상속·계산값까지 봐야 하므로
      // **글자를 가진 요소의 계산된 font-size** 를 전부 훑는다.
      const PT = 4 / 3;                       // 1pt = 1.333px
      const FLOOR_UI = 11;                    // px
      const FLOOR_PRINT = 7.5 * PT;           // 10px
      for (const el of document.querySelectorAll("body *")) {
        if (!vis(el)) continue;
        const hasOwnText = Array.from(el.childNodes)
          .some((n) => n.nodeType === 3 && n.textContent.trim());
        if (!hasOwnText) continue;
        const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
        const inPrint = !!el.closest(".prep");
        (inPrint ? out.printSizes : out.sizes)[fs] = ((inPrint ? out.printSizes : out.sizes)[fs] ?? 0) + 1;
        const floor = inPrint ? FLOOR_PRINT : FLOOR_UI;
        if (fs < floor - 0.05) {
          out.small.push({ sel: sel(el), px: fs, floor, media: inPrint ? "인쇄" : "화면",
            txt: el.textContent.trim().slice(0, 20) });
        }
      }

      // 인쇄 예외는 **단위로만** 성립한다.
      // `.prep` 안이라도 크기를 px(또는 px 토큰)로 적었으면 화면 하한 11px 을 그대로 받는다.
      // 그래서 11px 미만인 요소마다 **자기에게 걸린 규칙이 pt 로 적혔는지** 되짚는다.
      // 선택자 이름만 보고 봐주면, 다음 사람이 .prep 안에 px 를 넣고 예외라고 부른다.
      const ptDeclared = (el) => {
        let ok = false;
        for (const ss of document.styleSheets) {
          let rules; try { rules = ss.cssRules; } catch { continue; }
          for (const r of rules || []) {
            if (!r.selectorText) continue;
            let m = false; try { m = el.matches(r.selectorText); } catch { continue; }
            if (!m) continue;
            const fsv = r.style?.getPropertyValue("font-size");
            if (!fsv) continue;
            ok = /pt$/.test(fsv.trim());   // 나중에 이긴 선언이 답이다
          }
        }
        return ok;
      };
      for (const el of document.querySelectorAll(".prep *")) {
        if (!vis(el)) continue;
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs >= FLOOR_UI) continue;              // 화면 하한을 넘으면 예외를 따질 일이 없다
        if (ptDeclared(el)) continue;              // pt 로 적혔다 = 인쇄 규격 = 예외 성립
        out.printPx.push({ sel: sel(el), px: Math.round(fs * 10) / 10 });
      }

      // ── 가로로 잘리는 칸 ────────────────────────────────────────
      // 글자가 말줄임표로 줄어드는 것은 의도다. **상자가 잘리는 것은 결함이다.**
      // 그래서 "자식 요소의 오른쪽 끝이 칸 밖으로 나갔는가"로만 판정한다.
      // (글자만 넘칠 때는 자식 요소가 없으므로 걸리지 않는다.)
      for (const el of document.querySelectorAll("td, th, .dl-row, .row")) {
        if (!vis(el)) continue;
        const cs = getComputedStyle(el);
        if (cs.overflowX === "visible" || cs.overflowX === "auto" || cs.overflowX === "scroll") continue;
        const box = el.getBoundingClientRect();
        const padR = parseFloat(cs.paddingRight) || 0;
        const padL = parseFloat(cs.paddingLeft) || 0;
        for (const kid of el.children) {
          const k = kid.getBoundingClientRect();
          if (k.width === 0) continue;
          const outR = k.right - (box.right - padR);
          const outL = (box.left + padL) - k.left;
          if (Math.max(outR, outL) > 1) {
            out.clip.push({ sel: sel(el), kid: sel(kid), over: Math.round(Math.max(outR, outL)) });
            break;
          }
        }
      }
      const targets = document.querySelectorAll("td, th, button, .dl-row, .row, .nitem, .stx-row");
      for (const el of targets) {
        if (!vis(el)) continue;
        if (!el.textContent?.trim()) continue;
        out.seen++;
        const cs = getComputedStyle(el);
        const box = el.getBoundingClientRect();
        const tb = textBox(el);
        if (!tb) continue;

        // 여러 줄이면 상단 정렬이 맞다 — 위반이 아니라 예외다 (§A3).
        if (tb.lines > 1) { out.multi.push({ sel: sel(el), lines: tb.lines }); continue; }

        // 아래(또는 위) 여백이 한쪽에만 3px 넘게 있으면, 그 여백은 글자 자리가 아니다.
        // 밑줄·구분선 자리를 컨테이너에 포함해 재면 글자는 늘 위로 치우쳐 보인다.
        const pt = parseFloat(cs.paddingTop) || 0;
        const pb = parseFloat(cs.paddingBottom) || 0;
        if (Math.abs(pb - pt) > 3) {
          out.gutter.push({ sel: sel(el), paddingTop: pt, paddingBottom: pb });
          continue;
        }

        // 여기까지 온 것만 진짜 판정 대상. 글자 중심이 상자 중심에서 1.5px 넘게 벗어나면 위반.
        const offset = (tb.top + tb.bottom) / 2 - (box.top + box.bottom) / 2;
        const va = cs.verticalAlign;
        const tdLike = el.tagName === "TD" || el.tagName === "TH";
        if (Math.abs(offset) > 1.5 || (tdLike && va !== "middle")) {
          out.bad.push({
            sel: sel(el), offset: Math.round(offset * 10) / 10,
            h: Math.round(box.height), verticalAlign: va,
          });
        }
      }
      return out;
    });

    if (SHOT.has(route)) {
      await page.screenshot({ path: `${OUT}/${route.replace(/[^a-z0-9]+/gi, "_") || "home"}.png` });
    }
    seen += found.seen;
    for (const b of found.bad) bad.push({ route, ...b });
    for (const m of found.multi) multi.push({ route, ...m });
    for (const g of found.gutter) gutter.push({ route, ...g });
    for (const c of found.clip) clip.push({ route, ...c });
    for (const m of found.small) small.push({ route, ...m });
    for (const [k, v] of Object.entries(found.sizes)) sizes[k] = (sizes[k] ?? 0) + v;
    for (const [k, v] of Object.entries(found.printSizes)) printSizes[k] = (printSizes[k] ?? 0) + v;
    for (const x of found.printPx) if (!printPx.some((y) => y.sel === x.sel)) printPx.push(x);
    console.log(`${route.padEnd(24)} 대상 ${String(found.seen).padStart(4)} · 위반 ${String(found.bad.length).padStart(3)} · 여러 줄 ${String(found.multi.length).padStart(3)} · 여백 ${found.gutter.length} · 잘림 ${found.clip.length} · 하한미만 ${found.small.length}`);
  }

  // ── 존재 단언 — 검사가 실제로 무언가를 보고 있는가 (지시 28) ──
  if (seen < 200) { console.error(`\n검사 대상이 ${seen}개뿐이다 — 화면을 못 읽은 것이다.`); process.exit(1); }

  const group = (rows, key) => {
    const by = {};
    for (const r of rows) { const k = key(r); (by[k] ??= []).push(r); }
    return Object.entries(by).sort((a, b) => b[1].length - a[1].length);
  };

  if (consoleErrors.length) {
    console.error(`\n콘솔 오류 ${consoleErrors.length}건 — 화면이 성한 상태가 아니다. 이 값은 값이 아니다.`);
    for (const e of consoleErrors.slice(0, 5)) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`\n════ 합계 ════`);
  console.log(`검사 대상 ${seen}개 · 세로정렬 위반 ${bad.length}건 · 가로 잘림 ${clip.length}건 · 하한 미만 ${small.length}건 · 여러 줄 예외 ${multi.length}건 · 아래여백 예외 ${gutter.length}건`);

  console.log(`\n── 화면 UI · 계산된 font-size 분포 (하한 11px) ──`);
  const szs = Object.entries(sizes).map(([k, v]) => [parseFloat(k), v]).sort((a, b) => a[0] - b[0]);
  if (!szs.length) { console.error("글자를 가진 요소가 0개다 — 화면을 못 읽은 것이다."); process.exit(1); }
  for (const [px, n] of szs) console.log(`  ${String(px).padStart(6)}px  ${String(n).padStart(5)}개${px < 11 ? "   ← 하한 위반" : ""}`);

  console.log(`\n── 인쇄 미리보기(.prep) 분포 (하한 7.5pt = 10px) ──`);
  const pzs = Object.entries(printSizes).map(([k, v]) => [parseFloat(k), v]).sort((a, b) => a[0] - b[0]);
  if (!pzs.length) console.log("  (없음) — 인쇄 미리보기를 한 번도 못 읽었다면 예외가 검사되지 않은 것이다");
  for (const [px, n] of pzs) {
    const pt = Math.round((px * 0.75) * 100) / 100;
    console.log(`  ${String(px).padStart(6)}px = ${String(pt).padStart(5)}pt  ${String(n).padStart(4)}개${px < 10 ? "   ← 하한 위반" : ""}`);
  }
  if (printPx.length) {
    console.log(`\n── .prep 안인데 pt 로 안 적힌 11px 미만 (예외 자격 없음) ──`);
    for (const r of printPx) console.log(`  ${r.sel} : ${r.px}px`);
  }
  if (small.length) {
    console.log(`\n── 하한 미만 ──`);
    for (const [k, rows] of group(small, (r) => `${r.route} | ${r.media} | ${r.sel} | ${r.px}px (하한 ${r.floor}px) | "${r.txt}"`)) {
      console.log(`  ${String(rows.length).padStart(3)}  ${k}`);
    }
  }

  if (bad.length) {
    console.log(`\n── 위반 ──`);
    for (const [k, rows] of group(bad, (r) => `${r.route} | ${r.sel} | 오프셋 ${r.offset}px | va:${r.verticalAlign}`)) {
      console.log(`  ${String(rows.length).padStart(3)}  ${k}`);
    }
  }
  console.log(`\n── 예외 ① 여러 줄 텍스트 (상단 정렬이 맞다) ──`);
  for (const [k, rows] of group(multi, (r) => `${r.route} | ${r.sel} | ${r.lines}줄`).slice(0, 20)) {
    console.log(`  ${String(rows.length).padStart(3)}  ${k}`);
  }
  console.log(`\n── 예외 ② 한쪽 여백이 따로 있는 자리 (밑줄·구분선 자리) ──`);
  for (const [k, rows] of group(gutter, (r) => `${r.route} | ${r.sel} | pt ${r.paddingTop} / pb ${r.paddingBottom}`).slice(0, 20)) {
    console.log(`  ${String(rows.length).padStart(3)}  ${k}`);
  }
  if (clip.length) {
    console.log(`\n── 가로로 잘리는 칸 ──`);
    for (const [k, rows] of group(clip, (r) => `${r.route} | ${r.sel} > ${r.kid} | ${r.over}px 넘침`)) {
      console.log(`  ${String(rows.length).padStart(3)}  ${k}`);
    }
  }
  process.exit(bad.length || clip.length || small.length || printPx.length ? 1 : 0);
} finally {
  await browser.close();
}
