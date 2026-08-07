// 시각 마감 전수 스윕 (MD-P-2026-026 §B).
//
// B-1(버튼) · B-3(배경) · ③ 그리드 span · 지시 8 보강 3항목을 **한 번에** 뽑는다.
// 화면마다 따로 재면 같은 화면을 여러 번 열게 되고, 재는 기준이 갈린다.
//
// 규칙: 여기서 나온 수치는 "실측"이고, 캡처는 **열어서 봐야** 확인이다 (지시 8).
//
//   BASE=http://127.0.0.1:3000 OUT=docs/shots/MD-P-2026-026/sweep node scripts/sweep-visual.mjs
//   ROLE=member 로 실행하면 팀원 계정으로 본다 (§C-4).
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-026/sweep";
const HOST = new URL(BASE).hostname;
const SECRET = process.env.AUTH_SECRET;
if (!SECRET) { console.error("AUTH_SECRET 필요"); process.exit(1); }

const USERS = {
  lead: { id: 1, actorId: 1, name: "권정혁", role: "lead", email: "lead@local" },
  member: { id: 3, actorId: 3, name: "박주희", role: "member", email: "member@local" },
};
const who = USERS[process.env.ROLE ?? "lead"];

function token(user) {
  const p = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", SECRET).update(p).digest("base64url")}`;
}

/** 21경로 — 회귀 점검과 같은 목록을 쓴다. 목록이 갈리면 "전 화면"이 뜻을 잃는다. */
const ROUTES = [
  "/", "/tasks", "/goals", "/projects", "/projects/1", "/calendar", "/signals",
  "/signals?tab=decision", "/inbox", "/activity", "/huddle", "/assistant",
  "/reports", "/handover", "/members", "/settings", "/saved", "/notes",
  "/profile", "/status", "/areas/1",
];

/** §G 규격 */
const FONTS_OK = [25, 19, 14, 12.5, 11.5, 10.5];
const RADII_OK = [0, 4, 7, 9, 999];
/** 배경으로 허용되는 토큰 값 (라이트 단독). 이 밖의 불투명 색면은 하드코드 후보다. */
const BG_OK = {
  "rgb(247, 248, 249)": "--bg",
  "rgb(255, 255, 255)": "--surface",
  "rgb(251, 252, 252)": "--surface-2",
  "rgb(22, 25, 31)": "--charcoal (히어로 전용)",
  "rgb(22, 25, 29)": "--ink (배지 전용)",
};
/** 의도된 색면 — 배경 토큰이 아니지만 규격상 허용된 것들. 여기 없는 값이 곧 하드코드 후보다. */
const BG_ALLOWED_IMAGE = [
  "linear-gradient(168deg, rgb(22, 25, 31), rgb(13, 16, 20))",   // 사이드바 (다크)
  "linear-gradient(150deg, rgb(26, 31, 39), rgb(14, 17, 22))",   // 홈 히어로 (§D2-1)
  "linear-gradient(100deg, rgba(22, 25, 29, 0.02), rgba(0, 0, 0, 0)), non", // --glass 오버레이 (중성 2%)
];
const BG_ALLOWED_TINT = {
  "color(srgb 0.980706 0.944471 0.887529)": "--amber 12% 안내 배너 (.inbox-demo)",
  "color(srgb 0.987137 0.96298 0.92502)": "--amber 8% 안내 배너 (.ncon-guide)",
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "tb_session", value: token(who), domain: HOST, path: "/" }]);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(e.message));

