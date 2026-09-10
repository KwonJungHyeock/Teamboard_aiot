// v3 「상세」 · 「캘린더」 · 입력 칩 실측 (MD-P-2026-046).
//
// **로컬 전용** (지시 32). 스위치와 **바꾼 값**을 전부 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//  §A 칩
//   ① 거르개 칩은 **검정 채움을 그대로** 쓴다 (안 건드렸다)
//   ② 입력 칩은 검정 채움을 **안 쓴다**
//   ③ **펼친 칩과 값이 든 칩의 계산된 배경이 서로 다르다** (지시 §A 검사기)
//
//  §0 정정
//   ④ 담당 없음 ＋ 아바타가 **목록·상세에서 사라졌다**
//
//  §B 상세
//   ⑤ 상세가 **그 업무로** 뜬다 (주소가 아니라 화면을 본다 — §G)
//   ⑥ 상태를 바꾸면 **DB 가 바뀐다** · 되돌리기도 된다 (완료 → 진행 중)
//   ⑦ 기한을 바꾸면 DB 가 바뀌고, 옆에 **가오픈 표기**가 선다.
//      그 표기는 `lib/open-due.ts` 가 내는 말과 **글자까지 같다**
//   ⑧ 기록은 `description` 에 저장된다 (`body` 가 아니다)
//   ⑨ 진척에 **입력 칸이 없고 이유 한 줄이 있다**
//   ⑩ 거부되면 **서버가 준 이유가 화면에 그대로** 나온다
//
//  §B-3 링크
//   ⑪ C-1 · C-2 · C-5 가 **전부 새 상세에 도착**한다 (도착 화면으로 확인)
//   ⑫ 옛 상세 주소(`/tasks?panel=task:N`)가 **그 업무의** 새 상세로 간다
//   ⑬ 스위치를 끄면 **옛 상세가 그대로** 열린다
//
//  §C 캘린더
//   ⑭ 그 업무가 **기한 칸에** 선다 · 알약은 새 상세로 간다
//   ⑮ 오늘 칸에 **파란 동그라미**, 가오픈 칸에 **가오픈 글자**
//   ⑯ 한 칸에 셋을 넘으면 **＋n** 으로 접히고, 눌러서 펼쳐진다
//   ⑰ 달 이동이 **주소에 담긴다**
//   ⑱ 네 숫자가 `/api/tasks/open-due` 와 **같은 값**이다
//   ⑲ 콘솔 오류 0
//
// ⑯의 조건은 **만들어서** 만든다 — 같은 날 기한 업무 넷을 넣는다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-detail-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3d-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-046";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(28)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(28)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[046검사]";
/** 한 칸에 넷을 몰아넣을 날. 이 달 안이면 아무 날이나 된다. */
const PILE = 4;

