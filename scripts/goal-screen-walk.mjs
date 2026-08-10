// 목표 화면 위계 · 상세 열람 · 편집 확정 실측 (MD-P-2026-029 §B · §C · §D · §F).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 라벨은 파일명이 아니라 **화면에서 읽은 값**이다 (§G 캡처 라벨 규격).
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("goal-screen-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-029/screen";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(20)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(20)} ${n}`); };
const chk = (id, c, n) => (c ? ok(id, n) : bad(id, n));

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
let restore = null;   // 실측으로 바꾼 값 되돌리기
let sliderRestore = null;
try {
  // 지금까지의 로그 최대 id — 이 뒤에 생긴 것이 **이 회차가 만든 것**이다.
  logMark = (await sql(`SELECT coalesce(max(id), 0) AS m FROM activity_log`))[0].m;
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const box = (sel) => page.locator(sel).first().boundingBox();
  const css = (sel, prop) => page.locator(sel).first().evaluate((el, p) => getComputedStyle(el)[p], prop);
  /**
   * **규격값은 토큰에서 읽어 대조한다. 숫자를 박지 않는다.**
   * 이 검사는 `19px` · `12.5px` 를 박아 두었다가 §A1(폰트 6단)에서 화면이 20px · 13.5px 로
   * 바뀌자 **멀쩡한 화면을 두 건 위반으로** 잡았다. 규격이 앞서 갔고 검사가 뒤에 남은 것이다.
   * 토큰과 대조하면 다음에 단이 바뀌어도 검사는 저절로 따라온다.
   */
  const token = (name) => page.evaluate((n) =>
    getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await page.locator(".frn-x").first().click().catch(() => {});

  // ══ §B1 연간 요약 카드 ═══════════════════════════════════════════
  const yc = await page.locator(".ycard").count();
  const ycBox = await box(".ycard");
  const ycTitleFs = await css(".ycard-t", "fontSize");
  const ycBarH = await box(".ycard-bar .bar");
  const ycD = await page.locator(".ycard-d").first().innerText().catch(() => "");
  const ycM = await page.locator(".ycard-m").first().innerText().catch(() => "");
  const inTree = await page.locator(".qsec .ycard, .qsec-b .ycard").count();
  await page.screenshot({ path: `${OUT}/B1-연간카드.png` });
  const f2 = await token("--f2");
  chk("B1-연간카드", yc > 0 && ycTitleFs === f2 && ycBarH && Math.round(ycBarH.height) === 6 && inTree === 0,
    `연간 카드 ${yc}개 · 제목 ${ycTitleFs} · 진척 바 ${ycBarH ? Math.round(ycBarH.height) : "?"}px · 남은 기간 "${ycD}" · 진척 "${ycM.replace(/\n+/g, " ")}" · 트리 안에 남은 연간 ${inTree}개(0이어야 한다)`);
  chk("B1-세개초과", yc <= 3 || (await page.locator(".ycards.scroll").count()) === 1,
    yc <= 3 ? `연간이 ${yc}개라 가로 스크롤 조건(4개 이상) 미도달 — 검사 불가` : `연간 ${yc}개 → 가로 스크롤 컨테이너 적용`);

  // ══ §B2 분기 섹션 ════════════════════════════════════════════════
  const qs = await page.locator(".qsec").count();
  const qOpen = await page.locator(".qsec.open").count();
  const qHfs = await css(".qsec-h .gtitle, .qsec-h .gtitle-b", "fontSize").catch(() => "?");
  const qBar = await css(".qsec-h", "borderLeftWidth");
  const shutProg = await page.locator(".qsec:not(.open) .gpv").count();
  const shutTotal = await page.locator(".qsec:not(.open)").count();
  const addPerSec = await page.locator(".qsec.open .qsec-b .gadd").count();
  await page.screenshot({ path: `${OUT}/B2-분기섹션.png` });
  chk("B2-분기섹션", qs > 0 && qBar === "3px",
    `분기 섹션 ${qs}개 · 펼친 것 ${qOpen}개(현재 분기만) · 헤더 제목 ${qHfs} · 좌측 색 바 ${qBar}`);
  chk("B2-접혀도진척", shutTotal === 0 || shutProg === shutTotal,
    shutTotal === 0 ? `접힌 섹션이 없어 검사 불가 (전부 현재 분기)` : `접힌 섹션 ${shutTotal}개 중 진척이 보이는 것 ${shutProg}개 (같아야 한다)`);
  chk("B2-추가는한번", addPerSec === qOpen,
    `펼친 섹션 ${qOpen}개 · 그 안의 "+ 월 목표" ${addPerSec}개 (섹션당 한 번)`);

  // ══ §B3 월 행 ════════════════════════════════════════════════════
  const rowBox = await box(".qsec-b .grow-h");
  const rowFs = await css(".qsec-b .grow-h", "fontSize");
  const rowPad = await css(".qsec-b .grow", "paddingLeft");
  const chipsBefore = await page.locator(".qsec-b .gtasks").count();
  const nBtn = page.locator(".qsec-b .grow-n").first();
  const nTxt = await nBtn.innerText().catch(() => "(없음)");
  await page.screenshot({ path: `${OUT}/B3-월행.png` });
  const f4 = await token("--f4");
  chk("B3-월행", rowBox && Math.round(rowBox.height) === 38 && rowFs === f4 && rowPad === "22px",
    `월 행 높이 ${rowBox ? Math.round(rowBox.height) : "?"}px · 글자 ${rowFs} · 들여쓰기 ${rowPad}`);
  chk("B3-칩기본숨김", chipsBefore === 0,
    `펼치기 전 연결 업무 칩 묶음 ${chipsBefore}개 (0이어야 한다) · 우측 버튼 "${nTxt}"`);
  if (await nBtn.count()) {
    await nBtn.click();
    await page.waitForTimeout(400);
    const chipsAfter = await page.locator(".qsec-b .gtasks").count();
    await page.screenshot({ path: `${OUT}/B3-칩펼침.png` });
    chk("B3-누르면펼침", chipsAfter > 0, `"${nTxt}" 클릭 → 칩 묶음 ${chipsAfter}개 (짝이 되는 존재 단언)`);
  } else {
    bad("B3-누르면펼침", "연결 업무가 있는 월 행이 없어 검사 불가");
  }
  const nowDot = await page.locator(".qsec-b .grow.now").count();
  const nowBg = nowDot ? await css(".qsec-b .grow.now", "backgroundColor") : "-";
  chk("B3-현재월", nowDot === 0 || nowBg === "rgba(0, 0, 0, 0)",
    `현재 월 행 ${nowDot}개 · 배경 ${nowBg} (칠하지 않는다 — 점 하나로만 표시)`);

  // ══ §C1 패널 560px · 슬라이더가 실제로 잡히는가 ═══════════════════
  const g = (await sql(`SELECT id FROM goal WHERE is_active AND period_type='month' ORDER BY id LIMIT 1`))[0];
  await page.goto(`${BASE}/goals?panel=goal:${g.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const pBox = await box(".gdp");
  await page.screenshot({ path: `${OUT}/C1-패널560.png` });
  chk("C1-패널폭", pBox && Math.round(pBox.width) === 560,
    `패널 폭 ${pBox ? Math.round(pBox.width) : "?"}px (560 이어야 한다)`);

  // §C1 — 넓어진 패널에서 진행률 슬라이더가 **마우스로 실제로 끌리는가**.
  // 값이 바뀌는 것까지 봐야 한다. 존재만 확인하면 "있지만 안 잡히는" 상태를 통과시킨다.
  const t = (await sql(
    `SELECT id, progress FROM task WHERE is_active AND status NOT IN ('done','dropped') ORDER BY id LIMIT 1`))[0];
  sliderRestore = { id: t.id, progress: t.progress };
  await page.goto(`${BASE}/tasks?panel=task:${t.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const tdpBox = await box(".tdp");
  await page.locator('.tdp .prop-row:has(.prop-l:text-is("진행률")) .prop-v').click().catch(() => {});
  await page.waitForTimeout(400);
  const sl = page.locator(".tdp input[type=range]").first();
  const slBox = await sl.boundingBox();
  const beforeVal = await sl.inputValue().catch(() => "?");
  if (slBox) {
    // 트랙 왼쪽에서 잡아 오른쪽 80% 지점까지 실제로 끈다
    await page.mouse.move(slBox.x + slBox.width * 0.1, slBox.y + slBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(slBox.x + slBox.width * 0.8, slBox.y + slBox.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(1600);
  }
  const afterVal = await sl.inputValue().catch(() => "?");
  const dbVal = (await sql(`SELECT progress FROM task WHERE id=$1`, [t.id]))[0].progress;
  await page.screenshot({ path: `${OUT}/C1-슬라이더.png` });
  chk("C1-슬라이더", !!slBox && afterVal !== beforeVal && Number(dbVal) === Number(afterVal),
    `업무 패널 폭 ${tdpBox ? Math.round(tdpBox.width) : "?"}px · 슬라이더 트랙 ${slBox ? Math.round(slBox.width) : "없음"}px · ` +
    `마우스로 끌어 ${beforeVal}% → ${afterVal}% · DB ${dbVal}% (화면과 DB 가 같아야 한다)`);

  await page.goto(`${BASE}/goals?panel=goal:${g.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);

  // ══ §D1 닫기 · §D2 저장 상태 · §D3 인라인 확정 ════════════════════
  const closeBox = await box(".gdp-close");
  chk("D1-닫기", closeBox && closeBox.width >= 28,
    `닫기 버튼 ${closeBox ? `${Math.round(closeBox.width)}×${Math.round(closeBox.height)}` : "없음"}px (28px 이상)`);

  const before = (await sql(`SELECT title FROM goal WHERE id=$1`, [g.id]))[0].title;
  restore = { id: g.id, title: before };
  await page.locator(".gdp .tdp-title").first().fill(`${before} [편집실측]`);
  await page.waitForTimeout(300);
  const icons = await page.locator(".gdp-ic button").allTextContents();
  await page.screenshot({ path: `${OUT}/D3-인라인확정.png` });
  chk("D3-확정수단", icons.length === 2,
    `편집 중 노출된 버튼 [${icons.join(", ")}] (확정·취소 둘)`);

  await page.locator(".gdp-ok").click();
  await page.waitForTimeout(1500);
  const savedTxt = await page.locator(".gdp .tdp-save").innerText().catch(() => "");
  const afterTitle = (await sql(`SELECT title FROM goal WHERE id=$1`, [g.id]))[0].title;
  await page.screenshot({ path: `${OUT}/D2-저장성공.png` });
  chk("D2-저장성공", /저장됨/.test(savedTxt) && afterTitle.endsWith("[편집실측]"),
    `✓ 클릭 → 헤더 "${savedTxt.replace(/\n+/g, " ")}" · DB 제목 "${afterTitle}"`);

  // 저장 실패 — PUT 을 500 으로 떨어뜨린다
  await page.route("**/api/goals/*", (r) =>
    r.request().method() === "PUT"
      ? r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "테스트용 500" }) })
      : r.continue());
  await page.locator(".gdp .tdp-title").first().fill(`${before} [실패실측]`);
  await page.locator(".gdp-ok").click();
  await page.waitForTimeout(1200);
  const failTxt = await page.locator(".gdp .tdp-save").innerText().catch(() => "");
  const retry = await page.locator(".gdp-retry").count();
  await page.screenshot({ path: `${OUT}/D2-저장실패.png` });
  chk("D2-저장실패", /저장 실패/.test(failTxt) && retry === 1,
    `PUT 500 → 헤더 "${failTxt.replace(/\n+/g, " ")}" · "다시 시도" ${retry}개 (조용히 넘어가지 않는다)`);
  await page.unroute("**/api/goals/*");

  // ══ §C2 확대 모달 — 컨테이너만 바뀐다 ════════════════════════════
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const beforeCount = await page.locator(".gdp").count();
  await page.locator(".gdp-zoom").click();
  await page.waitForTimeout(700);
  const mBox = await box(".gdp-full");
  const afterCount = await page.locator(".gdp").count();
  const url = new URL(page.url());
  await page.screenshot({ path: `${OUT}/C2-확대모달.png` });
  chk("C2-모달폭", mBox && Math.round(mBox.width) === 880,
    `확대 모달 ${mBox ? `${Math.round(mBox.width)}×${Math.round(mBox.height)}` : "없음"}px (폭 880)`);
  chk("C2-컴포넌트하나", beforeCount === 1 && afterCount === 1,
    `패널 상태 .gdp ${beforeCount}개 → 모달 상태 ${afterCount}개 (내용은 하나뿐, 복제하지 않는다)`);
  chk("C2-URL", url.searchParams.get("panel") === `goal:${g.id}` && url.searchParams.get("full") === "1",
    `URL ${url.pathname}${url.search}`);

  // 모달을 닫으면 패널로 돌아가지 않고 그대로 닫힌다
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const left = await page.locator(".gdp").count();
  const url2 = new URL(page.url());
  chk("C2-닫으면끝", left === 0 && !url2.searchParams.get("panel"),
    `Esc → .gdp ${left}개 · URL "${url2.search || "(없음)"}" (패널로 돌아가지 않는다)`);

  // ══ §A5 「고급」 접힘 ════════════════════════════════════════════
  await page.goto(`${BASE}/goals?panel=goal:${g.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const advOpen = await page.locator(".gdp-adv[open]").count();
  const advSum = await page.locator(".gdp-adv > summary").innerText().catch(() => "(없음)");
  await page.locator(".gdp-adv > summary").click();
  await page.waitForTimeout(700);
  const advNote = await page.locator(".gdp-adv-n").innerText().catch(() => "(없음)");
  const advSel = await page.locator(".gdp-adv select").count();
  await page.screenshot({ path: `${OUT}/A5-고급.png` });
  chk("A5-고급접힘", advOpen === 0 && advSum === "고급",
    `기본 상태에서 열린 「고급」 ${advOpen}개(0이어야 한다) · 요약 "${advSum}"`);
  chk("A5-고급내용", advSel === 1,
    `열면 상위 목표 셀렉트 ${advSel}개 · 출처 설명 "${advNote}"`);

  console.log(`\nJS 오류 ${errs.length}건`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/walk.json`, JSON.stringify(rows, null, 2));
} finally {
  if (logMark !== null) {
    const gone = await sql(`DELETE FROM activity_log WHERE id > $1 RETURNING id`, [logMark]);
    if (gone.length) console.log(`정리 — 이 회차가 남긴 활동 로그 ${gone.length}건 삭제`);
  }
  if (restore) {
    await sql(`UPDATE goal SET title = $1 WHERE id = $2`, [restore.title, restore.id]);
    console.log(`정리 — goal #${restore.id} 제목을 "${restore.title}" 로 되돌림`);
  }
  if (sliderRestore) {
    await sql(`UPDATE task SET progress = $1 WHERE id = $2`, [sliderRestore.progress, sliderRestore.id]);
    console.log(`정리 — task #${sliderRestore.id} 진행률을 ${sliderRestore.progress}% 로 되돌림`);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE '%실측%'`);
  await browser?.close();
  await pool.end();
}
