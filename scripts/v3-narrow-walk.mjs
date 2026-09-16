// v3 좁은 화면 고치기 실측 (MD-P-2026-059 §B).
//
// **로컬 전용** (지시 32). 스위치를 시작 전으로 되돌린다.
//
// 점검 도구(`v3-narrow-survey.mjs`)는 **재기만** 한다. 이쪽은 **단언**한다.
//
// ── 배치 ① 서랍 ─────────────────────────────────────────────────
//
//   ①-1 768px 미만 — 레일이 닫혀 있고 위 바가 있다
//   ①-2 ☰ 를 누르면 레일이 **덮으며** 나온다 · 바깥을 누르면 닫힌다
//   ①-3 레일 **마크업이 하나다** — 좁은 화면용 메뉴를 따로 안 만들었다
//   ①-4 열려 있는 동안 뒤 본문이 **안 굴러간다**
//   ①-5 계정·설정이 서랍 안에서도 **바닥에 붙어 있다**
//   ①-6 「＋ 새 업무」가 여전히 **하나다** (좁을 때 · 넓을 때 각각)
//   ①-7 **768px 이상이 안 바뀌었다** — 지문으로 대조 (회귀 위험이 여기다)
//   ①-8 화면을 옮기면 서랍이 닫힌다
//   ⑨  콘솔 오류 0
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";   // 캡처는 SHOT=1 일 때만 (057 §0)

requireLocalDb("v3-narrow-walk.mjs");

const REPO = process.cwd();
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-059";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const PHONE = { width: 390, height: 844 };
const WIDE = { width: 1440, height: 900 };

