// 영역 ↔ 프로젝트 조합 실측 (MD-P-2026-061 §A).
//
// **로컬 전용** (지시 32). 만든 것은 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 영역 밖 프로젝트는 **버튼 줄에 없다** — 화면 버튼 = DB 그 영역 프로젝트
//   ② 영역을 바꾸면 **선택이 비고 안내가 뜬다**
//   ③ 강제로 어긋난 조합을 보내면 **400** 이고 응답에 **제약 이름이 없다**
//   ④ v3 에는 이 조합을 만들 자리가 **아예 없다** (§A-3)
//   ⑤ 콘솔 오류·경고 0
//
// ── ③ 을 왜 화면 밖에서 보내는가 ────────────────────────────────
//
// §A-1 로 화면에서는 그 조합을 **만들 수 없게** 됐다. 그래도 서버는 막아야 한다
// — 화면을 안 거치는 길(API 직접 · 앞으로 생길 화면)이 늘 있다. 그래서 이것만
// 화면이 아니라 `fetch` 로 보낸다. 사람이 할 수 있는 일을 재는 것이 아니라
// **보증이 남아 있는지**를 재는 자리다(§A-2 ⑤).
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
import { shot } from "./shot.mjs";   // 캡처는 SHOT=1 일 때만 (057 §0)
import { IGNORED_CONSOLE, ignoredWhy } from "./console-ignore.mjs";

