// 목표 연결 후보의 **층**을 실측한다 (MD-P-2026-031 §C3 §1-2).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 무엇을 보는가.
//   §1A 분기 목표가 후보에 **있다** — 월만 나오던 것을 넓혔다
//   §1B 월 목표도 그대로 있다 (§1C 부재 단언의 **짝**)
//   §1C 연간 목표가 후보에 **없다** — 짝으로 "그 연간 목표가 DB 에 살아 있다"를 함께 잰다.
//       짝이 없으면 목록이 통째로 비어도 이 줄은 통과한다 (§G 「부재 단언에는 짝을 붙인다」).
//   §1D 기간 필터가 없다 — **지난 분기** 목표가 후보에 남고 `지난 기간` 이라고 적힌다
//   §1E 아직 오지 않은 기간에 「지난 기간」이라고 적히지 않는다
//       (처음엔 문구만 옮기는 줄이었다. 옮긴 문구가 `지난 기간 · 2026-10` 이어서 판정으로 올렸다)
//   §1F 연결하면 목표 진척이 재계산된다 — before/after 수치
//   §1G 지난 기간 목표에 연결하면 값이 어떻게 되는가 — before/after 수치
//
// 이 스크립트가 만든 것만 지운다. 시드 데이터는 건드리지 않는다.
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("goal-link-level-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(10)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(10)} ${n}`); };
const note = (id, n) => { rows.push({ id, pass: null, n }); console.log(`측정 ${id.padEnd(10)} ${n}`); };

let browser, madeGoalId = null, madeTaskId = null;
try {
  const lead = await one(`SELECT id, display_name, email FROM actor a JOIN account c ON c.actor_id = a.id
                           WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 1`);
  if (!lead) throw new Error("사람 계정이 없다 — 시드부터 하라");

  const yearGoal = await one(`SELECT id, title FROM goal WHERE period_type='year' AND is_active ORDER BY id LIMIT 1`);
  const qGoal = await one(`SELECT id, title FROM goal WHERE period_type='quarter' AND is_active
                            AND period_start <= current_date AND period_end >= current_date ORDER BY id LIMIT 1`);
  const mGoal = await one(`SELECT id, title FROM goal WHERE period_type='month' AND is_active ORDER BY id LIMIT 1`);
  const futureQ = await one(`SELECT id, title FROM goal WHERE period_type='quarter' AND is_active
                              AND period_start > current_date ORDER BY id LIMIT 1`);

  // 지난 분기 목표 — 시드에 없어서 여기서 만든다. 끝나면 지운다.
  const pastQ = await one(
    `INSERT INTO goal (period_type, period_start, period_end, title, progress_mode, progress, owner_actor_id, is_demo)
     VALUES ('quarter', date_trunc('quarter', current_date) - interval '3 months',
             date_trunc('quarter', current_date) - interval '1 day',
             '[검사] 지난 분기 목표', 'auto', 0, $1, true) RETURNING id, title`, [lead.id]);
  madeGoalId = pastQ.id;

  // 연결할 업무 — 아직 어떤 목표에도 안 붙은, 진척이 있는 것 하나를 새로 만든다.
  const t = await one(
    `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, is_demo)
     VALUES ('[검사] 목표 연결 층 확인용', 'doing', 40, $1, $1, 'team',
             (SELECT id FROM area WHERE is_active AND kind='workspace' ORDER BY sort_order, id LIMIT 1), true)
     RETURNING id, progress`, [lead.id]);
  madeTaskId = t.id;

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();

  // ── 후보 목록을 화면에서 읽는다 (API 가 아니라 눌러서 열리는 그 목록) ──
  await page.goto(`${BASE}/tasks?panel=task:${madeTaskId}`, { waitUntil: "networkidle" });
  // 첫 화면 안내(FirstRun)가 떠 있으면 `.frn-bg` 가 클릭을 통째로 먹는다.
  // 시드 직후 계정에는 반드시 뜬다 — 안 걷어내면 아래 클릭이 전부 30초 타임아웃이다.
  const frn = page.locator(".frn-skip");
  if (await frn.count()) { await frn.first().click(); await page.locator(".frn-bg").waitFor({ state: "detached", timeout: 5000 }); }
  await page.waitForSelector(".prop .prop-row", { timeout: 10000 });
  // 속성이 접혀 있으면 "목표" 행 자체가 DOM 에 없다 — 먼저 펼친다 (§G 「보인다는 것은 눌린다는 것이다」).
  const more = page.locator(".prop-more", { hasText: "속성 더보기" });
  if (await more.count()) await more.first().click();
  // 라벨이 **정확히** "목표"인 행을 index 로 집는다. hasText: "목표" 로 거르면
  // "목표 없음"·"＋ 목표 연결" 이 든 행까지 걸리고, 그러면 엉뚱한 행을 누르고도 조용히 통과한다.
  const labels = await page.$$eval(".prop .prop-row .prop-l", (ls) => ls.map((l) => l.textContent.trim()));
  const gi = labels.indexOf("목표");
  console.log(`   속성 행 ${labels.length}개: ${labels.join(" / ")} → 「목표」 index ${gi}`);
  if (gi < 0) throw new Error(`속성에 「목표」 행이 없다 — 있는 행: ${labels.join("/") || "(없음)"}`);
  await page.locator(".prop .prop-row").nth(gi).locator("button.prop-v").click();
  await page.waitForSelector(".prop-goals", { timeout: 5000 });

  const opts = await page.$$eval(".prop-goals label:not(.prop-gnone)", (ls) => ls.map((l) => ({
    lv: l.querySelector(".gopt-lv")?.textContent?.trim() ?? "",
    period: l.querySelector("em")?.textContent?.trim() ?? "",
    off: !!l.querySelector(".gopt-off"),   // 지금 기간이 아님 (지난 것 · 아직 안 온 것 둘 다)
    text: l.textContent.trim().replace(/\s+/g, " "),
  })));
  const emptyMsg = await page.$$eval(".prop-goals .prop-none", (ps) => ps.map((p) => p.textContent.trim()));

  if (opts.length === 0) bad("§1-표본", `후보가 0개다 — 아래 판정은 전부 무의미하다. 안내: ${emptyMsg.join("|") || "없음"}`);
  else note("§1-표본", `후보 ${opts.length}개 · 분기 ${opts.filter((o) => o.lv === "분기").length} · 월 ${opts.filter((o) => o.lv === "월").length}`);

  const has = (title) => opts.some((o) => o.text.includes(title));

  // §1A 분기가 있다
  qGoal && (has(qGoal.title)
    ? ok("§1A", `분기 목표가 후보에 있다 — "${qGoal.title}"`)
    : bad("§1A", `분기 목표가 후보에 없다 — "${qGoal.title}"`));

  // §1B 월도 있다 (§1C 의 짝)
  mGoal && (has(mGoal.title)
    ? ok("§1B", `월 목표도 그대로 있다 — "${mGoal.title}"`)
    : bad("§1B", `월 목표가 사라졌다 — "${mGoal.title}"`));

  // §1C 연간은 없다 + 짝
  if (yearGoal) {
    const alive = await one(`SELECT id FROM goal WHERE id=$1 AND is_active`, [yearGoal.id]);
    if (!alive) bad("§1C", `짝이 깨졌다 — 연간 목표 #${yearGoal.id} 가 DB 에서 죽어 있다. 부재를 근거로 쓸 수 없다`);
    else if (has(yearGoal.title)) bad("§1C", `연간 목표가 후보에 있다 — "${yearGoal.title}"`);
    else ok("§1C", `연간 목표는 후보에 없다 — "${yearGoal.title}" (짝: DB 에 살아 있음 #${yearGoal.id}, 분기·월은 §1A·§1B 로 확인)`);
  } else bad("§1C", "연간 목표가 시드에 없다 — 부재 단언을 세울 수 없다");

  // §1D 지난 분기가 남고, 지난 기간이라고 적힌다
  const pastOpt = opts.find((o) => o.text.includes(pastQ.title));
  if (!pastOpt) bad("§1D", `지난 분기 목표가 후보에서 걸러졌다 — "${pastQ.title}" (소급 연결 경로 없음)`);
  else if (!pastOpt.off) bad("§1D", `지난 분기 목표가 후보에 있으나 표시가 없다 — 적힌 것: "${pastOpt.period}"`);
  else ok("§1D", `지난 분기 목표가 후보에 남고 회색으로 적힌다 — "${pastOpt.period}"`);

  // §1E 미래 기간에 「지난 기간」이라고 적히면 안 된다.
  // 처음 이 줄은 문구를 옮기기만 했고, 옮긴 문구가 `지난 기간 · 2026-10` 이었다 — 그래서 판정으로 올렸다.
  if (futureQ) {
    const fOpt = opts.find((o) => o.text.includes(futureQ.title));
    if (!fOpt) bad("§1E", `미래 분기 "${futureQ.title}" 가 후보에서 사라졌다`);
    else if (fOpt.period.includes("지난 기간"))
      bad("§1E", `아직 오지 않은 분기에 「지난 기간」이라고 적힌다 — "${futureQ.title}" → "${fOpt.period}"`);
    else ok("§1E", `미래 분기는 지난 것과 다르게 적힌다 — "${futureQ.title}" → "${fOpt.period}"`);
  } else bad("§1E", "미래 기간 목표가 시드에 없다 — 이 줄을 세울 수 없다");

  // ── 진척 재계산 ──
  //
  // 필드 이름을 짐작하지 않는다. `/api/goals/:id` 는 `{ goal: { progress, progressAuto, countedTasks } }`
  // 를 준다. 앞서 `taskCount` 로 읽었더니 늘 `null` 이었고, 그러면 **아무것도 안 변한 것처럼 보인다.**
  const prog = async (id) => {
    const r = await page.request.get(`${BASE}/api/goals/${id}`);
    if (!r.ok()) return { http: r.status(), progress: null, auto: null, counted: null };
    const g = (await r.json()).goal;
    return { http: 200, progress: g.progress, auto: g.progressAuto, counted: g.countedTasks };
  };
  const link = (goalIds) => page.request.patch(`${BASE}/api/tasks/${madeTaskId}`, { data: { goalIds } });
  const fmt = (v) => `진척 ${v.progress === null ? "—" : v.progress + "%"}(auto ${v.auto === null ? "—" : v.auto}) · 집계 ${v.counted}건`;

  // 시드는 goal.progress 를 0 으로 **박아 넣는다** — 한 번도 재계산된 적이 없는 값이다.
  // 그 0 을 before 로 쓰면 "연결이 값을 움직였다"와 "처음으로 계산됐다"가 섞인다.
  // 그래서 **연결한 상태와 연결을 뗀 상태**를 잰다. 둘 다 같은 재계산 경로를 지난 값이다.
  if (qGoal) {
    const r1 = await link([qGoal.id]);
    const withLink = await prog(qGoal.id);
    const r2 = await link([]);
    const without = await prog(qGoal.id);
    if (!r1.ok() || !r2.ok()) bad("§1F", `연결 PATCH 실패 HTTP ${r1.status()}/${r2.status()}`);
    else if (withLink.counted === without.counted && withLink.progress === without.progress)
      bad("§1F", `연결해도 값이 그대로다 — "${qGoal.title}" ${fmt(without)}`);
    else ok("§1F", `"${qGoal.title}" 연결 없음 ${fmt(without)} → 연결 후 ${fmt(withLink)} (붙인 업무: 진행 40% 1건)`);
  }

  // §1G 지난 기간 목표에 연결 — 값이 어떻게 되는가
  {
    const before = await prog(pastQ.id);
    const res = await link([pastQ.id]);
    const after = await prog(pastQ.id);
    if (!res.ok()) bad("§1G", `지난 기간 목표 연결 PATCH 실패 HTTP ${res.status()}`);
    else if (after.http !== 200) bad("§1G", `연결 후 목표를 읽을 수 없다 HTTP ${after.http}`);
    else if (after.counted === before.counted)
      bad("§1G", `지난 기간 목표는 연결해도 집계에 안 들어간다 — 집계 ${before.counted}건 그대로 (소급 연결이 무의미해진다)`);
    else ok("§1G", `지난 분기 목표 ${fmt(before)} → ${fmt(after)} — 거부되지 않고 **소급 집계된다**`);
  }
} catch (e) {
  // 3 줄로 자르지 않는다 — Playwright 의 실패 이유(가려짐·안 보임·못 찾음)는
  // 첫 줄이 아니라 call log 뒤쪽에 있다. 잘라 놓으면 "찾지 못했다"로만 읽힌다.
  console.log(String(e && e.stack ? e.stack : e));
  bad("예외", String(e && e.message ? e.message.split("\n")[0] : e));
} finally {
  // 정리는 실패해도 검사를 죽이지 않는다. 다만 **조용히 넘기지 않는다** —
  // 잔여물이 남은 채로 통과하면 다음 회차가 그 잔여물을 실측값으로 읽는다
  // (first-run-walk 의 actor 누수가 정확히 그랬다).
  const tidy = async (label, text, params) => {
    try { await sql(text, params); }
    catch (e) { console.log(`   정리 실패 ${label}: ${String(e && e.message ? e.message : e)} — 손으로 지워야 한다`); }
  };
  if (browser) { try { await browser.close(); } catch (e) { console.log(`   브라우저 종료 실패: ${e}`); } }
  // 만든 것만 지운다.
  if (madeTaskId) {
    await tidy("goal_task(task)", `DELETE FROM goal_task WHERE task_id=$1`, [madeTaskId]);
    await tidy("activity_log", `DELETE FROM activity_log WHERE task_id=$1`, [madeTaskId]);
    await tidy("task", `DELETE FROM task WHERE id=$1`, [madeTaskId]);
  }
  if (madeGoalId) {
    await tidy("goal_task(goal)", `DELETE FROM goal_task WHERE goal_id=$1`, [madeGoalId]);
    await tidy("goal", `DELETE FROM goal WHERE id=$1`, [madeGoalId]);
  }
  try { await pool.end(); } catch { /* 이미 닫혔다 — 종료 경로라 더 할 일이 없다 */ }
  const f = rows.filter((r) => r.pass === false).length;
  const p = rows.filter((r) => r.pass === true).length;
  console.log(`\n결과 ${p}/${p + f} 통과 · 측정 ${rows.filter((r) => r.pass === null).length}건`);
  // 「결과줄 0이면 미측정」 가드 — 아무 줄도 없으면 서버가 죽은 것이다.
  if (rows.length === 0) { console.error("측정된 줄이 0건이다 — 서버가 떠 있는지 확인하라"); process.exit(2); }
  process.exit(f ? 1 : 0);
}
