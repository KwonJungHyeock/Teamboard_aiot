// 되돌리기가 진행률도 되돌리는가 (MD-P-2026-073 §A).
//
// **로컬 전용.** 스위치와 **바꾼 값**을 전부 시작 전으로 되돌린다. 누르는 줄은 전부
// `[073되돌림]` 줄이다 — **사람의 업무는 누르지 않는다**(072 §G). 끝날 때 사람 업무를
// 시작 전 모습과 대조해 다르면 되돌리고 빨강이다. 진행률 편집자 설정은 **읽기만** 한다 —
// 검사가 사람의 권한을 만지지 않는다(068 §C-3).
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   A-7   권한 있는 사람(진행률 편집자): 70% 업무를 체크 → 완료·100 → 되돌리기 →
//         **대기 · 70**(0 이 아니라 원래 값 — §A-10)
//   A-6   권한 없는 사람: 같은 흐름 → **상태는 대기로 돌아오고 진행률은 100 그대로** ·
//         토스트에 「상태는 되돌렸습니다. 진행률은 그대로입니다」
//   A-11  일부러 깬다 —
//         ① 되돌리기 요청에서 진행률을 빼 보낸다(070 의 모양) → DB 가 100 에 남는다 → A-7 이 잡는다
//         ② 편집자 번호를 못 받게 한다 → 권한 있는 사람도 진행률을 못 되돌린다 → A-7 이 잡는다
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { testUser } from "./test-user.mjs";