requireLocalDb("area-project-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".ap-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-061";
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
const MARK = "[061영역]";

let browser, swBefore = null, made = [];
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "project-buttons.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  // **제품의 규칙을 그대로 부른다** — 검사기가 거르개를 다시 적으면 둘이 갈린다(§G 048).
  const { projectButtons } = req(path.join(TMP, "project-buttons.js"));

  /*
   * 짝조건 — 규칙 자체를 먼저 묻는다. 영역을 주면 그 영역만, 안 주면 예전 그대로.
   * 화면을 열기 전에 여기서 걸리면 화면 탓이 아니다.
   */
  const fake = [
    { id: 1, name: "가", areaId: 1, type: "goal" },
    { id: 2, name: "나", areaId: 2, type: "goal" },
    { id: 3, name: "상시1", areaId: 1, type: "standing" },
    { id: 4, name: "상시9", areaId: 9, type: "standing" },
  ];
  const areasFake = [{ id: 1, name: "하나" }, { id: 2, name: "둘" }, { id: 9, name: "아홉" }];
  const all = projectButtons(fake, [1], areasFake).buttons.map((b) => b.id).sort();
  const only1 = projectButtons(fake, [1], areasFake, 1).buttons.map((b) => b.id).sort();
  const only9 = projectButtons(fake, [1], areasFake, 9).buttons.map((b) => b.id).sort();
  chk("0-짝조건-영역을-주면-그-영역만",
      JSON.stringify(only1) === "[1,3]" && JSON.stringify(only9) === "[4]"
      && JSON.stringify(all) === "[1,2,3]",
      `영역 안 줌 [${all}] · 영역1 [${only1}] · 영역9 [${only9}]` +
      ` — 영역9 는 내 소속이 아닌데도 그 영역 상시가 나온다(고를 수 있는 것은 내놓는다)`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const areas = await sql(`SELECT id, name FROM area WHERE is_active ORDER BY sort_order, id`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  /*
   * ③ 이 **일부러** 400 을 만든다. 그때 브라우저가 적는 「Failed to load resource
   * … 400」은 고장이 아니라 우리가 만든 조건이다. 그 구간에서만, 그 문장만 따로
   * 센다 — 400 전부를 눈감으면 진짜 400 도 놓친다 (v3-bulk·v3-detail 과 같은 방법).
   * **무시 목록에는 안 넣는다** — 남이 낸 400 까지 같이 눈감게 되기 때문이다.
   */
  let expect400 = false;
  const errs = [], ignored = [], wanted = [];
  const take = (t) => {
    if (expect400 && /Failed to load resource.*400/.test(t)) { wanted.push(t); return; }
    (ignoredWhy(t) ? ignored : errs).push(t.slice(0, 160));
  };
  page.on("pageerror", (e) => take(e.message));
  page.on("console", (m) => { const k = m.type();
    if (k === "error" || k === "warning") take(`[${k}] ${m.text()}`); });

  await page.goto(`${BASE}/tasks?panel=task:new`, { waitUntil: "networkidle" });
  await page.waitForSelector(".ntm", { timeout: 10000 });

  /** 영역을 바꾼다 — 고급을 열어야 영역 칸이 있다(027 §B). */
  const setArea = async (name) => {
    const adv = page.locator(".ntm-adv");
    if ((await adv.getAttribute("aria-expanded")) !== "true") await adv.click();
    await page.locator('.ntm-side .prop-row:has(.prop-l:text-is("영역")) .prop-v').click();
    await page.locator(".ntm-side select").selectOption({ label: name });
    await page.waitForTimeout(350);
  };
  const shown = async () => ({
    btns: await page.locator(".ntm-main .pp .pp-b").allInnerTexts(),
    off: await page.locator(".ntm-main .pp-off").innerText().catch(() => null),
    picked: await page.locator('.ntm-main .pp .pp-b[aria-pressed="true"]').count(),
    swap: await page.locator(".ntm-swap").innerText().catch(() => null),
  });

  // ── ① 영역 밖 프로젝트는 버튼 줄에 없다 ───────────────────────
  //
  // **DB 와 맞춰 본다.** 화면이 그린 것을 화면이 확인하면 아무것도 안 잰다.
  const rows = [];
  let mismatch = 0, emptyBad = 0;
  for (const a of areas) {
    await setArea(a.name);
    const st = await shown();
    const db = (await sql(
      `SELECT count(*)::int n FROM project WHERE is_active AND area_id = $1`, [a.id]))[0].n;
    const seen = st.btns.length;
    if (seen !== db) mismatch += 1;
    // 0개일 때만 안내가 떠야 한다. 있는데 「없습니다」가 뜨면 화면이 거짓말한 것이다.
    if ((db === 0) !== (st.off !== null)) emptyBad += 1;
    rows.push(`${a.name} 화면${seen}/DB${db}${st.off ? " ·안내" : ""}`);
  }
  chk("①-영역-밖-프로젝트는-없다", mismatch === 0 && emptyBad === 0,
      `${rows.join(" · ")} — 어긋난 영역 ${mismatch}개 · 안내가 잘못 뜬 영역 ${emptyBad}개`);
  await shot(page, { path: `${OUT}/A-영역별-프로젝트.png` });

  // ── ② 영역을 바꾸면 선택이 비고 안내가 뜬다 ───────────────────
  const rich = areas.find((a) => a.name === "플랫폼") ?? areas[0];
  const other = areas.find((a) => a.id !== rich.id);
  await setArea(rich.name);
  await page.locator(".ntm-main .pp .pp-b").first().click();
  const before = await shown();
  await setArea(other.name);
  const after = await shown();
  /*
   * **끝까지 잰다 — 저장해 본다.**
   *
   * 처음엔 「눌린 버튼 0개 + 안내 문구」로만 물었다가 일부러 깨뜨려 보니
   * **안 깨졌다.** 선택을 안 비워도 그 프로젝트 버튼은 새 영역에서 안 그려지므로
   * `aria-pressed` 는 어차피 0이었다 — 눈에 안 보이는 것과 값이 없는 것을
   * 구별하지 못하는 단언이었다. 남아 있으면 **저장할 때** 드러난다(그것이 이번에
   * 고친 500 이다). 그러니 실제로 저장하고 결과를 본다.
   */
  const t2 = `${MARK} 영역 바꾼 뒤 저장`;
  await page.locator(".ntm-title").fill(t2);
  const saveRes = await page.evaluate(() => new Promise((ok) => {
    const orig = window.fetch;
    window.fetch = async (...a) => {
      const r = await orig(...a);
      if (String(a[0]).endsWith("/api/tasks")) { window.fetch = orig; ok(r.status); }
      return r;
    };
    document.querySelector(".ntm-foot .btn-primary")?.click();
    setTimeout(() => ok(-1), 8000);
  }));
  await page.waitForTimeout(900);
  const saved = await sql(`SELECT project_id, area_id FROM task WHERE title = $1`, [t2]);
  chk("②-영역을-바꾸면-선택이-빈다",
      before.picked === 1 && after.picked === 0
      && after.swap === "영역을 바꿔서 프로젝트 선택을 지웠습니다"
      && saveRes === 200 && saved.length === 1 && saved[0].project_id === null,
      `${rich.name} 에서 고름 ${before.picked}개 → ${other.name} 로 바꾼 뒤 ${after.picked}개` +
      ` · 안내 "${after.swap ?? "(없음)"}"` +
      ` · 그대로 저장 → HTTP ${saveRes} · project_id ${saved[0]?.project_id ?? "null"}` +
      ` (남아 있었으면 제약에 걸려 400 이 났을 것이다)`);
  await shot(page, { path: `${OUT}/A-영역-바꿈-안내.png` });

  // ── ③ 어긋난 조합은 400 이고 제약 이름이 응답에 없다 ──────────
  //
  // 화면으로는 못 만드는 조합이라 **fetch 로 직접** 보낸다. 제약은 그대로 있어야
  // 하고(보증), 응답은 사람 말이어야 한다(편의).
  const bad = (await sql(
    `SELECT p.id, p.area_id FROM project p WHERE p.is_active
       AND p.area_id <> (SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1)
     ORDER BY p.id LIMIT 1`))[0];
  const myArea = areas[0].id;
  expect400 = true;
  const res = await page.evaluate(async ([pid, aid, title]) => {
    const r = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, areaId: aid, projectId: pid, workType: "team" }),
    });
    let body = null; try { body = await r.json(); } catch { body = null; }
    return { status: r.status, body };
  }, [bad.id, myArea, `${MARK} 어긋난 조합`]);
  const text = JSON.stringify(res.body ?? {});
  chk("③-어긋난-조합은-400",
      res.status === 400
      && !/area_id|must match|trg_task_area_match/.test(text)
      && /고른 프로젝트가 고른 영역에 속하지 않습니다/.test(text),
      `영역 ${myArea} + 프로젝트 #${bad.id}(영역 ${bad.area_id}) → HTTP ${res.status}` +
      ` · 응답 ${text.slice(0, 90)} — 제약 이름이 응답에 ${/area_id|must match/.test(text) ? "**있다**" : "없다"}`);

  expect400 = false;
  // ③짝2 — 우리가 만든 400 이 **실제로 났는가.** 0이면 ③ 은 400 없이 통과한 것이다.
  chk("③짝2-400-이-실제로-났다", wanted.length >= 1,
      `우리가 만든 400 ${wanted.length}건 (1건 이상이라야 ③ 이 뜻을 가진다)`);

  // ③짝 — **제약은 그대로 있다.** 화면이 막는다고 보증을 떼지 않았다(§A-2 ⑤).
  const trg = (await sql(
    `SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_task_area_match'`))[0].n;
  chk("③짝-DB-제약은-그대로", trg === 1,
      `trg_task_area_match ${trg}개 (1이어야 한다 — 편의가 생겼다고 보증을 떼지 않는다)`);

  // ── ④ v3 에는 이 조합을 만들 자리가 없다 (§A-3) ───────────────
  //
  // 코드를 읽어 「없다」고 적지 않는다. **화면을 열고 프로젝트를 고르는 자리가
  // 있는지 세고**, 새 업무를 실제로 만들어 보낸 몸통에 `projectId` 가 없는지 본다.
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);
  const v3 = await ctx.newPage();
  const bodies = [];
  v3.on("request", (r) => {
    if (r.url().endsWith("/api/tasks") && r.method() === "POST") bodies.push(r.postData() ?? "");
  });
  await v3.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  const v3pick = await v3.locator(".pp, .pp-b, [aria-label='프로젝트']").count();
  const v3word = (await v3.locator("body").innerText()).includes("프로젝트");
  await v3.locator(".v3-title-in").fill(`${MARK} v3 새 업무`);
  await v3.locator(".v3-catbtn").first().click();
  await v3.locator(".v3-newfoot .v3-btn.primary").click();
  await v3.waitForTimeout(1600);
  const mine = await sql(`SELECT id, project_id FROM task WHERE title = $1`, [`${MARK} v3 새 업무`]);
  made = mine.map((t) => t.id);
  chk("④-v3-에는-그-자리가-없다",
      v3pick === 0 && !v3word && mine.length === 1 && mine[0].project_id === null
      && bodies.length === 1 && !bodies[0].includes("projectId"),
      `v3 새 업무 — 프로젝트 고르개 ${v3pick}개 · 화면 글에 「프로젝트」 ${v3word ? "있음" : "없음"}` +
      ` · 보낸 몸통에 projectId ${bodies[0]?.includes("projectId") ? "있음" : "없음"}` +
      ` · 만들어진 업무의 project_id ${mine[0]?.project_id ?? "null"}` +
      ` — 고를 자리가 없으니 어긋난 조합을 만들 수 없다`);
  await v3.close();

  chk("⑤-콘솔오류", errs.length === 0,
      `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}` +
      ` (③ 이 일부러 만든 400 ${wanted.length}건 · 무시 목록 ${ignored.length}건은 따로 셌다)`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  try {
    await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]);
    await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]);
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    console.log(`\n뒷정리 확인 — 스위치 ${now ? JSON.stringify(now.value) : "(행 없음)"}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (0이어야 한다)`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
    await browser?.close();
    await pool.end();
  }
}
