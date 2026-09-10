// 가오픈 기준 기한 집계 **화면** 실측 (MD-P-2026-041 §C).
//
// **로컬 전용** (지시 32). 쓰기 없음 — 열어 보고 세어 볼 뿐이다.
//
//   ① 팀장이 들어간다 · 팀원은 못 들어간다 (관리자 전용이 아니다)
//   ② 세 갈래 + 완료 제외가 **화면에** 다 있다
//   ③ 화면 숫자 = DB 를 직접 세어 `lib/open-due.ts` 로 계산한 값
//   ④ 총합이 전체와 맞는다 — 화면에도 그 식이 보인다
//   ⑤ ②③ 목록에 필요한 칸이 다 있다 (업무 · 담당 · 기한 · 영역 · 상태 · 며칠 뒤)
//   ⑥ 각 행에서 **그 업무로 간다** — 눌러서 도착까지 본다
//   ⑦ 읽기 전용 — 조작 요소 0 · 오간 요청 전부 GET
//   ⑧ 팀장이 찾아갈 수 있다 (사이드바 「관리」)
//
// ── 조건은 관측보다 먼저 만든다 (§G) ────────────────────────────
//
// 처음 돌렸을 때 「가오픈 이후」가 0건이라 목록 검사가 아무것도 증명하지 못했다.
// 0건인 목록에서는 칸이 다 있는지도, 눌러서 가는지도 알 수 없다. 그래서 검사기가
// **가오픈 뒤 기한을 가진 업무를 하나 만들어 두고** 화면을 연다. 끝나면 지우고
// **시작 전 지문과 대조한다** — 절대값(「[041검사] 0건」)을 기대하지 않는다.
//
// ── 왜 ③을 DB 에서 다시 세는가 ───────────────────────────────────
//
// 화면이 API 를 부르고 API 가 `tallyOpenDue` 를 부른다. 그 둘을 그대로 믿으면
// 이 검사는 「API 가 자기가 낸 값을 그대로 그렸다」만 확인한다. 그래서 **DB 에서
// 직접 읽어** 같은 순수 함수로 다시 세고 화면과 맞춰 본다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("open-due-screen-walk.mjs");

