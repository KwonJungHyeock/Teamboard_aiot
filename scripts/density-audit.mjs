// MD-P-2026-031 §B2 — 빈 가로 공간 검사기 (density-audit).
//
// **규칙(§B1).** 전체 폭을 쓰는 행은 그 폭을 정보로 채우거나 폭을 줄인다.
// 오른쪽 25% 이상이 빈 채로 남는 전체 폭 행은 규격 위반이다.
// 억지 여백(양 끝에 둘만 두고 가운데를 비우는 것)도 위반이다.
//
// **무엇에 대해 25% 인가 — content box(안쪽) 기준이다** (회신 [확정]).
// padding 은 의도된 여백이고, §B1 이 잡으려는 것은 "채우지 못한 폭"이다.
//
// **왜 정적 검사가 아닌가.** 지시서는 "정적 검사기"라고 적었지만, 판정에 필요한 것은
// **마지막 자식의 오른쪽 끝 좌표**다. 그건 소스에 없다. 폭은 부모·형제·글자 길이가
// 같이 정하기 때문에 렌더해야 나온다. §A 에서 얻은 것과 같은 이유로 화면에서 잰다.
// (motion-audit 은 소스만 봐도 되는 검사라 정적이다. 둘은 같은 폴더에 있지만 방식이 다르다.)
//
//   AUTH_SECRET=... node scripts/density-audit.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const ALLOW_PATH = process.env.ALLOW ?? "docs/design/density-allow.json";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

// 다른 검사와 **같은 21경로**. 목록이 갈리면 "전 화면"이 뜻을 잃는다.
const ROUTES = [
  "/", "/tasks", "/goals", "/projects", "/projects/1", "/calendar", "/signals",
  "/signals?tab=decision", "/inbox", "/activity", "/huddle", "/assistant",
  "/reports", "/handover", "/members", "/settings", "/saved", "/notes",
  "/profile", "/status", "/areas/1",
];

/** 허용 목록 — 주석이 아니라 파일이다. 사유 한 줄이 없으면 등록으로 안 친다. */
const allow = fs.existsSync(ALLOW_PATH) ? JSON.parse(fs.readFileSync(ALLOW_PATH, "utf8")) : { items: [] };
const allowKey = new Map(allow.items.map((a) => [a.key, a]));
const used = new Set();

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