requireLocalDb("v3-undo-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3undo-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[073되돌림]";
const START = 70;

let browser, swBefore = null, realBefore = null, logMark = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "live.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const { PROGRESS_KEPT_LINE } = createRequire(path.join(TMP, "noop.cjs"))(path.join(TMP, "v3", "live.js"));

  // ── 시작 전 모습 — 사람 업무 · 활동 기록 ────────────────────────
  await sql(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]);
  realBefore = new Map((await sql(
    `SELECT id, status, completed_at::text c, resolution, progress FROM task WHERE title NOT LIKE $1`, [`${MARK}%`]))
    .map((r) => [r.id, JSON.stringify([r.status, r.c, r.resolution, r.progress])]));
  logMark = (await sql(`SELECT coalesce(max(id), 0) AS m FROM activity_log`))[0].m;
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  /*
   * ── 두 사람 — **설정을 바꾸지 않고** 있는 그대로에서 고른다 ─────────
   * 권한 있는 사람 = 지금의 진행률 편집자. 없는 사람 = 편집자가 아닌 팀원.
   * 편집자가 비어 있으면 권한 있는 쪽을 못 잰다 — 설정을 채워 조건을 만들지 않고 「못 쟀다」로 멈춘다.
   */
  const editorId = Number((await sql(`SELECT value FROM config WHERE key = 'progress_editor_actor_id'`))[0]?.value);
  if (!Number.isInteger(editorId) || editorId <= 0) throw new Error("진행률 편집자가 비어 있다 — 권한 있는 사람을 못 잰다(설정은 안 바꾼다)");
  const ed = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, a.email, ac.display_name name FROM account a
       JOIN actor ac ON ac.id = a.actor_id WHERE a.actor_id = $1 AND ac.is_active`, [editorId]))[0];
  if (!ed) throw new Error(`편집자 #${editorId} 의 활성 계정이 없다`);
  const EDITOR = { id: ed.id, actorId: ed.id, name: ed.name, role: ed.role, adminGrant: ed.admin_grant, email: ed.email };
  const OTHER = await testUser("member");
  if (OTHER.id === EDITOR.id) throw new Error("팀원이 곧 편집자다 — 권한 없는 사람을 못 잰다");
  console.log(`   (조건) 권한 있는 사람 #${EDITOR.id} ${EDITOR.name}(편집자) · 없는 사람 #${OTHER.id} ${OTHER.name}`);

  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  /** 제 줄 하나 — 오늘 마감(「오늘 할 일」에 선다) · 진행률 70 · 담당은 그 사람 */
  const mk = async (title, who) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date, progress,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $3, 'todo', $4::date, $5, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, area, who, today, START]))[0].id;
  const db = async (id) => (await sql(`SELECT status, progress FROM task WHERE id = $1`, [id]))[0];
  const dbWait = async (id, want, ms = 6000) => {
    const t0 = Date.now(); let v;
    while (Date.now() - t0 < ms) { v = await db(id); if (v.status === want) return v; await sleep(150); }
    return v;
  };

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const errs = [];
  /**
   * 한 판 — 그 사람으로 대시보드를 열고, 제 줄을 체크하고, 되돌리기를 누른다.
   * `tamper` 로 요청을 일부러 깬다(§A-11).
   */
  const round = async (who, id, tamper = null) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: tok(who) }]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource.*500/.test(m.text())) errs.push(m.text().slice(0, 140)); });
    if (tamper === "strip") {
      // ① 되돌리기 요청에서 진행률을 빼 보낸다 — 070 판이 보내던 모양
      await page.route("**/api/tasks/*", async (r) => {
        const b = r.request().postData();
        if (r.request().method() === "PATCH" && b && /"progress"/.test(b)) {
          const o = JSON.parse(b); delete o.progress;
          await r.continue({ postData: JSON.stringify(o) });
        } else await r.continue();
      });
    }
    if (tamper === "noeditor") {
      // ② 편집자 번호를 못 받게 한다 — 화면은 권한을 모르면 없는 것으로 본다
      await page.route("**/api/meta/selectors", (r) => r.fulfill({ status: 500, body: "{}" }));
    }
    await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    const row = page.locator("section.v3-card").filter({ has: page.locator("h2", { hasText: /^오늘 할 일$/ }) })
      .locator(`[data-live-row="${id}"]`).first();
    await row.waitFor({ timeout: 15000 });
    await row.locator(".v3-cb").click();
    const done = await dbWait(id, "done");
    await page.locator(".v3-toast button", { hasText: "되돌리기" }).last().click();
    const back = await dbWait(id, "todo");
    await sleep(400);
    const toastTxt = (await page.locator(".v3-toast").last().innerText().catch(() => "")).replace(/\s+/g, " ");
    const rowProgress = await row.evaluate((el) => el.getAttribute("data-live-row")).catch(() => null);
    await ctx.close();
    return { done, back, toastTxt, rowProgress };
  };

  // ── A-7 권한 있는 사람 ───────────────────────────────────────────
  const t1 = await mk(`${MARK} 편집자 줄`, EDITOR.id);
  const r1 = await round(EDITOR, t1);
  chk("A-7-권한-있으면-둘-다-되돌린다",
      r1.done.status === "done" && r1.done.progress === 100 && r1.back.status === "todo" && r1.back.progress === START
      && !r1.toastTxt.includes(PROGRESS_KEPT_LINE),
      `체크 → ${r1.done.status}·${r1.done.progress} → 되돌리기 → ${r1.back.status}·${r1.back.progress} (원래 ${START}) · 토스트 "${r1.toastTxt}"`);

  // ── A-6 권한 없는 사람 ──────────────────────────────────────────
  const t2 = await mk(`${MARK} 팀원 줄`, OTHER.id);
  const r2 = await round(OTHER, t2);
  chk("A-6-권한-없으면-상태만·말한다",
      r2.done.status === "done" && r2.back.status === "todo" && r2.back.progress === 100
      && r2.toastTxt.includes(PROGRESS_KEPT_LINE),
      `체크 → ${r2.done.status}·${r2.done.progress} → 되돌리기 → ${r2.back.status}·${r2.back.progress}(그대로) · 토스트 "${r2.toastTxt}"`);

  // ── A-11 일부러 깬다 — 위 A-7 단언이 빨개지는가 ──────────────────
  const ok7 = (r) => r.back.status === "todo" && r.back.progress === START;
  const t3 = await mk(`${MARK} 깨기 ① 진행률 빼기`, EDITOR.id);
  const b1 = await round(EDITOR, t3, "strip");
  const t4 = await mk(`${MARK} 깨기 ② 편집자 모름`, EDITOR.id);
  const b2 = await round(EDITOR, t4, "noeditor");
  chk("A-11-깨면-빨개진다(둘)", !ok7(b1) && !ok7(b2) && b2.toastTxt.includes(PROGRESS_KEPT_LINE),
      `① 진행률을 빼고 보냄 → ${b1.back.status}·${b1.back.progress}(A-7 은 ${START} 을 요구 → 빨강) · ` +
      `② 편집자를 못 받음 → ${b2.back.status}·${b2.back.progress} · 토스트가 「그대로」를 말함 ${b2.toastTxt.includes(PROGRESS_KEPT_LINE)}`);

  chk("콘솔-오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""} (일부러 만든 500 은 뺐다)`);
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]).catch((e) => console.error("업무 정리 실패", e.message));
  // 072 §G — 사람 업무가 시작 전과 다르면 되돌리고 빨강. 이 회차가 남긴 기록도 지운다
  if (realBefore) {
    try {
      const now = await pool.query(`SELECT id, status, completed_at::text c, resolution, progress FROM task WHERE title NOT LIKE $1`, [`${MARK}%`]);
      const moved = now.rows.filter((r) => realBefore.has(r.id) && realBefore.get(r.id) !== JSON.stringify([r.status, r.c, r.resolution, r.progress]));
      for (const r of moved) {
        const [st, c, res, pr] = JSON.parse(realBefore.get(r.id));
        await pool.query(`UPDATE task SET status = $2, completed_at = $3::timestamptz, resolution = $4, progress = $5 WHERE id = $1`, [r.id, st, c, res, pr]);
      }
      // 074 §C — 지우는 것은 **이 검사기가 바꿨다가 되돌린 사람 업무**의 이번 판 기록뿐이다.
      // 그 밖의 기록은 사람이 남긴 것일 수 있어 **안 지운다**(고를 수 없으면 안 지운다)
      const logs = await pool.query(`DELETE FROM activity_log WHERE id > $1 AND task_id = ANY($2::int[]) RETURNING id`,
        [logMark, moved.map((r) => r.id)]);
      console.log(`남의 업무 확인 — 시작 전과 다른 것 ${moved.length}건${moved.length ? ` **[${moved.map((r) => `#${r.id}`).join(",")}] 되돌렸다**` : ""} · 이 회차의 활동 기록 ${logs.rowCount}줄 지움`);
      if (moved.length) process.exitCode = 1;
    } catch (e) { console.error("남의 업무 확인 실패 —", e.message); process.exitCode = 1; }
  }
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`UPDATE config SET value = $2::jsonb WHERE key = $1`, [KEY, JSON.stringify(swBefore)]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const ok = JSON.stringify(now === undefined ? null : now.value) === JSON.stringify(swBefore) && left === 0;
    console.log(`뒷정리 확인 — 스위치 ${now === undefined ? "(행 없음)" : JSON.stringify(now.value)} · ${MARK} 업무 ${left}건${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
  } catch (e) { console.error("뒷정리 실패 —", e.message); process.exitCode = 1; }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
