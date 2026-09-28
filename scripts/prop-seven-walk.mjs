// v3 상세의 속성 일곱 + 새 업무의 셋 실측 (MD-P-2026-066 §E).
//
//   node scripts/prop-seven-walk.mjs
//
// 지시서의 검사 셋과 그 조건들:
//   §E-46  일곱이 다 보이고 **각각 저장하고 다시 열었을 때 남아 있는 것**
//          — 보이기만 하고 안 저장되는 칸이 없게 한다
//   §E-47  영역 밖 프로젝트가 **상세·새 업무 둘 다에서** 안 보이는 것 (+ 짝 단언)
//   §E-43  영역을 바꾸면 프로젝트를 비우고 **한 줄 안내**
//   §E-44  서버가 어긋난 조합을 받으면 **400**, 제약 이름을 내보내지 않는다
//   §E-40  새 업무에 프로젝트 · 목표 · 우선순위 — **필수는 여전히 둘**(§E-41)
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";
import { testUser } from "./test-user.mjs";
import { peopleSnapshot, peopleDiff } from "./people-guard.mjs";   // 076 §A — 사람 줄 대조

requireLocalDb("prop-seven-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HOST = new URL(BASE).hostname;
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[066검사]";
const ME = await testUser("admin");

/** 속성 줄의 값 글자. 줄은 `data-k` 로 찾는다 — 이름표 글자에 기대지 않는다. */
const propValue = async (page, label) => {
  const row = page.locator(`.v3-prop[data-k="${label}"]`).first();
  if (!(await row.count())) return null;
  return (await row.locator(".v3-prop-v").first().textContent() ?? "").trim();
};

let browser, swBefore = null, made = [], beforeCount = null, ownGoal = null, guard = null;
try {
  guard = await peopleSnapshot(pool);
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  /*
   * ── 조건 ────────────────────────────────────────────────────────
   * 프로젝트를 가진 영역 **둘**이 필요하다. 하나뿐이면 「영역 밖 프로젝트」를
   * 만들 수 없고, 그러면 §E-47 은 아무것도 안 잰 값이 된다(§G 053).
   */
  const areas = await sql(
    `SELECT a.id, a.name, count(p.id)::int projects
       FROM area a LEFT JOIN project p ON p.area_id = a.id AND p.is_active
      WHERE a.is_active GROUP BY a.id, a.name, a.sort_order
      HAVING count(p.id) > 0 ORDER BY a.sort_order, a.id`);
  chk("0조건-프로젝트-가진-영역-둘", areas.length >= 2,
      `${areas.map((a) => `${a.name}(${a.projects})`).join(" · ")} — 둘 이상이라야 §E-47 이 뜻을 가진다`);
  const A = areas[0], B = areas[1];
  const aProjects = await sql(`SELECT id, name FROM project WHERE area_id = $1 AND is_active ORDER BY id`, [A.id]);
  const bProjects = await sql(`SELECT id, name FROM project WHERE area_id = $1 AND is_active ORDER BY id`, [B.id]);

  const mk = async (title, areaId) => (await sql(
    `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id, priority)
     VALUES ($1, 'doing', $2::date, $3, 'team', 'team', $4, $4, 'mid') RETURNING id`,
    [`${MARK} ${title}`, today, areaId, ME.id]))[0].id;
  const subject = await mk("속성 일곱", A.id);
  const parent = await mk("상위가 될 업무", A.id);
  made = [subject, parent];
  // 076 §A — ② 목표 줄이 걸 **제 월 목표**. 화면이 후보를 열 때 읽으므로 먼저 만든다
  ownGoal = (await sql(
    `INSERT INTO goal (period_type, period_start, period_end, title, progress_mode, progress, owner_actor_id, is_demo)
     VALUES ('month', date_trunc('month', $1::date), date_trunc('month', $1::date) + interval '1 month' - interval '1 day',
             $2, 'auto', 0, $3, true) RETURNING id, title`, [today, `${MARK} 제 월 목표`, ME.id]))[0];
  console.log(`   (조건) 주인공 #${subject} · 상위감 #${parent} · 영역 A="${A.name}"(${A.id}) B="${B.name}"(${B.id})`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1800 } });
  await ctx.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(ME) }]);
  const page = await ctx.newPage();
  /*
   * 065 §A-1 — **이 검사기가 스스로 만든 400 은 따로 센다.**
   *
   * ⑦ 은 「어긋난 조합을 서버가 거절하는가」를 보려고 **일부러** 안 맞는 조합을
   * 보낸다. 서버의 400 이 그 검사의 **정답**이고, 그때 브라우저가 적는
   * 「Failed to load resource … 400」은 고장이 아니다.
   *
   * **무시 목록(console-ignore)에는 안 넣는다** — 그 파일의 규칙이 그렇다.
   * 넣으면 다른 검사기에서 난 **진짜 400** 까지 같이 눈감는다.
   * saved-view-walk 의 404 와 같은 방법이다.
   */
  const wanted = [];
  const errs = [];
  const take = (t) => {
    if (/Failed to load resource.*\b400\b/.test(t)) { wanted.push(t); return; }
    errs.push(t);
  };
  page.on("pageerror", (e) => take(e.message));
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    if (!ignoredWhy(line)) take(line); });

  const openDetail = async (id = subject) => {
    await page.goto(`${BASE}/v3/tasks/${id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
  };
  await openDetail();

  // ── ① 일곱이 다 보인다 (§E-37) ─────────────────────────────────
  const SEVEN = ["영역", "프로젝트", "목표", "상위 업무", "하위 업무", "우선순위", "기간"];
  const labels = await page.locator(".v3-prop").evaluateAll((els) => els.map((e) => e.getAttribute("data-k")));
  const missing = SEVEN.filter((k) => !labels.includes(k));
  chk("①-속성-일곱이-보인다", missing.length === 0,
      `${labels.join(" · ")}${missing.length ? ` — 빠진 것 ${missing.join(",")}` : ""}`);

  // 안 넣은 셋이 **없는 것도** 확인한다 (§E-38). 넣었으면 그게 결함이다.
  const NOT_YET = ["차단", "이 업무가 막는 업무", "공개 범위"];
  const sneaked = NOT_YET.filter((k) => labels.includes(k));
  chk("①짝-안-넣은-셋은-없다", sneaked.length === 0,
      `차단 · 막는 업무 · 공개 범위 — ${sneaked.length === 0 ? "없다 (가오픈 뒤다)" : `**있다: ${sneaked.join(",")}**`}`);

  /** 한 칸을 고치고 **다시 열어** DB 와 화면을 함께 본다 (§E-46). */
  const saveAndReopen = async (id, label, act, dbCheck) => {
    await page.locator(`.v3-prop[data-k="${label}"] .v3-prop-v, .v3-prop[data-k="${label}"] .v3-prop-edit`)
              .first().click();
    await page.waitForTimeout(300);
    await act();
    await page.waitForTimeout(900);
    await openDetail(id);
    const shown = await propValue(page, label);
    const db = await dbCheck();
    chk(`②-${label.replace(/ /g, "-")}-가-남는다`, db.ok, `${db.note} · 화면 "${String(shown).slice(0, 40)}"`);
  };

  // ── ② 일곱을 하나씩 고치고 다시 열어 본다 (§E-46) ───────────────
  // 우선순위
  await saveAndReopen(subject, "우선순위",
    () => page.locator(".v3-prop-ed .v3-ichip", { hasText: "높음" }).first().click(),
    async () => { const p = (await sql(`SELECT priority FROM task WHERE id=$1`, [subject]))[0].priority;
      return { ok: p === "high", note: `DB priority=${p}` }; });

  // 기간(시작일)
  const startWanted = today;
  await saveAndReopen(subject, "기간",
    () => page.locator("#v3-d-st").fill(startWanted),
    async () => { const d = (await sql(`SELECT start_date::text s FROM task WHERE id=$1`, [subject]))[0].s;
      return { ok: d === startWanted, note: `DB start_date=${d}` }; });

  // 프로젝트 — **그 영역의 것만** 나온다
  await saveAndReopen(subject, "프로젝트",
    () => page.locator("#v3-d-pj").selectOption(String(aProjects[0].id)),
    async () => { const p = (await sql(`SELECT project_id FROM task WHERE id=$1`, [subject]))[0].project_id;
      return { ok: p === aProjects[0].id, note: `DB project_id=${p} (고른 것 ${aProjects[0].id} "${aProjects[0].name}")` }; });

  // 목표 — 076 §A: **제 월 목표**의 칩을 누른다. 075 까지는 첫 칩(사람의 목표)을 눌러 제 업무를
  // 걸었고, 그 목표의 저장된 진척이 다시 계산된 뒤 연결만 SQL 로 떼여 틀린 값으로 남았다.
  // 부모를 안 달아 재계산이 사람의 분기 · 연간 목표로 올라가지 않게 한다.
  await saveAndReopen(subject, "목표",
    () => page.locator(".v3-prop-ed .v3-ichip", { hasText: ownGoal.title }).first().click(),
    async () => { const ids = (await sql(`SELECT goal_id FROM goal_task WHERE task_id=$1`, [subject])).map((r) => r.goal_id);
      return { ok: ids.length === 1 && ids[0] === ownGoal.id, note: `DB goal_task [${ids.join(",")}] (제 목표 #${ownGoal.id})` }; });

  // 상위 업무 — 그리고 그 뒤 **상위 쪽 「하위 업무」**가 주인공을 담는다
  await saveAndReopen(subject, "상위 업무",
    () => page.locator("#v3-d-pa").selectOption(String(parent)),
    async () => { const p = (await sql(`SELECT parent_task_id FROM task WHERE id=$1`, [subject]))[0].parent_task_id;
      return { ok: p === parent, note: `DB parent_task_id=${p} (고른 것 ${parent})` }; });

  await openDetail(parent);
  const kidsShown = await propValue(page, "하위 업무");
  chk("②-하위-업무-가-남는다", (kidsShown ?? "").includes("속성 일곱"),
      `상위 #${parent} 의 하위 줄 "${String(kidsShown).slice(0, 44)}" — 상위를 정하는 쪽에서 만들어진다`);

  // 영역 — **마지막에 바꾼다**(프로젝트를 비우므로). §E-43 의 한 줄도 여기서 본다
  await openDetail(subject);
  /*
   * 상위가 붙은 동안은 영역·프로젝트를 상위에서 물려받는다(§A2). 영역을 바꾸는
   * 것을 재려면 먼저 상위를 뗀다 — 안 떼면 서버가 상위 값으로 덮어써서
   * 「저장이 안 됐다」로 잘못 읽힌다.
   */
  await page.locator('.v3-prop[data-k="상위 업무"] .v3-prop-edit').first().click();
  await page.waitForTimeout(300);
  await page.locator("#v3-d-pa").selectOption("");
  await page.waitForTimeout(900);
  await openDetail(subject);

  /*
   * §E-43 을 재려면 **바꾸기 전에 프로젝트가 있어야 한다.** 처음엔 없이 쟀고,
   * 그래서 「비울 것이 없어서 안 알린」 화면을 「안 알린다」로 읽었다 —
   * 조건을 안 만들고 결과를 읽은 것이다(§G 053).
   */
  await page.locator('.v3-prop[data-k="프로젝트"] .v3-prop-v').first().click();
  await page.waitForTimeout(300);
  await page.locator("#v3-d-pj").selectOption(String(aProjects[0].id));
  await page.waitForTimeout(900);
  await openDetail(subject);
  const beforeArea = (await sql(`SELECT project_id FROM task WHERE id=$1`, [subject]))[0].project_id;
  chk("③조건-바꾸기-전에-프로젝트가-있다", beforeArea === aProjects[0].id,
      `DB project_id=${beforeArea} — 없으면 §E-43 은 아무것도 안 잰 값이다`);

  await page.locator('.v3-prop[data-k="영역"] .v3-prop-v').first().click();
  await page.waitForTimeout(300);
  await page.locator("#v3-d-area").selectOption(String(B.id));
  await page.waitForTimeout(1000);
  const clearedNote = await page.locator(".v3-why", { hasText: "영역을 바꿨으니" }).count();
  const after = (await sql(`SELECT area_id, project_id FROM task WHERE id=$1`, [subject]))[0];
  chk("②-영역-이-남는다", after.area_id === B.id,
      `DB area_id=${after.area_id} (고른 것 ${B.id} "${B.name}")`);
  chk("③-영역-바꾸면-프로젝트-비우고-알린다",
      after.project_id === null && clearedNote > 0,
      `DB project_id=${after.project_id} · 안내 줄 ${clearedNote}개 (§E-43)`);

  // ── ④ 영역 밖 프로젝트가 안 보인다 — **상세** (§E-47) ───────────
  await openDetail(subject);   // 지금 영역은 B
  await page.locator('.v3-prop[data-k="프로젝트"] .v3-prop-v').first().click();
  await page.waitForTimeout(400);
  const dOpts = await page.locator("#v3-d-pj option").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  const aNames = aProjects.map((p) => p.name), bNames = bProjects.map((p) => p.name);
  const dOut = aNames.filter((n) => dOpts.includes(n));
  const dIn = bNames.filter((n) => dOpts.includes(n));
  chk("④-상세-에-영역-밖-프로젝트-0개", dOut.length === 0,
      `영역 "${B.name}" 에서 고를 수 있는 것 [${dOpts.join(", ")}] · 밖의 것 [${dOut.join(", ")}]`);
  chk("④짝-상세-에-영역-안-것은-보인다", dIn.length === bNames.length && bNames.length > 0,
      `영역 안 ${bNames.length}개 중 ${dIn.length}개 보인다 — 0이면 위 줄이 뜻을 잃는다`);

  // ── ⑤ 영역 밖 프로젝트가 안 보인다 — **새 업무** (§E-47) ────────
  await page.goto(`${BASE}/v3/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  await page.locator(".v3-catbtn", { hasText: new RegExp(`^${B.name}$`) }).first().click();
  await page.locator(".v3-ichip", { hasText: "프로젝트" }).first().click();
  await page.waitForTimeout(400);
  const nOpts = await page.locator("#v3-pj option").evaluateAll((els) => els.map((e) => e.textContent.trim()));
  const nOut = aNames.filter((n) => nOpts.includes(n));
  chk("⑤-새-업무-에-영역-밖-프로젝트-0개", nOut.length === 0 && nOpts.length > 1,
      `고를 수 있는 것 [${nOpts.join(", ")}] · 밖의 것 [${nOut.join(", ")}]`);
  // 영역을 A 로 바꾸면 **비우고 알린다** (§E-43) — 새 업무 쪽도 같은 규칙이다
  await page.locator("#v3-pj").selectOption(String(bProjects[0].id));
  await page.waitForTimeout(200);
  await page.locator(".v3-catbtn", { hasText: new RegExp(`^${A.name}$`) }).first().click();
  await page.waitForTimeout(400);
  const nCleared = await page.locator(".v3-why", { hasText: "영역을 바꿨으니" }).count();
  const nChip = (await page.locator(".v3-ichip", { hasText: "프로젝트" }).first().textContent()) ?? "";
  chk("⑤짝-새-업무-도-비우고-알린다", nCleared > 0 && nChip.includes("＋"),
      `안내 줄 ${nCleared}개 · 칩 "${nChip.trim()}" (비었으면 ＋ 로 돌아온다)`);

  // ── ⑥ 새 업무에 셋이 있고, 필수는 여전히 둘 (§E-40 · §E-41) ─────
  const chipTexts = await page.locator(".v3-ichip").allTextContents();
  const hasThree = ["프로젝트", "목표", "우선순위"].every((k) => chipTexts.some((t) => t.includes(k)));
  const saveBtn = page.locator(".v3-newfoot button").first();
  await page.locator(".v3-title-in").fill(`${MARK} 셋을 안 골라도 저장`);
  await page.waitForTimeout(200);
  const canSave = !(await saveBtn.isDisabled());
  chk("⑥-새-업무-에-셋이-있다-·-필수는-둘", hasThree && canSave,
      `칩 [${chipTexts.map((t) => t.trim()).join(" · ")}] · 제목+영역만으로 저장 ${canSave ? "된다" : "**안 된다**"}`);

  // ── ⑦ 서버는 어긋난 조합을 400 으로 거절한다 (§E-44) ────────────
  const bad = await page.evaluate(async ({ id, projectId }) => {
    const r = await fetch(`/api/tasks/${id}`, { method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }) });
    return { status: r.status, body: await r.text() };
  }, { id: subject, projectId: aProjects[0].id });   // 주인공은 영역 B, 프로젝트는 A 것
  const leaksName = /trg_task_area_match|area_id|project\.area|EXCEPTION/i.test(bad.body);
  chk("⑦-어긋난-조합은-400", bad.status === 400 && !leaksName,
      `${bad.status} · ${bad.body.slice(0, 96)}${leaksName ? " — **제약 이름이 샌다**" : ""}`);
  const stillNull = (await sql(`SELECT project_id FROM task WHERE id=$1`, [subject]))[0].project_id;
  chk("⑦짝-거절되면-안-바뀐다", stillNull === null, `DB project_id=${stillNull}`);

  chk("콘솔짝-우리가-만든-400", wanted.length > 0,
      `일부러 만든 400 ${wanted.length}건 (1건 이상이라야 ⑦ 이 실제로 돌았다는 뜻이다)`);
  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
} catch (e) {
  fail += 1;
  console.error("\n넘어졌다 —", e.stack ?? e.message);
} finally {
  if (browser) await browser.close();
  for (const id of made) {
    await pool.query(`DELETE FROM goal_task WHERE task_id = $1`, [id]).catch(() => {});
  }
  // 하위가 남아 있으면 부모가 안 지워진다 — 주인공부터 떼고 지운다.
  for (const id of made) await pool.query(`UPDATE task SET parent_task_id = NULL WHERE id = $1`, [id]).catch(() => {});
  for (const id of made) await pool.query(`DELETE FROM activity_log WHERE task_id = $1`, [id]).catch(() => {});
  for (const id of made) await pool.query(`DELETE FROM task WHERE id = $1`, [id]).catch(() => {});
  if (ownGoal) {
    await pool.query(`DELETE FROM goal_task WHERE goal_id = $1`, [ownGoal.id]).catch(() => {});
    await pool.query(`DELETE FROM goal WHERE id = $1`, [ownGoal.id]).catch(() => {});
  }
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const ok = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
    if (guard) {
      const diff = await peopleDiff(pool, guard).catch((e) => [`대조 실패 — ${e.message}`]);
      console.log(`사람 줄 대조 — 시작 전과 다른 것 ${diff.length}건${diff.length ? ` [${diff.slice(0, 5).join(" · ")}]` : ""}`);
      if (diff.length) { fail += 1; process.exitCode = 1; }
    }
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) process.exitCode = 1;
}