const viol = [];
let scanned = 0;

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
        return r.width > 2 && r.height > 2 && getComputedStyle(el).visibility !== "hidden";
      };
      /** 사람이 찾아갈 수 있는 경로 — 조상 두 단계까지 붙인다. */
      const path = (el) => {
        const parts = [];
        for (let n = el, i = 0; n && i < 3; n = n.parentElement, i++) {
          if (n === document.body) break;
          parts.unshift(sel(n));
        }
        return parts.join(" > ");
      };

      const out = { rows: [], scanned: 0 };
      const main = document.querySelector("main, .ws, .pg-body") ?? document.body;

      for (const el of main.querySelectorAll("*")) {
        if (!vis(el)) continue;
        const cs = getComputedStyle(el);
        // 가로로 자식을 늘어놓는 컨테이너만 본다. 세로 스택은 §B1 의 대상이 아니다.
        const isRow =
          (cs.display === "flex" || cs.display === "inline-flex") && !cs.flexDirection.startsWith("column")
          || el.tagName === "TR";
        if (!isRow) continue;

        // **그려진 행만 본다.** 배경도 테두리도 없는 상자는 눈에 "행"으로 안 보인다.
        // 빵부스러기(`.pg-crumb`)와 탭 줄(`.pg-tabs`)이 그렇다 — 폭을 다 쓰지만
        // 아무것도 칠하지 않아서 오른쪽이 비어 보이지 않는다. §B1 이 잡으려는 것은
        // "폭을 차지하고 칠해 놓고 안 채운 행"이다. 표의 tr 은 칸이 대신 그리므로 늘 대상이다.
        const painted =
          el.tagName === "TR"
          || !/rgba?\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor)
          || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderBottomWidth) > 0
          || parseFloat(cs.borderLeftWidth) > 0 || parseFloat(cs.borderRightWidth) > 0
          || cs.boxShadow !== "none";
        if (!painted) continue;

        const parent = el.parentElement;
        if (!parent) continue;
        const pr = parent.getBoundingClientRect();
        const pcs = getComputedStyle(parent);
        const pInner = pr.width - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0);
        const r = el.getBoundingClientRect();
        // "전체 폭을 쓰는 행" — 부모 안쪽 폭의 90% 이상을 차지하는 것.
        if (pInner <= 0 || r.width < pInner * 0.9) continue;
        if (r.width < 400) continue;                 // 좁은 사이드 카드는 대상이 아니다

        // 판정 기준면은 **content box** 다. padding 은 의도된 여백이다.
        const left = r.left + (parseFloat(cs.paddingLeft) || 0);
        const right = r.right - (parseFloat(cs.paddingRight) || 0);
        const inner = right - left;
        if (inner <= 0) continue;

        const kids = Array.from(el.children).filter(vis).map((k) => k.getBoundingClientRect());
        if (kids.length < 2) continue;
        out.scanned++;

        // ① 오른쪽 꼬리 — 마지막 자식의 오른쪽 끝부터 안쪽 오른쪽 끝까지
        const maxRight = Math.max(...kids.map((k) => k.right));
        const tail = right - maxRight;

        // ② 억지 여백 — **"양 끝에 두 개만 두는 것"** 이다(§B1 문구 그대로).
        // 자식이 셋 이상이면 가운데가 벌어져도 그건 열 정렬 문제이지 억지 여백이 아니다.
        // 이 제한을 안 두면 오른쪽에 액션 하나를 붙인 머리줄이 전부 위반으로 잡힌다.
        const sorted = kids.slice().sort((a, b) => a.left - b.left);
        let gap = 0, gapAt = 0, cur = left;
        for (const k of sorted) {
          if (k.left - cur > gap) { gap = k.left - cur; gapAt = cur; }
          cur = Math.max(cur, k.right);
        }

        const tailPct = Math.round((tail / inner) * 1000) / 10;
        const gapPct = Math.round((gap / inner) * 1000) / 10;
        const gapViolation = kids.length === 2 && gapPct > 25;
        if (tailPct > 25 || gapViolation) {
          out.rows.push({
            sel: sel(el), path: path(el), kids: kids.length,
            width: Math.round(inner), tailPx: Math.round(tail), tailPct,
            gapPx: Math.round(gap), gapPct, gapAt: Math.round(gapAt - left),
            kind: tailPct > 25 ? "오른쪽 꼬리" : "억지 여백",
          });
        }
      }
      return out;
    });

    scanned += found.scanned;
    for (const v of found.rows) viol.push({ route, ...v });
    const kept = found.rows.filter((v) => !allowKey.has(`${route} | ${v.path}`));
    console.log(`${route.padEnd(24)} 전체 폭 행 ${String(found.scanned).padStart(4)} · 위반 ${String(kept.length).padStart(3)}`);
  }

  // ── 존재 단언 — 검사가 실제로 무언가를 보고 있는가 (지시 28) ──
  if (scanned < 100) {
    console.error(`\n전체 폭 행이 ${scanned}개뿐이다 — 화면을 못 읽은 것이다.`);
    process.exit(1);
  }

  const open = [], allowed = [];
  for (const v of viol) {
    const key = `${v.route} | ${v.path}`;
    if (allowKey.has(key)) { used.add(key); allowed.push({ ...v, why: allowKey.get(key).why }); }
    else open.push(v);
  }

  const group = (rows) => {
    const by = {};
    for (const r of rows) { const k = `${r.route} | ${r.path}`; (by[k] ??= []).push(r); }
    return Object.entries(by).sort((a, b) => b[1][0][b[1][0].kind === "오른쪽 꼬리" ? "tailPct" : "gapPct"]
      - a[1][0][a[1][0].kind === "오른쪽 꼬리" ? "tailPct" : "gapPct"]);
  };

  if (consoleErrors.length) {
    console.error(`\n콘솔 오류 ${consoleErrors.length}건 — 화면이 성한 상태가 아니다. 이 값은 값이 아니다.`);
    for (const e of consoleErrors.slice(0, 5)) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`\n════ 합계 ════`);
  console.log(`전체 폭 행 ${scanned}개 · 위반 ${open.length}건 · 허용 목록 ${allowed.length}건`);

  if (open.length) {
    console.log(`\n── 위반 ──`);
    for (const [k, rows] of group(open)) {
      const r = rows[0];
      console.log(`  ${String(rows.length).padStart(3)}  ${k}`);
      console.log(`       ${r.kind} · 안쪽 폭 ${r.width}px · 꼬리 ${r.tailPx}px(${r.tailPct}%) · 가장 큰 빈 구간 ${r.gapPx}px(${r.gapPct}%) · 자식 ${r.kids}개`);
    }
  }
  if (allowed.length) {
    console.log(`\n── 허용 목록 ──`);
    for (const [k, rows] of group(allowed)) {
      const a = allowKey.get(k);
      console.log(`  ${String(rows.length).padStart(3)}  ${k}${a?.until ? `   [${a.until} 까지]` : ""}\n       ${rows[0].why}`);
    }
  }
  // 안 쓰이는 허용 항목은 지운다 — 남겨 두면 "예외였던 것"이 영원히 예외로 남는다.
  const stale = allow.items.filter((a) => !used.has(a.key));
  if (stale.length) {
    console.log(`\n── 더 이상 안 걸리는 허용 항목 (지울 것) ──`);
    for (const a of stale) console.log(`  ${a.key}`);
  }

  process.exit(open.length || stale.length ? 1 : 0);
} finally {
  await browser.close();
}