let browser, swBefore = null, beforeCount = null;
try {
  /*
   * **제품의 함수를 그대로 부른다.** 규칙을 검사기에 옮겨 적으면 옮겨 적은 것이
   * 맞는지를 검사하게 된다 — 044 부터 쓰는 방식 그대로다.
   */
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "open-due.ts"), path.join(REPO, "lib", "v3", "calendar.ts"),
     path.join(REPO, "lib", "v3", "routes.ts"), path.join(REPO, "lib", "v3", "detail.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { openDueMark } = req(path.join(TMP, "open-due.js"));
  const { taskHref, v3Destination } = req(path.join(TMP, "v3", "routes.js"));
  const { CELL_MAX, monthGrid, parseMonth, shiftMonth } = req(path.join(TMP, "v3", "calendar.js"));
  const { STATUS_CHOICES } = req(path.join(TMP, "v3", "detail.js"));

  // ── 짝조건 — 규칙 자체가 뜻을 갖는지 값으로 먼저 본다 ────────────
  //   · `taskHref` 가 **새 상세**를 가리켜야 ⑪·⑫가 뜻을 갖는다
  //   · 옛 상세 주소가 **목록으로 삼켜지지 않아야** ⑫가 뜻을 갖는다
  //   · 격자는 여섯 줄 고정 — 달을 넘겨도 높이가 안 출렁인다
  const grid = monthGrid("2026-02");            // 28일짜리 달로 본다
  chk("0-링크가-새-상세를-가리킨다",
      taskHref(7) === "/v3/tasks/7" && v3Destination("/tasks?panel=task:7") === "/v3/tasks/7"
      && v3Destination("/tasks") === "/v3/tasks" && grid.length === 6 && grid[0].length === 7,
      `taskHref(7)=${taskHref(7)} · 옛 주소 → ${v3Destination("/tasks?panel=task:7")}` +
      ` · 목록 → ${v3Destination("/tasks")} · 2026-02 격자 ${grid.length}줄×${grid[0].length}` +
      ` · 한 칸 최대 ${CELL_MAX} · 상태 ${STATUS_CHOICES.length}가지`);
  chk("0-달-이동이-순환한다",
      shiftMonth("2026-12", 1) === "2027-01" && shiftMonth("2026-01", -1) === "2025-12"
      && parseMonth("2026-99", "2026-09-10") === "2026-09" && parseMonth(null, "2026-09-10") === "2026-09",
      `12월+1=${shiftMonth("2026-12", 1)} · 1월-1=${shiftMonth("2026-01", -1)}` +
      ` · 이상한 달은 오늘로 (${parseMonth("2026-99", "2026-09-10")})`);

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
  const areas = await sql(`SELECT id, name FROM area WHERE is_active = true ORDER BY sort_order, id`);

  // KST 오늘. 화면이 서버에서 받는 값과 같은 방식으로 뽑는다.
  const kst = (ms) => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ms));
  const today = kst(Date.now());
  // 한 칸에 넷을 몰아넣을 날 — **이 달 안**이라야 격자에 선다. 15일로 잡는다.
  const pileDay = `${today.slice(0, 7)}-15`;

  // ── 조건을 만든다 ────────────────────────────────────────────────
  const mk = async (title, due, status = "todo") => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $3, $4, $5::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, areas[0].id, me.id, status, due]))[0].id;

  const subject = await mk(`${MARK} 상세로 여는 업무`, today);
  for (let i = 1; i <= PILE; i += 1) await mk(`${MARK} 같은 날 ${i}`, pileDay);

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const bg = (l) => l.evaluate((el) => getComputedStyle(el).backgroundColor);

  /*
   * 가오픈 시각은 **제품에게 묻는다.**
   *
   * 처음엔 `config` 행을 직접 읽었는데 로컬엔 그 행이 없다 — 제품은
   * `DEFAULT_OPEN_AT` 로 내려가고, 검사기만 `undefined` 를 들고 ⑦에서 죽었다.
   * 검사기가 값을 따로 구하면 **제품이 쓰는 값과 갈라진다.** 화면이 받는 그
   * 값을 그대로 받아 온다(`/api/tasks/open-due` 가 `openAt` 을 함께 준다).
   */
  await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  const openAt = await page.evaluate(async () =>
    (await (await fetch("/api/tasks/open-due")).json()).openAt);
  const openAtMs = Date.parse(String(openAt));
  chk("0-짝조건", areas.length === 7 && Number.isFinite(openAtMs),
      `area ${areas.length}개 · 가오픈 ${openAt} (제품에게 물었다) · 오늘(KST) ${today}` +
      ` · 몰아넣는 날 ${pileDay}`);

  // ══ §A 칩 두 종류 ═══════════════════════════════════════════════
  await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await page.locator(".v3-chip").first().waitFor({ timeout: 8000 });
  // ① 거르개는 검정 채움 그대로 — 「전체」가 눌려 있다.
  const filterOn = page.locator('.v3-chip[aria-pressed="true"]').first();
  const filterBg = await bg(filterOn);
  chk("①-거르개-칩은-검정-채움", filterBg === "rgb(22, 32, 58)",
      `골라진 거르개 칩 배경 ${filterBg} (= --v3-ink #16203A · 안 건드렸다)`);

  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  await page.locator(".v3-ichip").first().waitFor({ timeout: 8000 });
  const chips = page.locator(".v3-ichip");
  // 담당 칩은 늘 값이 있다(기본 = 나). 기한 칩은 비어 있다.
  const filledChip = chips.filter({ hasText: "담당" }).first();
  const emptyChip = chips.filter({ hasText: "기한" }).first();
  const line = (l) => l.evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.borderTopStyle} ${s.borderTopColor}`;
  });
  const filledBg = await bg(filledChip);
  const emptyBg = await bg(emptyChip);
  const emptyLine = await line(emptyChip);
  // ② 입력 칩에 거르개의 검정 채움이 없다 — 세 상태 전부.
  await emptyChip.click();
  await page.waitForTimeout(200);
  const openBg = await bg(emptyChip);
  const openLine = await line(emptyChip);
  chk("②-입력-칩은-검정-채움-안-쓴다",
      ![filledBg, emptyBg, openBg].includes(filterBg),
      `값 있음 ${filledBg} · 값 없음 ${emptyBg} · 펼침 ${openBg} — 셋 다 거르개 ${filterBg} 와 다르다`);
  /*
   * ② 짝 — **값 없음과 펼침은 배경이 둘 다 흰색이다**(지시가 그렇게 정했다).
   * 그러면 배경만 재는 검사는 그 둘을 못 가른다. 가르는 것은 테두리이므로
   * 테두리를 잰다 — 안 재면 「점선인 채로 펼쳐져도 통과」가 된다.
   */
  chk("②짝-값없음↔펼침은-테두리로-갈린다", emptyLine !== openLine,
      `값 없음 ${emptyLine} → 펼침 ${openLine} (배경은 둘 다 ${emptyBg})`);
  // ③ **펼친 칩과 값이 든 칩의 계산된 배경이 다르다** (지시 §A 검사기).
  chk("③-펼침≠값있음-배경", openBg !== filledBg,
      `펼침 ${openBg} ≠ 값 있음 ${filledBg}`);
  /*
   * ③ 짝 — **값이 든 칩을 펼쳤을 때**도 그런가.
   *
   * 여기가 진짜 위험한 자리다. `.filled` 와 `.open` 이 한 칩에 같이 붙으므로,
   * CSS 순서가 뒤집히면 「고르는 중」인데 연한 바탕이 남아 값 있음과 구별이
   * 사라진다. 값 없는 칩만 재면 그 뒤집힘이 안 잡힌다.
   */
  await filledChip.click();
  await page.waitForTimeout(200);
  const filledOpenBg = await bg(filledChip);
  chk("③짝-값-든-칩도-펼치면-흰-바탕", filledOpenBg === openBg && filledOpenBg !== filledBg,
      `담당 칩: 값 있음 ${filledBg} → 펼침 ${filledOpenBg} (빈 칩 펼침 ${openBg} 과 같다)`);
  await page.screenshot({ path: `${OUT}/v3-chips.png`, fullPage: true });

  // ══ §0 담당 없음 ＋ 아바타가 사라졌다 ═══════════════════════════
  await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
  await page.locator(".v3-row").first().waitFor({ timeout: 8000 });
  const listPlus = await page.locator(".v3-av.none").count();

  // ══ §B 상세 ════════════════════════════════════════════════════
  await page.goto(`${BASE}/v3/tasks/${subject}`, { waitUntil: "networkidle" });
  await page.locator(".v3-dtitle").waitFor({ timeout: 8000 });
  // **도착을 화면으로 본다**(§G) — 주소가 아니라 제목과 번호를 본다.
  const dTitle = await page.locator(".v3-dtitle").inputValue();
  const dMeta = (await page.locator(".v3-dmeta").innerText()).replace(/\s+/g, " ");
  chk("⑤-상세가-그-업무로-뜬다",
      dTitle.includes("상세로 여는 업무") && dMeta.includes(`#${subject}`),
      `제목 "${dTitle}" · 줄 "${dMeta}"`);
  const detailPlus = await page.locator(".v3-av.none").count();
  chk("④-담당없음-＋-아바타-없음", listPlus === 0 && detailPlus === 0,
      `목록 ${listPlus}개 · 상세 ${detailPlus}개 — 046 §0 에서 거둔 표시`);

  // ── ⑥ 상태 · 되돌리기 ──────────────────────────────────────────
  const statusBtn = (label) => page.locator(".v3-stbtn").filter({ hasText: label }).first();
  const statusCard = () => page.locator(".v3-card").filter({ hasText: "상태" }).first();
  const statusSub = async () => (await statusCard().locator(".v3-sub").innerText()).trim();
  await statusBtn("완료").click();
  await page.waitForTimeout(1200);
  const afterDone = (await sql(`SELECT status, completed_at FROM task WHERE id = $1`, [subject]))[0];
  const subDone = await statusSub();
  await statusBtn("진행 중").click();
  await page.waitForTimeout(1200);
  const afterBack = (await sql(`SELECT status, completed_at FROM task WHERE id = $1`, [subject]))[0];
  const subBack = await statusSub();
  chk("⑥-상태-바꾸고-되돌린다",
      afterDone.status === "done" && afterDone.completed_at !== null
      && afterBack.status === "doing" && afterBack.completed_at === null,
      `완료 → ${afterDone.status}(완료시각 있음) · 되돌림 → ${afterBack.status}(완료시각 ${afterBack.completed_at})`);
  /*
   * ⑥ 짝 — **지금 상태를 글자로도 말하는가.**
   *
   * 네 칸 중 하나만 테두리로 표시했더니 「완료」 칸의 초록 체크가 늘 켜져
   * 보여서 지금 상태가 완료인 줄 읽혔다. 모양 하나에 두 가지를 말하게 두면
   * 읽는 쪽에서 갈라진다 — 그래서 카드 제목 옆에 지금 상태를 적는다.
   */
  chk("⑥짝-지금-상태를-글자로도", subDone === "완료" && subBack === "진행 중",
      `완료로 바꾼 뒤 "${subDone}" · 되돌린 뒤 "${subBack}"`);

  // ── ⑦ 기한 + 가오픈 표기가 같은 계산 ───────────────────────────
  const newDue = pileDay;
  await page.locator(".v3-ichip").filter({ hasText: "기한" }).first().click();
  await page.locator("#v3-d-due").fill(newDue);
  await page.waitForTimeout(1400);
  const afterDue = (await sql(`SELECT due_date::text d FROM task WHERE id = $1`, [subject]))[0];
  const openTxt = (await page.locator(".v3-dopen").innerText().catch(() => "")).trim();
  const expect = openDueMark(newDue, openAtMs).label;
  chk("⑦-기한-저장-·-가오픈-표기가-같다",
      afterDue.d === newDue && openTxt === expect,
      `due_date ${afterDue.d} · 화면 "${openTxt}" · lib/open-due "${expect}"`);

  // ── ⑧ 기록은 description ───────────────────────────────────────
  await page.locator(".v3-note-in").fill(`${MARK} 기록은 description 에 들어간다`);
  await page.locator(".v3-dtitle").click();   // 칸에서 벗어나면 저장
  await page.waitForTimeout(1400);
  const afterNote = (await sql(`SELECT description FROM task WHERE id = $1`, [subject]))[0];
  chk("⑧-기록은-description-에",
      afterNote.description.includes("description 에 들어간다"),
      `description = "${afterNote.description.slice(0, 46)}" (컬럼 body 는 실재하지 않는다)`);

  // ── ⑨ 진척은 읽기 전용 + 이유 한 줄 ────────────────────────────
  const progCard = page.locator(".v3-card").filter({ hasText: "진척" }).first();
  const progInputs = await progCard.locator("input, select, textarea").count();
  const progWhy = (await progCard.locator(".v3-why").innerText()).trim();
  chk("⑨-진척은-칸-없이-이유-한-줄",
      progInputs === 0 && progWhy.length > 10,
      `진척 카드 입력 ${progInputs}개 · 이유 "${progWhy}"`);

  // ── ⑩ 거부 이유가 그대로 ───────────────────────────────────────
  //
  // 조건을 만든다 — 화면이 보내는 것과 **같은 모양**으로 없는 상태를 보낸다.
  const rej = await page.evaluate(async (id) => {
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "없는상태" }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, subject);
  chk("⑩-거부-이유가-서버-그대로",
      rej.status >= 400 && typeof rej.body?.error === "string",
      `PATCH ${rej.status} · "${rej.body?.error}" — 화면은 이 문구를 그대로 낸다`);
  await page.screenshot({ path: `${OUT}/v3-detail.png`, fullPage: true });

  // ══ §B-3 링크가 전부 새 상세로 ═════════════════════════════════
  //
  // **도착 화면으로 확인한다**(§G). 주소만 보면 「상세로 갔다」와 「목록으로
  // 삼켜졌다」가 구별이 안 된다 — 045 에서 실제로 삼켜졌던 자리다.
  const arrived = async (label, go) => {
    await go();
    const ok = await page.locator(".v3-dmeta").filter({ hasText: `#${subject}` })
      .first().waitFor({ timeout: 9000 }).then(() => true).catch(() => false);
    const u = new URL(page.url());
    return { label, ok, where: `${u.pathname}${u.search}` };
  };

  const hops = [];
  // C-2 업무 목록의 행
  hops.push(await arrived("C-2 업무", async () => {
    await page.goto(`${BASE}/v3/tasks`, { waitUntil: "networkidle" });
    await page.locator(".v3-row-t").filter({ hasText: "상세로 여는 업무" }).first().click();
  }));
  // C-5 캘린더의 알약
  hops.push(await arrived("C-5 캘린더", async () => {
    await page.goto(`${BASE}/v3/calendar`, { waitUntil: "networkidle" });
    await page.locator(".v3-pill").filter({ hasText: "상세로 여는 업무" }).first().click();
  }));
  // C-1 오늘 — 기한을 오늘로 되돌려야 「오늘 할 일」에 선다. 조건을 먼저 만든다.
  await sql(`UPDATE task SET due_date = $2::date WHERE id = $1`, [subject, today]);
  hops.push(await arrived("C-1 오늘", async () => {
    await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    await page.locator(".v3-row-t").filter({ hasText: "상세로 여는 업무" }).first().click();
  }));
  chk("⑪-C1·C2·C5-가-새-상세로", hops.every((h) => h.ok),
      hops.map((h) => `${h.label} → ${h.where} ${h.ok ? "도착" : "**못 감**"}`).join(" · "));

  // ── ⑫ 옛 상세 주소가 그 업무의 새 상세로 ───────────────────────
  const legacy = await arrived("옛 주소", async () => {
    await page.goto(`${BASE}/tasks?panel=task:${subject}`, { waitUntil: "networkidle" });
  });
  chk("⑫-옛-상세-주소가-옮겨진다", legacy.ok && legacy.where === `/v3/tasks/${subject}`,
      `/tasks?panel=task:${subject} → ${legacy.where} ${legacy.ok ? "그 업무로 도착" : "**다른 화면**"}`);

  // ── ⑬ 스위치를 끄면 옛 상세가 그대로 ───────────────────────────
  await setSwitch(null);
  await page.goto(`${BASE}/tasks?panel=task:${subject}`, { waitUntil: "networkidle" });
  const oldPanel = await page.locator("aside.tdp").filter({ hasText: `#${subject}` })
    .first().waitFor({ timeout: 9000 }).then(() => true).catch(() => false);
  const offUrl = new URL(page.url());
  chk("⑬-스위치-끄면-옛-상세-그대로", oldPanel && offUrl.pathname === "/tasks",
      `스위치 off · ${offUrl.pathname}${offUrl.search} · 옛 패널에 #${subject} ${oldPanel ? "떴다" : "**안 떴다**"}`);
  await setSwitch(true);

  // ══ §C 캘린더 ══════════════════════════════════════════════════
  await sql(`UPDATE task SET due_date = $2::date WHERE id = $1`, [subject, pileDay]);
  await page.goto(`${BASE}/v3/calendar`, { waitUntil: "networkidle" });
  await page.locator(".v3-cal-d").first().waitFor({ timeout: 9000 });
  await page.locator(".v3-pill").first().waitFor({ timeout: 9000 });

  /** 그 날짜의 칸. 앞뒤 달에서 딸려 온 같은 숫자와 안 헷갈리게 `.out` 을 뺀다. */
  const cellOf = (date) =>
    page.locator(`.v3-cal-d:not(.out)`).filter({ has: page.locator(".v3-cal-dn", { hasText: new RegExp(`^${Number(date.slice(8))}$`) }) }).first();

  const pileCell = cellOf(pileDay);
  const pillTexts = await pileCell.locator(".v3-pill").allInnerTexts();
  chk("⑭-기한-칸에-선다", pillTexts.some((t) => t.includes("상세로 여는 업무")),
      `${pileDay} 칸의 알약 [${pillTexts.map((t) => t.slice(0, 12)).join(" · ")}]`);

  // ⑮ 오늘 파란 동그라미 · 가오픈 글자
  const todayCell = page.locator(".v3-cal-d.today").first();
  const dnBg = await bg(todayCell.locator(".v3-cal-dn"));
  const todayN = (await todayCell.locator(".v3-cal-dn").innerText()).trim();
  // 가오픈일이 이 달이 아니면 그 달로 넘겨서 본다 — 없다고 넘어가지 않는다.
  const openYm = kst(openAtMs).slice(0, 7);
  const openDayN = Number(kst(openAtMs).slice(8));
  await page.goto(`${BASE}/v3/calendar?m=${openYm}`, { waitUntil: "networkidle" });
  await page.locator(".v3-cal-d").first().waitFor({ timeout: 9000 });
  const openCell = page.locator(".v3-cal-d.open").first();
  const openLabel = (await openCell.locator(".v3-cal-open").innerText().catch(() => "")).trim();
  const openCellN = (await openCell.locator(".v3-cal-dn").innerText().catch(() => "")).trim();
  chk("⑮-오늘-파란-동그라미-·-가오픈-글자",
      dnBg === "rgb(47, 95, 232)" && todayN === String(Number(today.slice(8)))
      && openLabel === "가오픈" && openCellN === String(openDayN),
      `오늘 ${todayN}일 배경 ${dnBg} (= --v3-rail) · 가오픈 ${openYm}-${openCellN} "${openLabel}"`);

  // ⑯ ＋n 으로 접히고 눌러서 펼쳐진다
  await page.goto(`${BASE}/v3/calendar`, { waitUntil: "networkidle" });
  await page.locator(".v3-pill").first().waitFor({ timeout: 9000 });
  const pile2 = cellOf(pileDay);
  const before = await pile2.locator(".v3-pill:not(.more)").count();
  const moreTxt = (await pile2.locator(".v3-pill.more").innerText().catch(() => "")).trim();
  await pile2.locator(".v3-pill.more").click();
  await page.waitForTimeout(300);
  const after = await pile2.locator(".v3-pill:not(.more)").count();
  chk("⑯-한-칸-셋-넘으면-＋n",
      before === 3 && /^＋\d+$/.test(moreTxt) && after === before + Number(moreTxt.slice(1)),
      `접힘 ${before}개 + "${moreTxt}" → 펼침 ${after}개 (그 날 기한 ${PILE + 1}건 넣었다)`);

  // ⑰ 달 이동이 주소에
  const thisYm = today.slice(0, 7);
  await page.locator(".v3-calbar button").filter({ hasText: "다음달" }).click();
  await page.waitForTimeout(500);
  const nextUrl = new URL(page.url());
  const shown = (await page.locator(".v3-calm").innerText()).trim();
  chk("⑰-달-이동이-주소에", nextUrl.searchParams.get("m") !== null && nextUrl.searchParams.get("m") !== thisYm,
      `?m=${nextUrl.searchParams.get("m")} · 화면 "${shown}" (이번 달 ${thisYm} 은 주소에 안 적는다)`);

  // ⑱ 네 숫자가 API 와 같다
  await page.goto(`${BASE}/v3/calendar`, { waitUntil: "networkidle" });
  await page.locator(".v3-odstrip").waitFor({ timeout: 9000 });
  const strip = await page.locator(".v3-odstrip .v3-stat-n").allInnerTexts();
  const api = await page.evaluate(async () => (await (await fetch("/api/tasks/open-due")).json()).tally);
  chk("⑱-네-숫자가-API-와-같다",
      strip.map(Number).join(",") === [api.before, api.after, api.none, api.excludedDone].join(","),
      `화면 [${strip.join(", ")}] · API [${api.before}, ${api.after}, ${api.none}, ${api.excludedDone}]`);

  /*
   * ⑱ 짝 — **두 「기한 없음」이 화면에서 맞춰진다.**
   *
   * 위 네 숫자는 완료를 빼고 세고(`tallyOpenDue`), 달력이 그리는 재료
   * (`/api/tasks`)에는 완료가 들어 있다. 그래서 처음 화면에 「기한 없는 3건」과
   * 「기한 없음 2」가 나란히 떴다 — 둘 다 맞는데 읽는 사람은 고장으로 읽는다.
   * 화면이 그 차이를 **스스로 말하는지**를 잰다. 값으로 확인한다.
   */
  const apiTasks = await page.evaluate(async () => (await (await fetch("/api/tasks")).json()).tasks);
  const split = { total: 0, open: 0 };
  for (const t of apiTasks) if (!t.dueDate) { split.total += 1; if (t.status !== "done") split.open += 1; }
  const lede = (await page.locator(".v3-lede").first().innerText()).replace(/\s+/g, " ");
  const reconciled = split.total === split.open
    ? lede.includes(`${split.total}건`)
    : lede.includes(`${split.total}건`) && lede.includes(`${split.open}건`);
  chk("⑱짝-두-「기한-없음」이-맞춰진다",
      reconciled && split.open === api.none,
      `달력 재료 기한없음 ${split.total}건(안 끝난 것 ${split.open}건) · 네 숫자의 기한 없음 ${api.none}` +
      ` · 안내줄 "${lede.slice(0, 90)}"`);
  await page.screenshot({ path: `${OUT}/v3-calendar.png`, fullPage: true });

  chk("⑲-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
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
