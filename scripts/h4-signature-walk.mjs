// H4 시그니처 실측 (MD-P-2026-027 §H4 · 지시 32-g).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// ① 홈 다크 히어로 — 6개까지만 stagger · 나머지는 즉시 · 세션당 1회 ·
//    stagger 도중 이탈해도 중간 상태로 멈추지 않는가
// ② 목표 트리 연쇄 — 폴링 · 재진입 · 필터 변경에서 재생되지 않는가 (32-g),
//    화면 밖이면 재생하지 않는가, 연달아 바꾸면 겹쳐 쌓이지 않는가
//
// 라벨은 파일명이 아니라 **화면에서 읽은 값**이다 (§G 캡처 라벨 규격).
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("h4-signature-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-027/h4";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(26)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(26)} ${n}`); };
const chk = (id, c, n) => (c ? ok(id, n) : bad(id, n));

const COOKIE = (h) => ({ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
  domain: h, path: "/" });

let browser;
/**
 * **검사가 만든 것은 검사가 지운다 — 값뿐 아니라 「기록」도.**
 *
 * 이 검사는 진행률 슬라이더를 실제로 끌어서 잰다. 그러면 활동 로그에
 * `진행률 변경 (0% → 90%)` 이 남는다. 값은 finally 에서 SQL 로 되돌리지만
 * **되돌림은 로그를 남기지 않으므로**, 화면에는 "90 으로 올렸다"만 열 번 쌓였다.
 *
 * 실제로 일어난 일 — 프로젝트 상세 「최근 활동」이 같은 줄 다섯 개로 채워져
 * 다른 활동을 밀어냈고, PM 이 캡처를 보고 **"진행률이 저장되지 않는다"** 고 읽었다.
 * 조사 결과 API 는 정상이었다(200 · DB 90). 화면을 오독하게 만든 것은 이 잔여물이다.
 *
 * 그래서 시작 시점의 로그 최대 id 를 적어 두고, 끝날 때 그 뒤에 생긴 것을 지운다.
 * **몇 건을 지웠는지 찍는다** — 조용히 지우면 그것대로 안 보인다.
 */
let logMark = null;
let restore = null;   // 실측으로 바꾼 진척값을 되돌리기 위한 기록
try {
  // 지금까지의 로그 최대 id — 이 뒤에 생긴 것이 **이 회차가 만든 것**이다.
  logMark = (await sql(`SELECT coalesce(max(id), 0) AS m FROM activity_log`))[0].m;
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const host = new URL(BASE).hostname;

  // ══════════════════════════════════════════════════════════════════
  // ① 홈 다크 히어로 타임라인
  // ══════════════════════════════════════════════════════════════════
  console.log("\n── H4-① 홈 다크 히어로 타임라인 ──");
  const c1 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await c1.addCookies([COOKIE(host)]);
  const p1 = await c1.newPage();
  const e1 = []; p1.on("pageerror", (e) => e1.push(e.message));

  await p1.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await p1.waitForSelector(".hm-hero .gt2-bar", { timeout: 12000 }).catch(() => {});
  // 클래스는 useLayoutEffect 가 첫 페인트 전에 붙인다. 붙는 순간을 기다렸다가 읽는다 —
  // 기다리지 않고 읽으면 하이드레이션 전 상태를 "재생 안 됨"으로 잘못 적는다.
  await p1.waitForSelector(".hm-hero .gt2-bar.hero-grow", { timeout: 4000 }).catch(() => {});

  // 시작 — 아직 자라기 전
  const read1 = async () => p1.evaluate(() => {
    const bars = [...document.querySelectorAll(".hm-hero .gt2-bar")];
    const g = bars.filter((b) => b.classList.contains("hero-grow"));
    const sx = (el) => {
      const m = getComputedStyle(el).transform;
      if (m === "none") return 1;
      const n = m.match(/matrix\(([^,]+)/);
      return n ? Math.round(parseFloat(n[1]) * 100) / 100 : 1;
    };
    return { total: bars.length, growing: g.length,
             delays: g.map((b) => getComputedStyle(b).animationDelay).join(","),
             scales: bars.map(sx) };
  });
  const f0 = await read1();
  await p1.screenshot({ path: `${OUT}/H4-01히어로-1시작.png` });
  await p1.waitForTimeout(120);
  const f1 = await read1();
  await p1.screenshot({ path: `${OUT}/H4-01히어로-2중간.png` });
  await p1.waitForTimeout(900);
  const f2 = await read1();
  await p1.screenshot({ path: `${OUT}/H4-01히어로-3끝.png` });

  console.log(`  프레임  시작 scaleX [${f0.scales.join(", ")}] → 중간 [${f1.scales.join(", ")}] → 끝 [${f2.scales.join(", ")}]`);
  chk("H4-01-최대6개", f0.growing <= 6 && f0.growing === Math.min(6, f0.total),
    `바 ${f0.total}개 중 hero-grow ${f0.growing}개 (min(6, ${f0.total}) 이어야 한다) · delay "${f0.delays}"`);
  chk("H4-01-나머지즉시", f0.total <= 6 || f0.scales.slice(6).every((s) => s === 1),
    f0.total <= 6 ? `바가 ${f0.total}개뿐이라 초과분 없음 — 7번째 이후 검사 불가` :
    `7번째 이후 scaleX [${f0.scales.slice(6).join(", ")}] (전부 1이어야 한다)`);
  chk("H4-01-끝상태", f2.scales.every((s) => s === 1) && f2.growing === 0,
    `끝 scaleX 전부 1 · 남은 hero-grow ${f2.growing}개 (0이어야 한다 — 클래스를 떼야 중간 상태가 안 남는다)`);

  // 세션당 1회 — 같은 컨텍스트에서 다시 들어가면 재생하지 않는다
  await p1.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await p1.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await p1.waitForSelector(".hm-hero .gt2-bar", { timeout: 12000 }).catch(() => {});
  const again = await read1();
  await p1.screenshot({ path: `${OUT}/H4-01히어로-재진입.png` });
  chk("H4-01-세션1회", again.growing === 0,
    `재진입 시 hero-grow ${again.growing}개 (0이어야 한다) · scaleX [${again.scales.join(", ")}]`);

  // stagger 도중 이탈 — 중간 상태로 멈추지 않는가
  const c1b = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await c1b.addCookies([COOKIE(host)]);
  const p1b = await c1b.newPage();
  await p1b.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await p1b.waitForSelector(".hm-hero .gt2-bar", { timeout: 12000 }).catch(() => {});
  await p1b.waitForTimeout(80);                       // 연쇄 도중
  await p1b.mouse.wheel(0, 600);                      // 스크롤
  await p1b.goto(`${BASE}/goals`, { waitUntil: "networkidle" });   // 다른 화면으로
  await p1b.goBack({ waitUntil: "domcontentloaded" });
  await p1b.waitForSelector(".hm-hero .gt2-bar", { timeout: 12000 }).catch(() => {});
  await p1b.waitForTimeout(900);
  const after = await p1b.evaluate(() => [...document.querySelectorAll(".hm-hero .gt2-bar")].map((el) => {
    const m = getComputedStyle(el).transform;
    if (m === "none") return 1;
    const n = m.match(/matrix\(([^,]+)/); return n ? Math.round(parseFloat(n[1]) * 100) / 100 : 1;
  }));
  await p1b.screenshot({ path: `${OUT}/H4-01히어로-이탈복귀.png` });
  chk("H4-01-이탈안전", after.length > 0 && after.every((s) => s === 1),
    `stagger 도중 스크롤 + 화면 이동 후 복귀 — scaleX [${after.join(", ")}] (전부 1이어야 한다. 0 이 남으면 안 보이는 바다)`);
  await c1b.close();
  await c1.close();

  // ══════════════════════════════════════════════════════════════════
  // ② 목표 트리 연쇄 (32-g)
  // ══════════════════════════════════════════════════════════════════
  console.log("\n── H4-② 목표 트리 연쇄 (32-g) ──");
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await c2.addCookies([COOKIE(host)]);
  const p2 = await c2.newPage();
  const e2 = []; p2.on("pageerror", (e) => e2.push(e.message));

  // 연쇄가 재생됐는지 판정하는 눈 — 화면의 %가 두 프레임에 걸쳐 **다른 값**을 지나가는지 본다.
  // 최종값만 보면 "굴러갔는지"와 "그냥 바뀌었는지"를 구별할 수 없다.
  const watch = async (page, ms = 900) => page.evaluate((ms) => new Promise((res) => {
    const read = () => [...document.querySelectorAll(".gpv")].map((e) => e.textContent.trim()).join("|");
    const seen = new Set([read()]);
    const t0 = performance.now();
    const tick = () => {
      seen.add(read());
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else res(Array.from(seen));
    };
    requestAnimationFrame(tick);
  }), ms);

  /**
   * 요소별로 본다 — 시작 시점에 화면 안이었는지, 그리고 그 요소의 글자가 몇 가지를 지났는지.
   * 전체를 한 문자열로 합쳐 세면 "화면 밖 요소는 안 굴렀다"를 확인할 수 없다.
   * 화면 안 요소 하나만 굴러도 합계가 늘어나기 때문이다.
   */
  const watchEach = async (page, ms) => page.evaluate((ms) => new Promise((res) => {
    const els = [...document.querySelectorAll(".gpv")];
    const vis = els.map((e) => { const r = e.getBoundingClientRect(); return r.bottom > 0 && r.top < window.innerHeight; });
    const seen = els.map((e) => new Set([e.textContent.trim()]));
    const t0 = performance.now();
    const tick = () => {
      els.forEach((e, i) => seen[i].add(e.textContent.trim()));
      if (performance.now() - t0 < ms) requestAnimationFrame(tick);
      else res(els.map((_, i) => ({ visible: vis[i], states: seen[i].size })));
    };
    requestAnimationFrame(tick);
  }), ms);

  await p2.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(1600);
  await p2.locator(".frn-skip").first().click({ timeout: 3000 })
    // 안내는 계정에 따라 안 뜬다(`account.onboarded_at`). 실패해도 되지만
    // **조용히 넘어가지는 않는다** — 빈 catch 는 없는 실패를 만든다(§G).
    .catch(() => console.log("   (첫 실행 안내 없음 — 닫을 것이 없다)"));

  // (a) 화면 재진입 — 재생되면 안 된다
  await p2.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await p2.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  const reenter = await watch(p2, 1200);
  chk("32g-재진입", reenter.length === 1, `재진입 중 화면의 % 상태 ${reenter.length}가지 (1이어야 한다 = 굴러가지 않음)`);

  // (b) 필터 변경 — 재생되면 안 된다
  const chips = await p2.locator(".pg-chip.area-chip").count();
  if (chips > 0) {
    const [filt] = await Promise.all([watch(p2, 1500), p2.locator(".pg-chip.area-chip").first().click()]);
    chk("32g-필터변경", filt.length <= 2,
      `필터 변경 중 % 상태 ${filt.length}가지 (목록이 바뀌므로 1~2가지. 3가지 이상이면 굴러간 것)`);
    await p2.locator(".pg-chip").first().click();     // 전체 영역으로 되돌림
    await p2.waitForTimeout(900);
  } else {
    bad("32g-필터변경", "영역 칩이 없어 검사 불가");
  }

  // (c) 폴링 갱신 — 남이 바꾼 것처럼 GOAL_UPDATED 만 쏜다. 재생되면 안 된다.
  const poll = await (async () => {
    const w = watch(p2, 1500);
    await p2.evaluate(() => window.dispatchEvent(new CustomEvent("tb:goal-updated")));
    return w;
  })();
  chk("32g-폴링갱신", poll.length === 1,
    `데이터 재조회만 일어났을 때 % 상태 ${poll.length}가지 (1이어야 한다 — 남이 바꾼 값은 굴러가지 않는다)`);

  // (d) 사용자가 직접 바꿈 — **재생돼야 한다** (짝이 되는 존재 단언)
  const target = (await sql(
    `SELECT t.id, t.progress FROM task t JOIN goal_task gt ON gt.task_id = t.id
     WHERE t.is_active AND t.status NOT IN ('done','dropped') ORDER BY t.id LIMIT 1`))[0];
  if (!target) {
    bad("32g-직접변경", "목표에 연결된 진행 중 업무가 없어 검사 불가");
  } else {
    restore = target;
    /** 진행률을 v 로 바꾼다. 패널이 닫혀 있으면 다시 연다 — 저장 후 재조회로 닫히는 일이 있다. */
    const setProg = async (v) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await p2.locator(".tdp input[type=range]").count() > 0) break;
        if (await p2.locator(".tdp").count() === 0) {
          await p2.goto(`${BASE}/goals?panel=task:${target.id}`, { waitUntil: "networkidle" });
          await p2.waitForTimeout(1500);
        }
        await p2.locator('.tdp .prop-row:has(.prop-l:text-is("진행률")) .prop-v').click().catch(() => {});
        await p2.waitForTimeout(400);
      }
      await p2.locator(".tdp input[type=range]").first().evaluate((el, v) => {
        const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        set.call(el, String(v));
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      }, v);
    };

    await p2.goto(`${BASE}/goals?panel=task:${target.id}`, { waitUntil: "networkidle" });
    await p2.waitForTimeout(1800);
    const before = await p2.locator(".gpv").first().innerText().catch(() => "?");
    const [seen] = await Promise.all([watch(p2, 9000), setProg(60)]);   // dev 서버의 목표 재조회가 느려 넉넉히 본다
    await p2.screenshot({ path: `${OUT}/H4-02연쇄-2중간.png` });
    await p2.waitForTimeout(900);
    const afterTxt = await p2.locator(".gpv").first().innerText().catch(() => "?");
    const dbNow = (await sql(`SELECT progress FROM task WHERE id=$1`, [target.id]))[0]?.progress;
    await p2.screenshot({ path: `${OUT}/H4-02연쇄-3끝.png` });
    chk("32g-직접변경", seen.length >= 3,
      `사람이 진행률을 ${target.progress}→60 으로 바꿨을 때(DB 확인 ${dbNow}) 화면 % 상태 ${seen.length}가지 (3가지 이상이어야 굴러간 것) · "${before.replace(/\n+/g, " ")}" → "${afterTxt.replace(/\n+/g, " ")}"`);

    /**
     * (e) 화면 밖 — 보이지 않는 곳에서는 재생하지 않는다.
     *
     * **재조준 (§C3 ⑦).** 950px 높이에서는 목표 진척 값 6개가 전부 한 화면에 들어간다.
     * 바닥까지 스크롤해도 **화면 밖 요소가 0개**였고, 그러면 이 줄은 검사할 대상이 없는
     * 채로 FAIL 을 냈다. 제품이 틀린 게 아니라 **검사 조건을 못 만든 것**이었다.
     *
     * 그래서 이 한 줄 동안만 뷰포트를 낮춰 조건을 **실제로 만든다.**
     * 「화면 밖이면 재생하지 않는다」는 뷰포트 높이와 무관한 성질이므로,
     * 조건을 만들어 재는 것이 조건이 생기기를 기다리는 것보다 옳다.
     * 다 재고 나면 원래 높이로 되돌린다 — 뒤 줄들이 이 높이를 물려받으면 안 된다.
     */
    const VP = p2.viewportSize();
    await p2.setViewportSize({ width: VP.width, height: 360 });
    await p2.waitForTimeout(200);
    await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p2.waitForTimeout(500);
    const offCount = await p2.evaluate(() =>
      [...document.querySelectorAll(".gpv")]
        .filter((e) => { const r = e.getBoundingClientRect(); return !(r.bottom > 0 && r.top < window.innerHeight); }).length);
    const [each] = await Promise.all([watchEach(p2, 9000), setProg(20)]);
    const off = each.filter((x) => !x.visible);
    const on = each.filter((x) => x.visible);
    // 상태 1가지 = 값이 그대로, 2가지 = 옛값→새값으로 **툭 바뀜**(스냅), 3가지 이상 = 굴러감.
    // "화면 밖이면 재생하지 않는다"는 스냅까지 금지하는 말이 아니다 — 값은 바뀌어야 한다.
    // 처음엔 1가지를 요구했는데, 그건 "값도 바뀌지 마라"는 뜻이 돼 버린다.
    /*
     * 짝을 **같은 관찰 안에서** 세울 수 없다.
     *
     * 값이 바뀌는 `.gpv` 는 롤업 체인의 위쪽(연간·분기)에 몰려 있다. 바닥까지 스크롤하면
     * 그것들이 전부 화면 밖으로 나가고, 화면 안에 남는 것은 **애초에 안 바뀌는 것들**이다.
     * 그 상태에서 "화면 안 것 중 하나는 굴러야 한다"를 요구하면 영원히 실패한다.
     *
     * 반대로 화면 밖 쪽도 조심해야 한다. **안 바뀐 값이 안 구르는 것은 증거가 아니다.**
     * 「화면 밖이라 안 굴렀다」와 「바뀐 게 없어서 안 굴렀다」가 똑같이 생겼다.
     * 그래서 화면 밖 판정에 **「실제로 값이 바뀐 것이 최소 하나 있다」**(states === 2)를 붙인다.
     *
     * 굴러가는 쪽은 아래에서 **한 번 더 바꿔** 따로 잰다. 관찰이 둘이 되는 대신
     * 두 줄 다 진짜 관찰이 된다.
     */
    const offChanged = off.filter((x) => x.states >= 2);
    if (off.length === 0) {
      bad("32g-화면밖", `검사 조건을 못 만들었다 — 뷰포트 360px 에서도 화면 밖 .gpv 가 0개다(스크롤 직후 ${offCount}개). `
        + `제품 판정이 아니라 **미검사**다`);
    } else if (offChanged.length === 0) {
      bad("32g-화면밖", `화면 밖 ${off.length}개 중 **값이 바뀐 것이 하나도 없다** — 안 바뀐 값이 안 구르는 것은 증거가 아니다. `
        + `화면 밖 상태 [${off.map((x) => x.states).join(",")}] · 화면 안 [${on.map((x) => x.states).join(",")}]`);
    } else {
      chk("32g-화면밖", off.every((x) => x.states <= 2),
        `뷰포트 360px 로 낮춰 조건을 만들었다 — 화면 밖 ${off.length}개(그중 값이 실제로 바뀐 것 ${offChanged.length}개) · `
        + `화면 밖 % 상태 [${off.map((x) => x.states).join(",")}] — 바뀌었는데도 2 이하 = **툭 바뀌고 안 굴렀다**`);
    }

    // 화면 밖에서 바뀐 값이 **나중에 보일 때도** 재생되지 않는가.
    // 그때는 "방금 내가 한 일"이 아니다.
    // **뷰포트는 아직 360px 이다** — 원래 높이로 돌려놓고 재면 화면 밖 요소가 0개가 되어
    // "안 굴렀다"가 공짜로 참이 된다. 위 재조준과 같은 이유로 여기서도 조건을 유지한다.
    await p2.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await p2.waitForTimeout(300);
    const later = await watchEach(p2, 2500);
    await p2.evaluate(() => window.scrollTo(0, 0));
    const backUp = await watchEach(p2, 2500);
    chk("32g-나중에도안함", backUp.every((x) => x.states === 1),
      `뷰포트 360px 유지 · 화면 밖에서 바뀐 뒤 다시 위로 스크롤 → % 상태 [${backUp.map((x) => x.states).join(",")}] (전부 1이어야 한다) · 스크롤 직전 [${later.map((x) => x.states).join(",")}]`);

    // 짝 — 같은 변경이 **화면 안**에서는 굴러간다.
    // 원래 높이로 되돌린 뒤 위로 올려야 목표 값들이 화면에 든다.
    // 360px 에서는 머리줄·필터가 자리를 다 먹어 맨 위로 올려도 `.gpv` 가 한 개도 안 보인다 —
    // 실제로 그렇게 재서 「화면 안 0개」로 실패했다. **조건을 만들지 못한 채 낸 판정이었다.**
    await p2.setViewportSize(VP);
    await p2.waitForTimeout(200);
    await p2.evaluate(() => window.scrollTo(0, 0));
    await p2.waitForTimeout(300);
    const [eachOn] = await Promise.all([watchEach(p2, 9000), setProg(45)]);
    const onVis = eachOn.filter((x) => x.visible);
    if (onVis.length === 0) bad("32g-화면안굴러감", "화면 안 .gpv 가 0개다 — 조건을 못 만들었다(미검사)");
    else chk("32g-화면안굴러감", onVis.some((x) => x.states >= 3),
      `원래 높이로 되돌리고 위로 올린 뒤 같은 변경 — 화면 안 ${onVis.length}개 % 상태 [${onVis.map((x) => x.states).join(",")}] `
      + `(최소 하나는 3 이상 = 굴러감). 이것이 위 「화면 밖은 안 구른다」의 짝이다`);

    // (f) 연달아 변경 — 겹쳐 쌓이지 않는가. 마지막 값으로 조용히 끝나야 한다.
    await p2.evaluate(() => window.scrollTo(0, 0));
    await p2.waitForTimeout(500);
    await setProg(80);
    await p2.waitForTimeout(150);
    await setProg(35);
    await p2.waitForTimeout(3000);
    const settled = await p2.locator(".gpv").first().innerText().catch(() => "?");
    await p2.waitForTimeout(900);
    const settled2 = await p2.locator(".gpv").first().innerText().catch(() => "?");
    chk("32g-연속변경", settled === settled2,
      `80 → 35 연달아 바꾼 뒤 3초 "${settled.replace(/\n+/g, " ")}" · 3.9초 "${settled2.replace(/\n+/g, " ")}" (같아야 한다 = 연쇄가 겹쳐 쌓이지 않음)`);
  }

  // reduce — 연쇄가 아예 재생되지 않는다
  const c3 = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
  await c3.addCookies([COOKIE(host)]);
  const p3 = await c3.newPage();
  await p3.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await p3.waitForSelector(".hm-hero .gt2-bar", { timeout: 12000 }).catch(() => {});
  await p3.waitForTimeout(300);
  const rGrow = await p3.locator(".hm-hero .gt2-bar.hero-grow").count();
  const rAnim = await p3.evaluate(() => [...document.querySelectorAll(".hm-hero .gt2-bar")]
    .filter((el) => getComputedStyle(el).animationName !== "none").length);
  await p3.screenshot({ path: `${OUT}/H4-reduce-홈.png` });
  chk("H4-reduce", rGrow === 0 && rAnim === 0,
    `reduce 에서 hero-grow 클래스 ${rGrow}개 · 애니메이션 걸린 바 ${rAnim}개 (둘 다 0이어야 한다)`);
  await c3.close();
  await c2.close();

  console.log(`\nJS 오류 ${e1.length + e2.length}건`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/h4.json`, JSON.stringify(rows, null, 2));
} finally {
  if (logMark !== null) {
    const gone = await sql(`DELETE FROM activity_log WHERE id > $1 RETURNING id`, [logMark]);
    if (gone.length) console.log(`정리 — 이 회차가 남긴 활동 로그 ${gone.length}건 삭제`);
  }
  // 실측으로 바꾼 진척값을 원래대로 되돌린다 — 자기가 건드린 것만.
  if (restore) {
    await sql(`UPDATE task SET progress = $1 WHERE id = $2`, [restore.progress, restore.id]);
    console.log(`정리 — task #${restore.id} 진행률을 ${restore.progress}% 로 되돌림`);
  }
  await browser?.close();
  await pool.end();
}
