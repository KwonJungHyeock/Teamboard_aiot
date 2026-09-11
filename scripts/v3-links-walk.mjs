// v3 「첨부」 링크 미리보기 실측 (MD-P-2026-051 §C).
//
// **로컬 전용** (지시 32). 만든 업무와 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 이미지 URL 을 기록에 붙이면 **썸네일이 그려진다**
//   ② 안 열리는 URL 이면 **안내 문구와 「열기」가 보인다** (빈칸 아님)
//   ③ `http://` 는 **링크 칩만**, img 태그 0개
//   ④ 본문 텍스트가 저장 전후로 **글자 그대로 같다** (본문 훼손 없음)
//   ⑤ 목록 행에는 **img 태그가 0개**이고 클립에 개수가 뜬다
//   ⑥ 저장하는 것이 없다 — 첨부를 그리는 동안 **쓰기 요청이 안 나간다**
//   ⑦ 여덟을 넘으면 **＋n개 더**로 접힌다
//   ⑧ 콘솔 오류 0
//
// **조건은 사람이 할 수 있는 방법으로 만든다**(§G 048).
// 기록 칸에 **직접 쳐서** 저장한다 — DB 에 바로 넣으면 「화면이 저장한 것을
// 그리는가」가 증명되지 않는다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-links-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3l-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-051";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[051링크]";

/*
 * 본문 — **사람이 적을 법한 글**이다. URL 만 늘어놓으면 ④(본문 훼손 없음)가
 * 뜻을 잃는다: 사이에 글자가 있어야 뽑아 가면서 본문을 건드렸는지 보인다.
 *
 * 이미지 하나는 **뜨는 것**, 하나는 **안 뜨는 것**이어야 ①②가 갈린다.
 * 뜨는 쪽은 이 서버가 실제로 내주는 파일을 쓴다(`/favicon.ico` 는 아이콘이라
 * 확장자가 다르므로, 우리 서버의 png 를 찾아 쓴다).
 */