const REPO = process.cwd();
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-041/open-due";
const TMP = path.join(REPO, ".ods-walk-out");
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(24)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(24)} ${n}`); } };

const MARK = "[041검사]";
let browser, madeTaskId = null, beforeFp = null;
try {
  // 제품의 계산 함수를 그대로 쓴다 — 사본을 적으면 사본만 맞는다.
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "open-due.ts"), path.join(REPO, "lib", "countdown.ts"),
     "--outDir", TMP, "--module", "commonjs", "--moduleResolution", "node",
     "--target", "es2022", "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { tallyOpenDue } = req(path.join(TMP, "open-due.js"));

  const lead = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role IN ('admin','lead') ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(
    `SELECT a.actor_id id FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' ORDER BY a.actor_id LIMIT 1`))[0];
  chk("0-짝조건", !!(lead && member), `팀장 ${lead?.id} · 팀원 ${member?.id} (둘 다 있어야 ①이 뜻을 가진다)`);
  if (!lead || !member) throw new Error("검사에 필요한 계정 구성이 없다");

  // 가오픈 시각은 설정에서 온다 — 화면과 같은 곳을 봐야 같은 숫자가 나온다.
  const cfg = (await sql(`SELECT value FROM config WHERE key = 'platform_open_at'`))[0];
  const openAtMs = Date.parse(cfg?.value ?? "2026-11-02T00:00:00+09:00");

  // ── 조건 ── 가오픈 뒤에 걸린 업무를 하나 만든다. **화면을 열기 전에.**
  beforeFp = (await sql(
    `SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;
  const afterOpenDue = new Date(openAtMs + 21 * 86400000).toISOString().slice(0, 10);
  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0];
  madeTaskId = (await sql(
    `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id)
     VALUES ($1, 'todo', $2::date, $3, 'team', 'team', $4, $4) RETURNING id`,
    [`${MARK} 가오픈 뒤 기한`, afterOpenDue, area.id, lead.id]))[0].id;
  console.log(`   (조건) 기한 ${afterOpenDue} 인 업무 #${madeTaskId} 를 만들었다 — 끝나면 지운다`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const host = new URL(BASE).hostname;
  const open = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
    await ctx.addCookies([{ name: "tb_session", value: tok(u), domain: host, path: "/" }]);
    return ctx;
  };

  // ── ① 팀원 짝 — 막힌 쪽부터 본다 ────────────────────────────────
  {
    const ctx = await open({ id: member.id, actorId: member.id, name: "검사", role: "member", adminGrant: false, email: "m@m" });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/open-due`, { waitUntil: "networkidle" });
    await p.waitForTimeout(400);
    const where = new URL(p.url()).pathname;
    const api = await p.evaluate(async () => {
      const r = await fetch("/api/tasks/open-due");
      return { status: r.status, body: await r.json().catch(() => null) };
    });
    chk("①-팀원은-못본다", where !== "/open-due" && api.status === 403,
        `열면 → ${where} · API ${api.status}`);
    await ctx.close();
  }

  // ── 팀장 ────────────────────────────────────────────────────────
  const ctx = await open({ id: lead.id, actorId: lead.id, name: "검사", role: lead.role,
                           adminGrant: lead.admin_grant, email: "l@l" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const reqs = []; page.on("request", (r) => reqs.push({ method: r.method(), url: r.url() }));

  await page.goto(`${BASE}/open-due`, { waitUntil: "networkidle" });
  await page.locator(".frn-skip").first().click({ timeout: 1500 }).catch(() => {});
  await page.locator(".od-strip").waitFor({ timeout: 8000 });
  chk("①-팀장은-본다", new URL(page.url()).pathname === "/open-due", `열면 → ${new URL(page.url()).pathname}`);

  // ② 네 값이 다 있는가 — 완료 제외까지. 없앤 지표는 대체 지표와 함께 없앤다(§G).
  const cells = page.locator(".od-strip .is");
  const labels = [], values = [];
  for (let i = 0; i < await cells.count(); i++) {
    labels.push((await cells.nth(i).locator(".l").innerText()).trim());
    values.push(Number((await cells.nth(i).locator(".v").innerText()).trim()));
  }
  chk("②-네-갈래가-다-있다",
      labels.length === 4 && /이전/.test(labels[0]) && /이후/.test(labels[1])
        && /없음/.test(labels[2]) && /완료/.test(labels[3]),
      labels.join(" · "));

  // ③ DB 에서 직접 세어 같은 순수 함수로 다시 계산한다.
  //    화면이 API 를, API 가 함수를 부르므로 그대로 믿으면 아무것도 안 잰다.
  const rows = await sql(
    `SELECT t.status, t.due_date::text AS due FROM task t
      WHERE t.is_active = true AND (t.visibility = 'team' OR t.created_by = $1)`, [lead.id]);
  const want = tallyOpenDue(rows.map((r) => ({ status: r.status, dueDate: r.due })), openAtMs);
  chk("③-화면=직접-센-값",
      values[0] === want.before && values[1] === want.after
        && values[2] === want.none && values[3] === want.excludedDone,
      `화면 [${values}] · 직접 [${want.before},${want.after},${want.none},${want.excludedDone}]`);

  // ④ 총합이 맞는가 — **화면에도 그 식이 보여야 한다.**
  const sumTxt = (await page.locator(".od-sum").innerText()).trim();
  const bad = await page.locator(".od-sum.bad").count();
  chk("④-총합이-화면에서-맞는다",
      bad === 0 && sumTxt.includes("맞습니다") && sumTxt.includes(String(rows.length)),
      `"${sumTxt.replace(/\s+/g, " ")}"`);

  // ⑤⑥ 목록 — 칸이 다 있고, 눌러서 그 업무로 간다.
  const secs = page.locator(".inbox-sec");
  const afterRows = secs.nth(0).locator(".od-t tbody tr");
  const noneRows = secs.nth(1).locator(".od-t tbody tr");
  const nAfter = await afterRows.count(), nNone = await noneRows.count();
  chk("⑤-목록=집계", nAfter === want.after && nNone === want.none,
      `가오픈 이후 ${nAfter}/${want.after} · 기한 없음 ${nNone}/${want.none}`);

  if (nAfter > 0) {
    const head = (await secs.nth(0).locator(".od-t thead").innerText()).replace(/\s+/g, " ").trim();
    chk("⑤-칸이-다-있다",
        ["업무", "담당", "기한", "영역", "상태", "가오픈보다"].every((h) => head.includes(h)), head);
    const cell = await afterRows.nth(0).locator("td").nth(5).innerText();
    chk("⑤-며칠-뒤가-보인다", /^\+\d+일$/.test(cell.trim()), `"${cell.trim()}"`);

    const href = await afterRows.nth(0).locator("a").first().getAttribute("href");
    await afterRows.nth(0).locator("a").first().click();
    await page.waitForTimeout(1500);
    /*
     * 주소 **문자열**을 통째로 비교했다가 FAIL 이 났고, 제품이 아니라 검사기가
     * 틀린 것이었다 — `/tasks` 가 도착 후 영역 필터를 덧붙여 `&area=1` 이 붙는다.
     * 링크는 맞게 갔다. 물어야 할 것은 주소가 같은가가 아니라
     * **도착한 화면이 그 업무인가**다. 화면에서 읽는다.
     */
    const u = new URL(page.url());
    const landedOnTask = u.pathname === "/tasks" && u.searchParams.get("panel") === `task:${madeTaskId}`;
    // 패널은 제목을 본문 글자로 내지 않는다 — `#번호`로 식별한다. 그걸 읽는다.
    const panel = await page.locator("aside.tdp").first().innerText().catch(() => "");
    const shown = panel.includes(`#${madeTaskId}`) && !panel.includes("불러올 수 없습니다");
    chk("⑥-눌러서-그-업무로-간다", landedOnTask && shown,
        `${href} → ${u.pathname}${u.search} · 상세 패널 ${shown ? `#${madeTaskId} 떴다` : `**안 떴다** (${panel.slice(0, 60).replace(/\n/g, " ")})`}`);
    await page.goBack({ waitUntil: "networkidle" });
    await page.locator(".od-strip").waitFor({ timeout: 8000 });
  } else {
    chk("⑤-칸이-다-있다", false, "**가오픈 이후가 0건이다 — 조건을 만들었는데 화면에 안 왔다**");
    chk("⑤-며칠-뒤가-보인다", false, "위와 같음");
    chk("⑥-눌러서-그-업무로-간다", false, "위와 같음");
  }

  // ⑦ 읽기 전용 — 낱말이 아니라 **오간 요청**으로 본다.
  const ctrls = await page.locator(".hv button, .hv input, .hv select, .hv form").count();
  const wrote = reqs.filter((r) => r.method !== "GET" && new URL(r.url).origin === new URL(BASE).origin);
  chk("⑦-읽기-전용", wrote.length === 0,
      `조작 요소 ${ctrls}개 · 오간 요청 ${reqs.length}건 중 GET 아닌 것 ${wrote.length}`);

  // ⑧ 찾아갈 수 있는가. 주소를 알아야만 닿는 화면은 없는 화면이다.
  await page.locator(".grp").last().evaluate((el) => el.setAttribute("open", ""));
  const link = page.locator('.grp a[href="/open-due"]');
  chk("⑧-팀장이-찾아간다", await link.count() === 1, `사이드바 「관리」에 링크 ${await link.count()}개`);

  await page.screenshot({ path: `${OUT}/open-due.png`, fullPage: true });
  chk("⑨-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(TMP, { recursive: true, force: true });
  // 만든 것을 지우고 **시작 전과 대조한다.** 남기면 다음 검사의 「시작 전」이 오염된다.
  if (madeTaskId !== null) {
    await pool.query(`DELETE FROM task WHERE id = $1`, [madeTaskId])
      .catch((e) => console.error("뒷정리 실패 —", e.message));
  }
  if (beforeFp !== null) {
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])
      .catch(() => ({ rows: [{ n: -1 }] }))).rows[0].n;
    console.log(`\n뒷정리 확인 — ${MARK} 업무 ${left}건 (시작 전 ${beforeFp}건)`);
    if (left !== beforeFp) process.exitCode = 1;
  }
  await browser?.close();
  await pool.end();
}