/** 「보인다」는 **그려졌는가**까지 묻는다 — 부모가 감추면 제 스타일만 봐선 모른다. */
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
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const errs = [];
  const open = async (viewport) => {
    const c = await browser.newContext({ viewport });
    await c.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
      value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                   adminGrant: me.admin_grant, email: "x@x" }) }]);
    const p = await c.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text()); });
    return { c, p };
  };
  /** 「새 업무」로 가는 **보이는** 것의 수. 레일 메뉴 항목은 뺀다(그건 메뉴다). */
  const newBtns = async (p) => p.evaluate(`(() => {
    const shown = ${SHOWN};
    return Array.from(document.querySelectorAll(".v3 a, .v3 button"))
      .filter((el) => /새 업무/.test(el.textContent || ""))
      .filter((el) => !el.classList.contains("v3-navlink"))
      .filter(shown).length;
  })()`);

  /*
   * ── ①-3 마크업이 하나다 ─────────────────────────────────────
   *
   * **소스로 먼저 묻는다.** 좁은 화면용 메뉴를 따로 만들었는지는 눌러 봐서
   * 아는 것보다 코드를 세는 것이 정확하고, 항목이 늘 때 한쪽만 느는 사고는
   * 좁은 화면을 열어 보기 전엔 안 보인다.
   */
  const shell = readFileSync(path.join(REPO, "components/v3/Shell.tsx"), "utf-8");
  const railTags = (shell.match(/className=\{?`?v3-rail[^-]/g) ?? []).length
    + (shell.match(/className=\{`v3-rail\$/g) ?? []).length;
  const navMaps = (shell.match(/NAV\.map\(/g) ?? []).length;
  chk("①-3-레일-마크업이-하나다",
      (shell.match(/<nav /g) ?? []).length === 1 && navMaps === 2,
      `<nav> ${(shell.match(/<nav /g) ?? []).length}개 · NAV.map 자리 ${navMaps}개` +
      ` (NAV 와 LEAD_NAV 각각 한 번씩 — 좁은 화면용 메뉴를 따로 안 만들었다)`);

  // ══ 넓은 화면 지문을 **먼저** 뜬다 ══════════════════════════════
  //
  // ①-7 은 「안 바뀌었다」를 묻는다. 바뀐 뒤에 재면 무엇과 견주는지가 없으므로
  // 같은 실행에서 넓은 화면 값을 먼저 뜨고, 좁은 화면을 거쳐 다시 뜬다.
  const wideFingerprint = async (p) => {
    await p.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
    return p.evaluate(`(() => {
      const shown = ${SHOWN};
      const rail = document.querySelector(".v3-rail");
      const main = document.querySelector(".v3-main");
      const bar = document.querySelector(".v3-topbar");
      const r = rail.getBoundingClientRect(), m = main.getBoundingClientRect();
      return {
        railW: Math.round(r.width), railX: Math.round(r.left),
        railPos: getComputedStyle(rail).position,
        mainX: Math.round(m.left), mainW: Math.round(m.width),
        barShown: bar ? shown(bar) : false,
        scrim: document.querySelectorAll(".v3-scrim").length,
        navs: Array.from(document.querySelectorAll(".v3-navlink")).map((a) => a.textContent.trim()),
      };
    })()`);
  };

  const wide = await open(WIDE);
  const before = await wideFingerprint(wide.p);
  const wideNew = await newBtns(wide.p);

  // ══ 좁은 화면 ══════════════════════════════════════════════════
  const ph = await open(PHONE);
  await ph.p.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await ph.p.locator(".v3-topbar").waitFor({ timeout: 9000 });

  const railState = async () => ph.p.evaluate(`(() => {
    const shown = ${SHOWN};
    const rail = document.querySelector(".v3-rail");
    const r = rail.getBoundingClientRect();
    return { shown: shown(rail), x: Math.round(r.left), w: Math.round(r.width),
             vis: getComputedStyle(rail).visibility,
             scrim: document.querySelectorAll(".v3-scrim").length,
             bodyOverflow: getComputedStyle(document.body).overflowY,
             mainX: Math.round(document.querySelector(".v3-main").getBoundingClientRect().left) };
  })()`);

  const shut = await railState();
  const barT = (await ph.p.locator(".v3-topbar-t").innerText()).trim();
  chk("①-1-좁으면-레일이-닫히고-위-바가-선다",
      !shut.shown && shut.vis === "hidden" && shut.scrim === 0 && shut.mainX < 40,
      `레일 보임 ${shut.shown}(visibility: ${shut.vis}) · 덮개 ${shut.scrim}개 ·` +
      ` 본문 왼쪽 ${shut.mainX}px (232px 이 아니라 여백만) · 위 바 이름 "${barT}"`);

  const phoneNew = await newBtns(ph.p);
  chk("①-6-새-업무가-여전히-하나다", phoneNew === 1 && wideNew === 1,
      `좁은 화면 ${phoneNew}개 · 넓은 화면 ${wideNew}개 (056 §A — 한 화면에 하나)`);

  // ── ①-2 ☰ 로 열고 바깥으로 닫는다 ────────────────────────────
  await ph.p.locator(".v3-burger").click();
  await ph.p.waitForTimeout(320);
  const opened = await railState();
  const covers = opened.x === 0 && opened.w >= 200;
  chk("①-2-☰-로-열린다-·-덮는다",
      opened.shown && covers && opened.scrim === 1 && opened.mainX === shut.mainX,
      `레일 x=${opened.x} 폭 ${opened.w}px · 덮개 ${opened.scrim}개 ·` +
      ` 본문 왼쪽 ${opened.mainX}px (닫혔을 때와 같다 = 밀지 않고 **덮는다**)`);

  chk("①-4-뒤-본문이-안-굴러간다", opened.bodyOverflow === "hidden",
      `body overflow-y: ${opened.bodyOverflow} (닫혔을 때 ${shut.bodyOverflow})`);

  // ── ①-5 계정·설정이 바닥에 ───────────────────────────────────
  const acct = await ph.p.locator(".v3-acct").boundingBox();
  const railBox = await ph.p.locator(".v3-rail").boundingBox();
  chk("①-5-계정이-서랍-바닥에",
      acct !== null && railBox !== null
      && Math.abs((acct.y + acct.height) - (railBox.y + railBox.height)) < 30,
      `계정 블록 아래끝 ${acct ? Math.round(acct.y + acct.height) : "?"}px ·` +
      ` 서랍 아래끝 ${railBox ? Math.round(railBox.y + railBox.height) : "?"}px (붙어 있어야 한다)`);

  await shot(ph.p, { path: `${OUT}/1-390-서랍열림.png` });

  // 덮개는 화면 전체를 깔지만 왼쪽 264px 은 서랍이 위에 있다. 한가운데를 누르면
  // 서랍을 누르는 셈이라 안 닫힌다 — 사람도 그렇다. **서랍 바깥**을 누른다.
  await ph.p.locator(".v3-scrim").click({ position: { x: 340, y: 400 } });
  await ph.p.waitForTimeout(320);
  const closed = await railState();
  chk("①-2짝-바깥을-누르면-닫힌다",
      !closed.shown && closed.scrim === 0 && closed.bodyOverflow === shut.bodyOverflow,
      `레일 보임 ${closed.shown} · 덮개 ${closed.scrim}개 · body overflow-y ${closed.bodyOverflow}` +
      ` (열기 전 ${shut.bodyOverflow} 으로 되돌아왔다)`);

  // ── ①-8 화면을 옮기면 닫힌다 ─────────────────────────────────
  await ph.p.locator(".v3-burger").click();
  await ph.p.waitForTimeout(300);
  await ph.p.locator(".v3-rail .v3-navlink", { hasText: "캘린더" }).click();
  await ph.p.waitForURL(/\/v3\/calendar/, { timeout: 9000 });
  await ph.p.waitForTimeout(400);
  const moved = await railState();
  chk("①-8-화면을-옮기면-닫힌다",
      !moved.shown && moved.scrim === 0 && moved.bodyOverflow === shut.bodyOverflow,
      `캘린더로 간 뒤 — 레일 보임 ${moved.shown} · 덮개 ${moved.scrim}개 ·` +
      ` body overflow-y ${moved.bodyOverflow} (열린 채 덮여 있으면 아무것도 안 눌린다)`);

  await shot(ph.p, { path: `${OUT}/1-390-닫힘.png` });
  await ph.c.close();

  // ══ ①-7 넓은 화면이 안 바뀌었다 ════════════════════════════════
  const after = await wideFingerprint(wide.p);
  const same = JSON.stringify(before) === JSON.stringify(after);
  chk("①-7-768px-이상이-안-바뀐다",
      same && after.railW === 232 && after.railPos === "sticky"
      && after.mainX === 232 && !after.barShown && after.scrim === 0,
      `레일 ${after.railW}px(${after.railPos}) · 본문 왼쪽 ${after.mainX}px ·` +
      ` 위 바 보임 ${after.barShown} · 덮개 ${after.scrim}개 · 메뉴 [${after.navs.join(" · ")}]` +
      ` · 좁은 화면을 거치기 전과 ${same ? "같다" : "**달라졌다**"}`);
  await wide.c.close();

  /*
   * ── ⑨ 콘솔 오류 ──────────────────────────────────────────────
   * 상세의 「버튼 안 버튼」 경고는 **배치 ⑥ 의 일**이다. 여기서는 상세를 안 연다.
   */
  chk("⑨-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` [${errs[0].slice(0, 90)}]` : ""}`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    console.log(`\n뒷정리 확인 — 스위치 ${now ? JSON.stringify(now.value) : "(행 없음)"}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})`);
  } finally {
    await browser?.close();
    await pool.end();
  }
}