let browser, swBefore = null, beforeCount = null, madeId = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "links.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { extractLinks, kindOf, countLinks, MAX_LINKS } = req(path.join(TMP, "v3", "links.js"));

  // 짝조건 — 규칙 자체가 http 와 https 를 가르는가. 화면 보기 전에 값으로.
  chk("0-짝조건-http-는-미리보기-아님",
      kindOf("http://x.test/a.png") === "plain" && kindOf("https://x.test/a.png") === "image"
      && kindOf("https://x.test/a.pdf") === "pdf"
      && kindOf("https://drive.google.com/file/d/1") === "drive"
      && kindOf("https://evil.test/drive.google.com/x") === "link"
      && MAX_LINKS === 8,
      `http png → ${kindOf("http://x.test/a.png")} · https png → ${kindOf("https://x.test/a.png")}` +
      ` · 가짜 drive 호스트 → ${kindOf("https://evil.test/drive.google.com/x")} · 최대 ${MAX_LINKS}개`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;

  madeId = (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $3, 'doing', $4::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [`${MARK} 링크가 붙은 업무`, areaId, me.id, today]))[0].id;

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  /*
   * **쓰기 요청을 센다** (⑥). 첨부를 그리는 동안 POST·PUT·PATCH·DELETE 가
   * 나가면 「저장하는 것이 없다」가 거짓이다. 기록 저장 한 번은 우리가 한 것이라
   * 따로 세어 빼고 본다.
   */
  const writes = [];
  page.on("request", (r) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(r.method())) {
      writes.push(`${r.method()} ${new URL(r.url()).pathname}`);
    }
  });

  /*
   * ── 뜨는 그림을 어떻게 마련하는가 ──────────────────────────────
   *
   * 처음엔 이 개발 서버의 파일(`/brand/eduino_mark.png`)을 썼다. 그런데
   * **개발 서버는 http 다.** 규칙상 http 는 미리보기를 안 만들므로 칩으로만
   * 섰고, ①이 「img 0개」로 떨어졌다 — 검사기가 틀렸고 제품이 맞았다.
   *
   * 그렇다고 인터넷의 그림을 쓰면 검사가 바깥에 기대게 되고, 인터넷이 끊긴 날
   * 제품 탓으로 읽힌다. 그래서 **https 주소 하나를 이 브라우저 안에서만**
   * 내주게 한다(리포의 실제 png 바이트를 그대로).
   *
   * 사람이 하는 일은 그대로다 — 기록 칸에 https 그림 주소를 적는 것.
   * 바깥에서 화면에 오류를 주입하는 것이 아니라, **그 주소에 파일이 있는
   * 상황**을 만드는 것이다(§G 048).
   */
  const png = readFileSync(path.join(REPO, "public", "brand", "eduino_mark.png"));
  await page.route("https://img.test/**", (route) => {
    if (route.request().url().endsWith("/ok.png")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: png });
    }
    // 없는 파일 — 잠긴 드라이브가 브라우저에 보이는 모습과 같다.
    return route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
  const good = "https://img.test/ok.png";
  const goodOk = png.length > 0;
  const bad = "https://img.test/missing.png";
  const insecure = "http://example.test/a.png";
  const body = [
    "가오픈 준비 메모.",
    `그림은 여기: ${good}`,
    `이건 권한이 막힌 것: ${bad}`,
    `옛날 사내망 그림: ${insecure}`,
    "문서는 https://drive.google.com/file/d/ABC/view 에 있고,",
    "설계는 https://www.figma.com/file/XYZ/mission-deck 를 보세요.",
    "그 밖: https://example.test/docs/spec (괄호 안에 넣어 봄).",
  ].join("\n");
  chk("0-조건을-먼저-만들었다", goodOk,
      `뜨는 그림 ${good} (이 브라우저 안에서 png ${png.length}바이트로 내줌) · 안 뜨는 그림 ${bad}(404)` +
      ` · http ${insecure} · 뽑히는 링크 ${countLinks(body)}개`);

  // ── 기록 칸에 **직접 쳐서** 저장한다 (§G 048) ──────────────────
  await page.goto(`${BASE}/v3/tasks/${madeId}`, { waitUntil: "networkidle" });
  await page.locator(".v3-note-in").waitFor({ timeout: 9000 });
  await page.locator(".v3-note-in").fill(body);
  await page.locator(".v3-dtitle").click();
  await page.locator('.v3-save[data-field="description"]').filter({ hasText: "마지막 저장" })
    .waitFor({ timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(900);

  // ── ④ 본문이 글자 그대로 같다 ──────────────────────────────────
  const inDb = (await sql(`SELECT description FROM task WHERE id = $1`, [madeId]))[0].description;
  const onScreen = await page.locator(".v3-note-in").inputValue();
  chk("④-본문이-글자-그대로-같다",
      inDb === body && onScreen === body,
      `DB ${inDb === body ? "같음" : "**다름**"} · 화면 ${onScreen === body ? "같음" : "**다름**"}` +
      ` · ${body.length}자 · URL 이 본문에 ${(inDb.match(/https?:\/\//g) ?? []).length}개 그대로 남아 있다`);

  // ── ① 이미지 썸네일 ───────────────────────────────────────────
  await page.locator(".v3-atts").waitFor({ timeout: 9000 });
  const imgs = page.locator(".v3-att-img img");
  const nImg = await imgs.count();
  const lazy = await imgs.first().getAttribute("loading").catch(() => null);
  const ref = await imgs.first().getAttribute("referrerpolicy").catch(() => null);
  const drawn = await imgs.first().evaluate((el) => el.naturalWidth > 0).catch(() => false);
  chk("①-이미지가-썸네일로", nImg === 1 && drawn && lazy === "lazy" && ref === "no-referrer",
      `img ${nImg}개 · 실제로 그려짐 ${drawn} · loading=${lazy} · referrerpolicy=${ref}`);

  // ── ② 안 열리는 URL 은 안내 + 「열기」 (빈칸 아님) ──────────────
  const badCard = page.locator(".v3-att-bad").first();
  const badTxt = (await badCard.innerText().catch(() => "")).replace(/\s+/g, " ");
  const openBtn = await badCard.locator("a").filter({ hasText: "열기" }).count();
  const badBox = await badCard.boundingBox();
  chk("②-못-가져오면-안내와-열기",
      badTxt.includes("미리보기를 못 가져왔습니다") && badTxt.includes("링크 권한")
      && openBtn === 1 && badBox !== null && badBox.height > 40,
      `"${badTxt.slice(0, 60)}" · 「열기」 ${openBtn}개 · 높이 ${badBox?.height?.toFixed(0)}px (빈칸이 아니다)`);

  // ── ③ http 는 링크 칩만 ────────────────────────────────────────
  const insecureChip = page.locator(".v3-att-chip.insecure");
  const nInsecure = await insecureChip.count();
  const insecureImg = await page.locator(`.v3-atts img[src^="http://"]`).count();
  chk("③-http-는-칩만", nInsecure === 1 && insecureImg === 0,
      `http 칩 ${nInsecure}개 · http 로 뜨는 img ${insecureImg}개` +
      ` · 칩 글 "${(await insecureChip.innerText().catch(() => "")).replace(/\s+/g, " ")}"`);

  await page.screenshot({ path: `${OUT}/C-첨부.png`, fullPage: true });

  // ── ⑥ 쓰기 요청은 우리가 한 저장 하나뿐 ────────────────────────
  const notOurs = writes.filter((w) => !w.endsWith(`/api/tasks/${madeId}`));
  chk("⑥-저장하는-것이-없다", notOurs.length === 0,
      `쓰기 요청 ${writes.length}건 [${writes.join(", ")}] — 기록 저장 말고 ${notOurs.length}건`);

  // ── ⑤ 목록 행에는 img 0개 · 클립에 개수 ────────────────────────
  const nLinks = countLinks(body);
  await page.goto(`${BASE}/v3/tasks?q=${encodeURIComponent(MARK)}`, { waitUntil: "networkidle" });
  await page.locator(".v3-row").first().waitFor({ timeout: 9000 });
  const rowImgs = await page.locator(".v3-row img").count();
  const clip = (await page.locator(".v3-row .v3-clip").first().innerText().catch(() => "")).trim();
  chk("⑤-목록엔-img-0개-·-클립-개수",
      rowImgs === 0 && clip === String(nLinks),
      `행 안 img ${rowImgs}개 · 클립 "${clip}" · 뽑히는 링크 ${nLinks}개`);

  // 오늘 화면도 같은 규칙이다 — 한쪽만 고치면 다른 쪽에서 그림이 돈다.
  await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  await page.locator(".v3-row").first().waitFor({ timeout: 9000 });
  const todayImgs = await page.locator(".v3-card .v3-row img").count();
  const todayClip = await page.locator(".v3-row .v3-clip").count();
  chk("⑤짝-오늘-화면도-같다", todayImgs === 0 && todayClip >= 1,
      `오늘 행 안 img ${todayImgs}개 · 클립 ${todayClip}개`);

  // ── ⑦ 여덟을 넘으면 ＋n개 더 ───────────────────────────────────
  //
  // 조건을 만든다 — 기록에 **열 개**를 적는다. 여덟이 그려지고 둘이 접혀야 한다.
  const many = Array.from({ length: 10 }, (_, i) =>
    `https://example.test/doc-${i}`).join("\n");
  await page.goto(`${BASE}/v3/tasks/${madeId}`, { waitUntil: "networkidle" });
  await page.locator(".v3-note-in").waitFor({ timeout: 9000 });
  await page.locator(".v3-note-in").fill(many);
  await page.locator(".v3-dtitle").click();
  await page.waitForTimeout(1600);
  const shownBefore = await page.locator(".v3-att-chip, .v3-att-file, .v3-att-img, .v3-att-bad").count();
  const moreTxt = (await page.locator(".v3-att-more").innerText().catch(() => "")).trim();
  await page.locator(".v3-att-more").click().catch(() => {});
  await page.waitForTimeout(400);
  const shownAfter = await page.locator(".v3-att-chip, .v3-att-file, .v3-att-img, .v3-att-bad").count();
  chk("⑦-여덟-넘으면-접힌다",
      shownBefore === MAX_LINKS && /^＋\d+개 더$/.test(moreTxt) && shownAfter === 10,
      `열 개 적음 → 그려진 것 ${shownBefore}개 + "${moreTxt}" → 펼치면 ${shownAfter}개`);

  chk("⑧-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]).catch((e) => console.error("업무 정리 실패", e.message));
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