const all = [];
for (const route of ROUTES) {
  const before = jsErrors.length;
  const res = await page.goto(BASE + route, { waitUntil: "domcontentloaded" }).catch(() => null);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(600);

  const m = await page.evaluate(({ FONTS_OK, RADII_OK, BG_OK, ALLOW_IMG, ALLOW_TINT }) => {
    const px = (v) => Math.round(parseFloat(v) * 100) / 100;
    const near = (v, list) => list.some((x) => Math.abs(v - x) < 0.26);
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
    };
    const label = (el) => {
      const c = String(el.className?.baseVal ?? el.className ?? "").trim().split(/\s+/).slice(0, 2).join(".");
      return `${el.tagName.toLowerCase()}${c ? "." + c : ""}`;
    };
    const root = document.querySelector(".pg-body") || document.querySelector(".hv") || document.querySelector("main") || document.body;

    // ── 지시 8 보강 3항목 ──
    const scrollHeight = document.body.scrollHeight;
    const SKIP = /^(app|bgfx|grain|pg|pg-body|pg-head|wrap|hv|main|side|sidebar)( |$)/;
    const big = [];
    for (const el of root.querySelectorAll("*")) {
      const cls = String(el.className?.baseVal ?? el.className ?? "");
      if (SKIP.test(cls)) continue;
      const r = el.getBoundingClientRect();
      big.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
    }
    big.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h));
    const biggest = big.slice(0, 3);

    // ── B-1 버튼 ──
    const btns = [];
    for (const el of document.querySelectorAll("button, a.btn, a.btn-primary, a.btn-ghost, a.gbtn, .lk")) {
      if (!vis(el)) continue;
      if (el.closest(".side")) continue;           // 사이드바는 내비게이션이라 버튼 규격 밖
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      // 떠 있는 것(FAB·토스트)은 어느 줄에도 속하지 않는다 — 줄 판정에서 빼야 한다
      if (cs.position === "fixed" || el.closest("[style*='position: fixed']")) continue;
      btns.push({
        el: label(el), text: (el.innerText || "").trim().slice(0, 14),
        h: Math.round(r.height), y: Math.round(r.top), cy: Math.round(r.top + r.height / 2),
        x: Math.round(r.left), w: Math.round(r.width),
        radius: px(cs.borderTopLeftRadius),
        bg: cs.backgroundColor, color: cs.color,
        border: cs.borderTopWidth === "0px" ? "none" : `${px(cs.borderTopWidth)}px ${cs.borderTopColor}`,
        // 브라우저 기본 버튼 스타일 그대로인가 — 클래스는 붙었는데 CSS 가 `.hv` 안에만 있는 경우다
        ua: cs.borderTopStyle === "outset" || cs.backgroundColor === "rgb(239, 239, 239)"
            || cs.backgroundColor === "rgba(239, 239, 239, 0.3)" || cs.fontFamily.includes("system-ui") === false && false,
        fs: px(cs.fontSize),
        parent: label(el.parentElement),
        // 같은 컨트롤 묶음인지 판정하기 위한 조상 3대. 화면에서 나란히 보여도
        // 헤더 액션 vs 부제목처럼 **다른 묶음**이면 한 줄이 아니다.
        anc: [el.parentElement, el.parentElement?.parentElement, el.parentElement?.parentElement?.parentElement]
              .filter(Boolean).map((a) => { if (!a.__swid) a.__swid = ++window.__swseq || (window.__swseq = 1); return a.__swid; }),
      });
    }
    // 한 "줄"은 부모가 아니라 **화면에서 나란히 보이는 것**이다.
    // 부모로만 묶으면 헤더 액션과 필터처럼 부모가 다른데 같은 줄인 경우를 놓친다.
    // 세로로 겹치는 버튼끼리 묶고(겹침 판정), 그 안에서 중심선 어긋남을 본다.
    // "같은 줄"의 정의 — 세로로 절반 이상 겹치고 **가로로는 겹치지 않는** 두 버튼.
    // 겹침을 전이적으로 이어 붙이면 세로로 쌓인 목록까지 한 줄로 묶여 거짓 양성이 쏟아진다.
    const misaligned = [];
    {
      const sorted = btns.slice().sort((a, c) => a.y - c.y || a.x - c.x);
      const sameRow = (a, b) => {
        const ov = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ov < Math.min(a.h, b.h) * 0.5) return false;
        if (!(a.x + a.w <= b.x + 1 || b.x + b.w <= a.x + 1)) return false;   // 가로로 나란히
        return a.anc.some((id) => b.anc.includes(id));                        // 3대 안에 공통 조상
      };
      const used = new Set();
      for (let i = 0; i < sorted.length; i++) {
        if (used.has(i)) continue;
        const g = [sorted[i]];
        for (let j = i + 1; j < sorted.length; j++) {
          if (used.has(j)) continue;
          if (g.every((o) => sameRow(o, sorted[j]))) { g.push(sorted[j]); used.add(j); }
        }
        if (g.length < 2) continue;
        used.add(i);
        const cys = g.map((b) => b.cy);
        const spread = Math.max(...cys) - Math.min(...cys);
        if (spread > 1) {
          misaligned.push({ spread, y: g[0].y,
            items: g.sort((a, c) => a.x - c.x).map((b) => `${b.text || b.el}(cy${b.cy} h${b.h} r${b.radius})`) });
        }
      }
    }
    // 코랄 채움 개수
    const coralFill = btns.filter((b) => /rgb\(2[0-9]{2},\s*(4[0-9]|5[0-9]|7[0-9])/.test(b.bg) || b.bg === "rgb(234, 74, 79)" || b.bg === "rgb(196, 43, 48)");
    // 회색 구형 박스 후보 — 테두리 + 회색 배경 + 라운드 4 미만
    const boxy = btns.filter((b) => b.border !== "none" && b.bg !== "rgba(0, 0, 0, 0)" && b.radius < 4);
    // 브라우저 기본 스타일이 남아 있는 버튼 — 스타일시트가 이 버튼에 닿지 않았다는 뜻
    const uaDefault = btns.filter((b) => b.ua).map((b) => `${b.text || b.el} [${b.el}] bg${b.bg} r${b.radius}`);
    // 규격 밖 라운드·글자
    const badRadius = btns.filter((b) => !near(b.radius, RADII_OK));
    const badFont = btns.filter((b) => !near(b.fs, FONTS_OK));

    // 입력 컨트롤에도 같은 검사 — 브라우저 기본(inset 테두리)이 남아 있으면 CSS 가 안 닿은 것이다
    const uaInput = [];
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!vis(el)) continue;
      if (el.type === "checkbox" || el.type === "radio") continue;
      const cs = getComputedStyle(el);
      if (cs.borderTopStyle === "inset" || cs.borderTopStyle === "outset") {
        uaInput.push(`${label(el)} ${el.getAttribute("placeholder") ?? el.type ?? ""}`.trim());
      }
    }

    // ── B-3 배경 ── 큰 색면만 본다 (40000px² 이상)
    const bgs = new Map();
    for (const el of document.querySelectorAll("*")) {
      if (!vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < 40000) continue;
      const cs2 = getComputedStyle(el);
      const bg = cs2.backgroundColor;
      // background-image 도 본다. 처음 실측에서 body 의 아이보리 그라데이션을 놓쳤다 —
      // background-color 는 --bg 였고 색면은 image 쪽에 있었다.
      const bi = cs2.backgroundImage;
      if (bi && bi !== "none" && !bi.startsWith("url(")) {
        const k2 = `image:${bi.slice(0, 70)}`;
        if (!bgs.has(k2)) bgs.set(k2, { bg: bi.slice(0, 70), token: ALLOW_IMG.includes(bi.slice(0, 70)) ? "의도된 그라데이션" : null, kind: "image", n: 0, sample: label(el) });
        bgs.get(k2).n++;
      }
      if (bg === "rgba(0, 0, 0, 0)" || bg === "transparent") continue;
      const known = BG_OK[bg] ?? ALLOW_TINT[bg] ?? null;
      const k = `${bg}|${known ?? "?"}`;
      if (!bgs.has(k)) bgs.set(k, { bg, token: known, n: 0, sample: label(el) });
      bgs.get(k).n++;
    }

    // ── ③ 그리드 안의 섹션 빈 상태 ──
    const gridEmpty = [];
    for (const el of document.querySelectorAll(".sec-empty")) {
      const p = el.parentElement;
      if (!p) continue;
      const pcs = getComputedStyle(p);
      if (pcs.display !== "grid") continue;
      const er = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
      const full = er.width >= pr.width - parseFloat(pcs.paddingLeft) - parseFloat(pcs.paddingRight) - 2;
      gridEmpty.push({ parent: label(p), w: Math.round(er.width), pw: Math.round(pr.width), h: Math.round(er.height), full });
    }
    // 섹션 빈 상태 높이 규격
    const tallEmpty = [...document.querySelectorAll(".sec-empty")]
      .map((el) => ({ el: label(el), h: Math.round(el.getBoundingClientRect().height), t: el.innerText.slice(0, 24) }))
      .filter((x) => x.h > 56.5);

    return {
      scrollHeight, biggest,
      btnCount: btns.length, misaligned, coralFill: coralFill.map((b) => b.text || b.el),
      boxy: boxy.map((b) => `${b.text || b.el} r${b.radius} ${b.bg}`),
      badRadius: badRadius.map((b) => `${b.text || b.el} r${b.radius}`),
      badFont: badFont.map((b) => `${b.text || b.el} ${b.fs}px`),
      uaDefault, uaInput,
      bgs: [...bgs.values()], gridEmpty, tallEmpty,
    };
  }, { FONTS_OK, RADII_OK, BG_OK, ALLOW_IMG: BG_ALLOWED_IMAGE, ALLOW_TINT: BG_ALLOWED_TINT });

  const name = route.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "home";
  const shot = `${OUT}/${name}.png`;
  await page.screenshot({ path: shot });

  const row = { route, status: res?.status() ?? 0, shot, ...m, js: jsErrors.slice(before) };
  all.push(row);

  const flags = [];
  if (row.misaligned.length) flags.push(`정렬 ${row.misaligned.length}`);
  if (row.coralFill.length > 1) flags.push(`코랄 ${row.coralFill.length}`);
  if (row.boxy.length) flags.push(`각진박스 ${row.boxy.length}`);
  if (row.uaDefault.length) flags.push(`기본스타일 ${row.uaDefault.length}`);
  if (row.uaInput.length) flags.push(`기본입력 ${row.uaInput.length}`);
  if (row.badRadius.length) flags.push(`라운드 ${row.badRadius.length}`);
  if (row.badFont.length) flags.push(`글자 ${row.badFont.length}`);
  const unknownBg = row.bgs.filter((b) => !b.token);
  if (unknownBg.length) flags.push(`배경? ${unknownBg.length}`);
  if (row.gridEmpty.some((g) => !g.full)) flags.push("그리드span");
  if (row.tallEmpty.length) flags.push(`섹션높이 ${row.tallEmpty.length}`);
  if (row.js.length) flags.push(`JS ${row.js.length}`);
  console.log(`${String(row.status).padEnd(4)} ${route.padEnd(22)} btn ${String(row.btnCount).padStart(3)} · h ${String(row.scrollHeight).padStart(5)} · ${flags.join(" · ") || "clean"}`);
}

await browser.close();
fs.writeFileSync(`${OUT}/sweep.json`, JSON.stringify(all, null, 2));
console.log(`\n${all.length}경로 · ${OUT}/sweep.json`);
