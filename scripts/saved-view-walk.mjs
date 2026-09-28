// 저장된 뷰 왕복 실측 (MD-P-2026-027 §B3).
//
// 저장 → 사이드바 핀 등장 → 눌러서 조건 복원 → 순서 변경 → 삭제까지 실제로 밟는다.
// 만든 것은 끝나고 지운다. 라벨에는 **화면에서 읽은 값**을 적는다 (§G 캡처 라벨 규격).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";   // 캡처는 SHOT=1 일 때만 (057 §0)
import { ignoredWhy } from "./console-ignore.mjs";   // 안 세는 것은 한 파일에 (061 §D-14)
import { testUser } from "./test-user.mjs";
import { peopleSnapshot, peopleDiff } from "./people-guard.mjs";   // 074 §C-19 — 사람 줄 대조

requireLocalDb("saved-view-walk.mjs");

/* 065 §B-9 — 검사가 쓰는 신분은 손으로 안 적는다. DB 에서 읽는다. */
const TEST_ME = await testUser();

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-027/saved-view";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

/*
 * 061 §D-16 — 이 검사기에는 단언 함수가 없었다(찍기만 했다).
 * 콘솔 검사를 물리려면 **실패가 실패로 끝나야** 하므로 최소한만 둔다.
 * 다른 검사기들과 같은 모양(`OK`/`FAIL` 한 줄 + 종료 코드)이다.
 */
const chk = (id, c, n) => {
  console.log(`${c ? "OK  " : "FAIL"} ${String(id).padEnd(22)} ${n}`);
  if (!c) process.exitCode = 1;
};

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const NAMES = ["실측 뷰 A", "실측 뷰 B"];
let browser;
/*
 * ── 074 §C — **제 줄만** 쓰고 **제 줄만** 지운다 ────────────────────────
 * 073 §B 가 센 「높음」 둘이 여기 있었다.
 *   · 「내 뷰 삭제」가 사람(#1)의 **가장 오래된** 저장한 보기를 골라 지웠다 — 물리 삭제다
 *   · 순서 바꾸기가 **모든 사람의** 보기 중 앞의 둘을 골랐다
 * 이제 둘 다 이 검사기가 이번 판에 만든 「실측 뷰 A · B」만 고른다. 시작할 때의 최대 id 를
 * 적어 두고, 지울 때도 그 뒤에 생긴 제 이름의 줄만 지운다.
 */
let svMark = null;
let peopleGuard = null;
try {
  // 074 §C-19 — **시작 전 모습**을 떠 둔다. 끝날 때 사람 줄이 같은지 대조한다(072 §G)
  peopleGuard = await peopleSnapshot(pool);
  svMark = (await sql(`SELECT coalesce(max(id), 0) AS m FROM saved_view`))[0].m;
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok(TEST_ME), domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  /*
   * 065 §A-1 — **이 검사기가 스스로 만든 404 는 따로 센다.**
   *
   * 「남의 뷰는 못 고친다」를 확인하려고 일부러 남의 id 로 PATCH·DELETE 를 보낸다.
   * 서버가 404 로 거절하는 것이 그 검사의 **정답**이고, 그때 브라우저가 적는
   * 「Failed to load resource … 404」는 고장이 아니다.
   *
   * **무시 목록(console-ignore)에는 안 넣는다.** 그 파일의 규칙이 이미 그렇게
   * 적혀 있다 — 검사기가 스스로 만든 오류는 어느 칸에도 안 넣는다. 넣으면
   * 다른 검사기에서 난 **진짜 404** 까지 같이 눈감는다. 집안에 답이 있으면
   * 두 번째 답을 만들지 않는다(§G 064).
   * v3-bulk ③짝 · v3-links ⑧짝 · v3-new ⑪짝 · block-walk 과 같은 방법이다.
   */
  const wanted = [];
  const errs = [];
  const take = (t) => {
    if (/Failed to load resource.*\b404\b/.test(t)) { wanted.push(t); return; }
    errs.push(t);
  };
  page.on("pageerror", (e) => take(e.message));
  const ignoredLines = [];
  // 059 §G — 경고까지 센다. 「오류」만 세면 하이드레이션 문제를 못 본다.
  // 061 §D-14 — 다만 **무시 목록**(scripts/console-ignore.mjs)에 있는 것은 뺀다.
  //   목록은 한 파일에 모여 있고 줄마다 왜 뺐는지가 적혀 있다.
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    const skip = ignoredWhy(line);
    if (skip) { ignoredLines.push(`${line.slice(0, 60)} — ${skip}`); return; }
    take(line); });

  const step = async (id, note) => { await shot(page, { path: `${OUT}/${id}.png` }); rows.push({ id, note }); console.log(`  ▸ ${id.padEnd(18)} ${note}`); };

  // ① 조건을 만들고 저장
  await page.goto(`${BASE}/tasks?area=1,2&done=1`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const onChips = await page.locator(".pg-chip.area-chip.on").allTextContents();
  await step("01-filters", `URL ?area=1,2 로 진입 — 켜진 영역 칩 "${onChips.join(" · ")}"`);

  for (const nm of NAMES) {
    page.once("dialog", (d) => d.accept(nm));
    await page.getByRole("button", { name: "이 조건 저장" }).click();
    await page.waitForTimeout(1100);
  }
  const pins = await page.locator(".side .pinview-n").allTextContents();
  await step("02-pinned", `저장 후 사이드바 핀 "${pins.join(" · ")}"`);

  // ② 핀을 눌러 조건 복원
  await page.goto(`${BASE}/notes`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.locator(".side .pinview a").first().click();
  await page.waitForURL(/\/tasks\?/, { timeout: 9000 });
  await page.waitForTimeout(1100);
  const back = await page.locator(".pg-chip.area-chip.on").allTextContents();
  const url = new URL(page.url());
  await step("03-restored", `핀 클릭 → ${url.pathname}${url.search} · 켜진 칩 "${back.join(" · ")}"`);

  // ③ 순서 변경 (드래그는 API 로 검증 — HTML5 DnD 는 합성 이벤트로 신뢰도가 낮다)
  const before = await sql(
    `SELECT id, name, sort_order FROM saved_view
      WHERE target = 'tasks' AND owner_actor_id = $1 AND name = ANY($2::text[]) AND id > $3
      ORDER BY sort_order`, [TEST_ME.id, NAMES, svMark]);
  if (before.length < 2) throw new Error(`제 뷰 둘이 안 만들어졌다(${before.length}) — 남의 뷰로 순서를 재지 않는다`);
  const flipped = [before[1].id, before[0].id];
  await page.evaluate(async (order) => {
    await fetch("/api/saved-views", { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }) });
  }, flipped);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const after = await page.locator(".side .pinview-n").allTextContents();
  await step("04-reordered", `순서 변경 후 핀 "${after.join(" · ")}" (변경 전 "${before.map(b=>b.name).join(" · ")}")`);

  // ④ 경계 — 지시 28 형식. 부재 단언 하나에 짝이 되는 존재 단언을 붙인다.
  //    "남의 뷰가 안 지워진다"만 확인하면 삭제 자체가 고장 나도 통과한다.
  const [mine] = await sql(
    `SELECT id, name FROM saved_view
      WHERE owner_actor_id = $1 AND target = 'tasks' AND name = ANY($2::text[]) AND id > $3
      ORDER BY id LIMIT 1`, [TEST_ME.id, NAMES, svMark]);
  if (!mine) throw new Error("지울 제 뷰가 없다 — 남의 뷰를 지우지 않는다");
  const [foreign] = await sql(
    `INSERT INTO saved_view (owner_actor_id, name, target, filters, sort_order)
     VALUES (3, '남의 뷰 (실측)', 'tasks', '{}', 99) RETURNING id`);

  const listed = await page.evaluate(async () => (await (await fetch("/api/saved-views")).json()).views.map((v) => v.name));
  const seesForeign = listed.includes("남의 뷰 (실측)");

  const delForeign = await page.evaluate(async (id) => (await fetch(`/api/saved-views?id=${id}`, { method: "DELETE" })).status, foreign.id);
  const foreignLeft = (await sql(`SELECT count(*)::int n FROM saved_view WHERE id=$1`, [foreign.id]))[0].n;

  const renameForeign = await page.evaluate(async (id) => (await fetch("/api/saved-views", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, name: "가로챈 이름" }) })).status, foreign.id);
  const foreignName = (await sql(`SELECT name FROM saved_view WHERE id=$1`, [foreign.id]))[0]?.name ?? "(없음)";

  const delMine = await page.evaluate(async (id) => (await fetch(`/api/saved-views?id=${id}`, { method: "DELETE" })).status, mine.id);
  const mineLeft = (await sql(`SELECT count(*)::int n FROM saved_view WHERE id=$1`, [mine.id]))[0].n;

  console.log("\n── 경계 (부재 단언 + 짝이 되는 존재 단언) ──");
  console.log(`  ${!seesForeign ? "OK  " : "FAIL"} 목록에 남의 뷰 안 보임        보인 이름 [${listed.join(", ")}]`);
  console.log(`  ${foreignLeft === 1 ? "OK  " : "FAIL"} 남의 뷰 삭제 안 됨          DELETE ${delForeign} · 남은 행 ${foreignLeft} (1 이어야 한다)`);
  console.log(`  ${foreignName === "남의 뷰 (실측)" ? "OK  " : "FAIL"} 남의 뷰 이름 변경 안 됨      PATCH ${renameForeign} · 이름 "${foreignName}"`);
  console.log(`  ${mineLeft === 0 ? "OK  " : "FAIL"} 내 뷰는 삭제 됨 (짝 단언)     DELETE ${delMine} · 남은 행 ${mineLeft} (0 이어야 한다)`);

  /*
   * 061 §D-16 — **단언에 물린다.** 이제껏 건수를 찍기만 했고, 그래서
   * 초록 밑에 경고가 쌓여 있었다. 무시 목록(console-ignore)에 걸린 것은
   * 빠지고, 남은 것은 **빨개진다.** 빨개진 것을 고치는 것은 다른 회차다.
   */
  /*
   * 짝 — 그 404 가 **실제로 났는지** 센다. 0이면 남의 뷰를 한 번도 안 건드린
   * 것이고, 그러면 위 「콘솔 0건」은 아무것도 안 잰 값이다(§G 053).
   */
  chk("콘솔짝-우리가-만든-404", wanted.length > 0,
      `일부러 만든 404 ${wanted.length}건 (1건 이상이라야 위 줄이 뜻을 가진다)`);
  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
  console.log(`\nJS 오류 ${errs.length}건${errs.length ? ": " + errs[0].slice(0,90) : ""}`);
  fs.writeFileSync(`${OUT}/steps.json`, JSON.stringify({ rows, jsErrors: errs }, null, 2));
} finally {
  if (browser) await browser.close();
  // 이번 판에 생긴 제 이름의 줄만(`id > svMark`). 시작 표를 못 적었으면 **안 지운다**
  const n = svMark === null ? [] : await sql(
    `DELETE FROM saved_view WHERE id > $2 AND name = ANY($1::text[]) RETURNING id`,
    [[...NAMES, "남의 뷰 (실측)", "가로챈 이름"], svMark]);
  const left = (await sql(`SELECT count(*)::int n FROM saved_view`))[0].n;
  console.log(`정리 — 실측 뷰 ${n.length}건 삭제 · 남은 저장된 뷰 ${left}건`);
  if (peopleGuard) {
    const diff = await peopleDiff(pool, peopleGuard).catch((e) => [`대조 실패 — ${e.message}`]);
    console.log(`사람 줄 대조 — 시작 전과 다른 것 ${diff.length}건${diff.length ? ` **[${diff.slice(0, 6).join(" · ")}]**` : ""}`);
    if (diff.length) process.exitCode = 1;
  }
  await pool.end();
}
