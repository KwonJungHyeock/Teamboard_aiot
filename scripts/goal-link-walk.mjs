// 연결 경로가 하나인지 실측한다 (MD-P-2026-030 §E).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 무엇을 보는가.
//   §A1 목표 상세에 "연결된 프로젝트" 섹션도 "＋ 프로젝트 연결" 버튼도 없다
//   §A2 프로젝트 상세에 "＋ 목표 연결" 이 없다
//   §A3 프로젝트 경유가 진척에서 빠졌다 — **직접 붙지 않은 업무를 만들어 값을 움직여 본다**
//   §A4 새 업무의 goal_source 가 inherited 가 아니다 · 상속 요청은 거부된다
//   §A5 테이블·컬럼은 살아 있다
//   §C2 연결 **데이터**도 살아 있다 — 코드가 도는 동안 한 건도 줄지 않는다
//   §C3 1회 안내가 뜨고, 닫으면 다시 뜨지 않는다
//   표본 가드 — 업무 1건짜리 연간 목표가 100% 막대로 뜨지 않는다 (지시 16)
//   §B  배너 숫자 = 일괄 연결 화면 행 수 = 서버 판정, 셋이 같은 수다
//   서버 경로도 함께 닫혔는지 — 화면에서 버튼만 지우면 경로는 남는다
//
// 짝이 되는 존재 단언을 붙인다 (지시 28-2) — "0건"만 세면 화면이 통째로 비어도 통과한다.
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("goal-link-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-030";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const ok  = (id, n) => { rows.push({ id, pass: true,  n }); console.log(`OK   ${id.padEnd(22)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(22)} ${n}`); };
const chk = (id, c, n) => (c ? ok(id, n) : bad(id, n));

// 실측이 만든 것만 지운다 (§D3 사건 이후 규칙) — 표식으로 찾는다.
const MARK = "MD030실측";

let browser;
const made = { taskIds: [], projectId: null, goalId: null, extraGoalIds: [] };
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const cookie = { name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" };
  await ctx.addCookies([cookie]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  // §C2 — "연결 데이터를 삭제하지 마세요". 시작 시점의 실물 개수를 떠 둔다.
  // 이 검사가 만든 행은 뒤에서 빼고 비교한다.
  const census = async () => ({
    projGoal: (await one(`SELECT count(*)::int AS n FROM project WHERE goal_id IS NOT NULL`)).n,
    goalTask: (await one(`SELECT count(*)::int AS n FROM goal_task`)).n,
    inherited: (await one(`SELECT count(*)::int AS n FROM task WHERE goal_source = 'inherited'`)).n,
    none: (await one(`SELECT count(*)::int AS n FROM task WHERE goal_source = 'none'`)).n,
  });
  const before = await census();

  // ── 준비: 이번 검사가 쓸 목표·프로젝트·업무를 직접 만든다 ─────────────
  //
  // §A3 를 실제로 보려면 "프로젝트는 이 목표를 가리키는데 업무는 목표에 안 붙은" 상태가 있어야 한다.
  // 예전 계산이면 그 업무가 목표 분모에 들어갔다. 지금은 안 들어가야 한다.
  const today = new Date().toISOString().slice(0, 10);
  const mStart = `${today.slice(0, 7)}-01`;
  const mEnd = new Date(Date.UTC(Number(today.slice(0,4)), Number(today.slice(5,7)), 0)).toISOString().slice(0,10);
  const g = await one(
    `INSERT INTO goal (period_type, period_start, period_end, title, scope, progress_mode, goal_parent_source)
     VALUES ('month', $1::date, $2::date, $3, 'team', 'auto', 'manual') RETURNING id`,
    [mStart, mEnd, `${MARK} 월 목표`]);
  made.goalId = g.id;
  const area = await one(`SELECT id FROM area WHERE is_active = true AND kind = 'workspace' ORDER BY sort_order, id LIMIT 1`);
  const p = await one(
    `INSERT INTO project (name, area_id, status, goal_id) VALUES ($1, $2, 'active', $3) RETURNING id`,
    [`${MARK} 프로젝트`, area.id, made.goalId]);
  made.projectId = p.id;
  // 이 프로젝트의 업무 3건 — **어느 것도 목표에 직접 붙이지 않는다.**
  for (const [t, pr] of [["가", 0], ["나", 50], ["다", 100]]) {
    const r = await one(
      `INSERT INTO task (project_id, area_id, work_type, title, status, assignee_id, priority, origin, created_by, visibility, progress, goal_source)
       VALUES ($1,$2,'team',$3,'doing',1,'mid','human',1,'team',$4,'manual') RETURNING id`,
      [made.projectId, area.id, `${MARK} 업무 ${t}`, pr]);
    made.taskIds.push(r.id);
  }
  // 목표 진척을 다시 계산시킨다 — 서버가 계산기를 돌게 한 뒤 저장값을 읽는다.
  await page.request.patch(`${BASE}/api/tasks/${made.taskIds[0]}`, { data: { progress: 1 } });
  await page.request.patch(`${BASE}/api/tasks/${made.taskIds[0]}`, { data: { progress: 0 } });

  // ── §A3 프로젝트 경유가 진척에서 빠졌다 ────────────────────────────
  const after = await one(`SELECT progress_auto::text AS a FROM goal WHERE id = $1`, [made.goalId]);
  const counted = await one(
    `SELECT count(*)::int AS n FROM task t
      WHERE t.parent_task_id IS NULL AND t.is_active
        AND EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id AND gt.goal_id = $1)`, [made.goalId]);
  const viaProject = await one(
    `SELECT count(*)::int AS n FROM task WHERE project_id = $1 AND is_active`, [made.projectId]);
  chk("A3-프로젝트경유차단", after.a === null && counted.n === 0 && viaProject.n === 3,
    `프로젝트가 목표 #${made.goalId} 를 가리키고 그 프로젝트에 업무 ${viaProject.n}건이 있다. ` +
    `직접 연결 ${counted.n}건 · 목표 집계값 ${after.a ?? "null(집계 없음)"} ` +
    `— 예전 계산이면 (0+50+100)/3 = 50 이 나왔어야 한다`);

  // 짝이 되는 존재 단언 — 계산기가 죽어서 null 인 게 아니라는 것을 보인다 (지시 28-2).
  // 같은 업무 3건을 이번엔 **직접** 붙이고, 같은 계산기가 50 을 내는지 본다.
  for (const id of made.taskIds) {
    await sql(`INSERT INTO goal_task (goal_id, task_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [made.goalId, id]);
  }
  await page.request.patch(`${BASE}/api/tasks/${made.taskIds[0]}`, { data: { progress: 0 } });
  const linked = await one(`SELECT progress_auto::text AS a FROM goal WHERE id = $1`, [made.goalId]);
  chk("A3-직접연결은센다", Math.round(Number(linked.a)) === 50,
    `같은 업무 3건(0·50·100%)을 직접 연결하니 집계값 ${linked.a}% — 계산기는 살아 있다`);
  // 연결을 **앱 경로로** 끊는다 — DB 에서 지우면 재계산이 안 돌아 저장값이 낡은 채 남는다.
  await page.request.put(`${BASE}/api/goals/${made.goalId}`, { data: { taskIds: [] } });

  // ── §A1 목표 상세 ────────────────────────────────────────────────
  await page.goto(`${BASE}/goals?panel=goal:${made.goalId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const secH = await page.locator(".gdp .tdp-sec-h").allInnerTexts();
  const addP = await page.locator(".gdp-addp").count();
  const projRow = await page.locator(".gdp-proj").count();
  const panelOpen = await page.locator(".gdp .tdp-title, .gdp h2.tdp-title").count();
  await page.screenshot({ path: `${OUT}/A1-목표상세.png` });
  chk("A1-프로젝트섹션없음",
    panelOpen > 0 && addP === 0 && projRow === 0 && !secH.some((t) => t.includes("연결된 프로젝트")),
    `패널은 열려 있고(제목 요소 ${panelOpen}개) 섹션 [${secH.join(" · ")}] 중 "연결된 프로젝트" 없음 · ` +
    `＋프로젝트 연결 버튼 ${addP}개 · 프로젝트 행 ${projRow}개`);

  // 속성 그리드가 이제 무엇을 말하는가 — 빈자리로 두지 않았다는 존재 단언.
  const gridLabels = await page.locator(".gdp .tdp-grid > label").allInnerTexts();
  chk("A1-집계대상표시", gridLabels.some((t) => t.includes("집계 대상 업무")),
    `속성: ${gridLabels.map((t) => t.split("\n")[0].trim()).join(" · ")}`);

  // 진척 방식 라벨 — "자동(프로젝트·업무 집계)" 라고 적혀 있었다. 프로젝트는 이제 집계 단위가 아니다.
  const modeOpts = await page.locator(".gdp .tdp-grid select").first().locator("option").allInnerTexts();
  chk("A3-진척방식문구", modeOpts.some((t) => t.includes("업무")) && !modeOpts.some((t) => t.includes("프로젝트")),
    `진척 방식 선택지 [${modeOpts.join(" / ")}]`);

  // 값이 떠 있는데 옆에 "집계 없음" 이 붙던 문제 (캡처를 열어 보고 발견).
  // 수동값 70% · 집계 대상 0건 상태를 만들어 두 문구가 같이 뜨는지 본다.
  await page.request.put(`${BASE}/api/goals/${made.goalId}`, { data: { progressMode: "manual", progress: 70 } });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const headLine = (await page.locator(".gdp-prog-t").innerText()).replace(/\n/g, " ");
  await page.screenshot({ path: `${OUT}/A3-수동값근거.png` });
  chk("A3-값과근거가안싸운다", headLine.includes("70%") && !headLine.includes("집계 없음"),
    `진척 줄 "${headLine}" — 값이 떠 있으면 "집계 없음"이 같이 뜨면 안 된다`);
  await page.request.put(`${BASE}/api/goals/${made.goalId}`, { data: { progressMode: "auto" } });

  // ── §A2 프로젝트 상세 ─────────────────────────────────────────────
  await page.goto(`${BASE}/projects/${made.projectId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const sub = await page.locator(".pws-sub").innerText().catch(() => "(없음)");
  const goalLink = await page.locator(".pws-goal-l, .pws-goal-pick").count();
  const title = await page.locator(".pws-title").innerText().catch(() => "(없음)");
  await page.screenshot({ path: `${OUT}/A2-프로젝트상세.png` });
  chk("A2-목표연결없음", title.includes(MARK) && goalLink === 0 && !sub.includes("＋ 목표 연결"),
    `프로젝트 "${title}" (project.goal_id 는 DB 에 #${made.goalId} 로 살아 있다) · ` +
    `목표 링크/피커 ${goalLink}개 · 부제 "${sub.replace(/\n/g, " ")}"`);

  // ── 서버 경로도 닫혔는가 — 버튼만 지우면 경로는 남는다 ──────────────
  const postLink = await page.request.post(`${BASE}/api/goals/${made.goalId}/projects`,
    { data: { projectIds: [made.projectId] } });
  const delLink = await page.request.delete(`${BASE}/api/goals/${made.goalId}/projects?projectId=${made.projectId}`);
  const putGoal = await page.request.put(`${BASE}/api/projects/${made.projectId}`, { data: { goalId: made.goalId } });
  chk("A1-서버경로차단", postLink.status() === 410 && delLink.status() === 410 && putGoal.status() === 400,
    `POST /api/goals/{id}/projects → ${postLink.status()} · DELETE → ${delLink.status()} · ` +
    `PUT /api/projects/{id} {goalId} → ${putGoal.status()}`);

  // ── §A4 상속 폐지 ────────────────────────────────────────────────
  const created = await page.request.post(`${BASE}/api/tasks`,
    { data: { title: `${MARK} 새 업무`, areaId: area.id, projectId: made.projectId, status: "todo" } });
  const newId = (await created.json()).id;
  if (newId) made.taskIds.push(newId);
  const newRow = await one(`SELECT goal_source FROM task WHERE id = $1`, [newId]);
  const newLinks = await one(`SELECT count(*)::int AS n FROM goal_task WHERE task_id = $1`, [newId]);
  chk("A4-새업무는상속안함",
    created.ok() && newRow?.goal_source === "manual" && newLinks.n === 0,
    `프로젝트(목표 #${made.goalId} 를 가리킴)에 새 업무를 만들었다 → goal_source="${newRow?.goal_source}" · ` +
    `자동으로 붙은 목표 ${newLinks.n}개 (예전에는 inherited + 자동 연결 1개였다)`);

  const inh = await page.request.patch(`${BASE}/api/tasks/${newId}`, { data: { goalSource: "inherited" } });
  const stillManual = await one(`SELECT goal_source FROM task WHERE id = $1`, [newId]);
  chk("A4-상속요청거부", inh.status() === 400 && stillManual?.goal_source === "manual",
    `PATCH {goalSource:"inherited"} → ${inh.status()} · 값은 "${stillManual?.goal_source}" 그대로`);

  // 되돌리기는 '미지정'으로 — 상속이 아니다.
  await page.request.patch(`${BASE}/api/tasks/${newId}`, { data: { goalSource: "none" } });
  const noneRow = await one(`SELECT goal_source FROM task WHERE id = $1`, [newId]);
  await page.request.patch(`${BASE}/api/tasks/${newId}`, { data: { goalSource: "manual" } });
  const backRow = await one(`SELECT goal_source FROM task WHERE id = $1`, [newId]);
  chk("A4-목표없음해제", noneRow?.goal_source === "none" && backRow?.goal_source === "manual",
    `"목표 없음" 지정 → "${noneRow?.goal_source}" · 해제 → "${backRow?.goal_source}"(미지정)`);

  // ── §A5 테이블·컬럼 보존 ──────────────────────────────────────────
  const cols = await sql(
    `SELECT table_name, column_name FROM information_schema.columns
      WHERE (table_name, column_name) IN (('project','goal_id'), ('task','goal_source'),
                                          ('goal_snapshot','linked_project_count'))
      ORDER BY 1,2`);
  const gt = await one(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name = 'goal_task'`);
  const chk4 = await one(
    `SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
      WHERE conrelid = 'task'::regclass AND pg_get_constraintdef(oid) LIKE '%goal_source%'`);
  chk("A5-컬럼보존", cols.length === 3 && gt.n === 1 && (chk4?.d ?? "").includes("inherited"),
    `살아 있는 컬럼 ${cols.map((c) => `${c.table_name}.${c.column_name}`).join(" · ")} · ` +
    `goal_task 테이블 ${gt.n}개 · CHECK ${chk4?.d ?? "(없음)"} — inherited 를 좁히지 않았다`);

  // ── §B 배너와 진척이 같은 기준 ────────────────────────────────────
  // 서버 판정 · 배너 숫자 · 일괄 연결 화면 행 수, 셋을 각각 따로 세서 비교한다.
  const api = await (await page.request.get(`${BASE}/api/goals?scope=team`)).json();
  const serverN = (api.unlinkedTasks ?? []).length;
  const dbN = (await one(
    `SELECT count(*)::int AS n FROM task t
      WHERE t.parent_task_id IS NULL AND t.is_active = true AND t.status <> 'proposed'
        AND t.status <> 'dropped' AND t.work_type <> 'routine'
        AND (t.resolution IS NULL OR t.resolution NOT IN ('canceled','duplicate'))
        AND NOT EXISTS (SELECT 1 FROM goal_task gt WHERE gt.task_id = t.id)
        AND t.goal_source <> 'none' AND t.visibility = 'team'`)).n;

  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const banner = await page.locator(".ulbanner .num").innerText().catch(() => "(없음)");
  const bannerN = Number(String(banner).replace(/[^0-9]/g, ""));
  await page.locator(".ulbanner").click();
  await page.waitForTimeout(900);
  const panelN = await page.locator(".utp .dl-row").count();
  await page.screenshot({ path: `${OUT}/B-배너와목록.png`, fullPage: true });
  chk("B3-배너=목록=서버", bannerN > 0 && bannerN === panelN && panelN === serverN && serverN === dbN,
    `배너 "${banner}" (${bannerN}) · 일괄 연결 화면 행 ${panelN} · API ${serverN} · DB 직접 조회 ${dbN}`);

  // §B2 — "목표 없음"은 미연결이 아니다. 한 건을 none 으로 바꾸면 정확히 1 줄어야 한다.
  const victim = made.taskIds[1];
  await page.request.patch(`${BASE}/api/tasks/${victim}`, { data: { goalSource: "none" } });
  const api2 = await (await page.request.get(`${BASE}/api/goals?scope=team`)).json();
  chk("B2-목표없음은제외", (api2.unlinkedTasks ?? []).length === serverN - 1,
    `업무 #${victim} 를 "목표 없음"으로 → 미연결 ${serverN} → ${(api2.unlinkedTasks ?? []).length}건`);
  await page.request.patch(`${BASE}/api/tasks/${victim}`, { data: { goalSource: "manual" } });

  // §B1 — 미연결로 세어진 업무가 정말 어느 목표에도 집계되지 않는가.
  // 배너 목록의 업무 id 를 전부 모아, 어떤 목표의 서브트리 집계에도 안 들어가는지 본다.
  const ids = (api.unlinkedTasks ?? []).map((t) => t.id);
  const leaked = ids.length === 0 ? [] : await sql(
    `WITH RECURSIVE sub AS (
       SELECT id, id AS root FROM goal WHERE is_active = true
       UNION ALL SELECT g.id, s.root FROM goal g JOIN sub s ON g.parent_id = s.id WHERE g.is_active = true)
     SELECT DISTINCT t.id FROM task t
      WHERE t.id = ANY($1::int[])
        AND EXISTS (SELECT 1 FROM goal_task gt JOIN sub ON sub.id = gt.goal_id WHERE gt.task_id = t.id)`,
    [ids]);
  chk("B1-미연결은집계밖", ids.length > 0 && leaked.length === 0,
    `배너가 센 ${ids.length}건 중 어떤 목표 서브트리에라도 잡히는 것 ${leaked.length}건`);

  // ── §C3 1회 안내 ────────────────────────────────────────────────
  // 이 브라우저 컨텍스트는 매번 새로 뜨므로 localStorage 가 비어 있다 = 첫 방문 상태.
  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const noticeText = (await page.locator(".lmn").innerText().catch(() => "")).replace(/\n/g, " ");
  const noticeCoral = await page.locator(".lmn").evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor + getComputedStyle(el).borderLeftColor;
    return bg;
  }).catch(() => "(없음)");
  await page.screenshot({ path: `${OUT}/C3-안내.png` });
  chk("C3-안내가뜬다",
    noticeText.includes("프로젝트를 목표에 연결하는 방식이 없어졌습니다")
      && noticeText.includes("21건") && noticeText.includes("1건만 남습니다")
      && noticeText.includes("미연결 업무에서 한 번에"),
    `"${noticeText}"`);

  await page.locator(".lmn-x").click();
  await page.waitForTimeout(400);
  const goneNow = await page.locator(".lmn").count();
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const goneAfter = await page.locator(".lmn").count();
  // 짝이 되는 존재 단언 — 저장소를 비우면 **다시 떠야** 한다. 안 그러면 위 0건은
  // "안내가 애초에 안 그려졌다"와 구별되지 않는다 (지시 28-2).
  await page.evaluate(() => localStorage.removeItem("tb:notice:link-model-030"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const backAgain = await page.locator(".lmn").count();
  chk("C3-닫으면안뜬다", goneNow === 0 && goneAfter === 0 && backAgain === 1,
    `닫은 직후 ${goneNow}개 · 새로고침 후 ${goneAfter}개 · 저장소를 비우면 ${backAgain}개(다시 떠야 한다)`);

  // ── 표본 가드 — 업무 1건짜리 연간 목표 (지시 16) ────────────────────
  // 030 §A3 로 프로젝트 경유가 빠지면서 실제로 이 상태에 닿는 연간 목표가 생긴다.
  // 프로덕션 #8 이 업무 21건 → 1건이 된다.
  const yg = await one(
    `INSERT INTO goal (period_type, period_start, period_end, title, scope, goal_parent_source)
     VALUES ('year','2029-01-01','2029-12-31',$1,'team','manual') RETURNING id`, [`${MARK} 연간`]);
  const qg = await one(
    `INSERT INTO goal (parent_id, period_type, period_start, period_end, title, scope, goal_parent_source)
     VALUES ($1,'quarter','2029-01-01','2029-03-31',$2,'team','manual') RETURNING id`, [yg.id, `${MARK} Q1`]);
  const mg = await one(
    `INSERT INTO goal (parent_id, period_type, period_start, period_end, title, scope, goal_parent_source)
     VALUES ($1,'month','2029-01-01','2029-01-31',$2,'team','manual') RETURNING id`, [qg.id, `${MARK} 1월`]);
  made.extraGoalIds = [yg.id, qg.id, mg.id];
  const only = await one(
    `INSERT INTO task (area_id, work_type, title, status, assignee_id, priority, origin, created_by, visibility, progress, goal_source)
     VALUES ($1,'team',$2,'done',1,'mid','human',1,'team',100,'manual') RETURNING id`,
    [area.id, `${MARK} 유일한 업무`]);
  made.taskIds.push(only.id);
  await page.request.put(`${BASE}/api/goals/${mg.id}`, { data: { taskIds: [only.id] } });

  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "전체", exact: true }).first().click();   // 2029 는 연도 칩에 없다
  await page.waitForTimeout(1800);
  const ycard = page.locator(".ycard", { hasText: MARK }).first();
  const ytext = (await ycard.innerText()).replace(/\n/g, " · ");
  const yfill = await ycard.locator(".ycard-bar .bar i").count();
  const yempty = await ycard.locator(".ycard-bar .bar.empty").count();
  await ycard.screenshot({ path: `${OUT}/표본가드-연간1건.png` });
  chk("표본가드-막대없음", yfill === 0 && yempty === 1 && ytext.includes("업무 1건 — 표본 부족"),
    `연간 카드 "${ytext}" · 채운 막대 ${yfill}개(0이어야 한다) · 빈 막대 ${yempty}개`);

  // 30-1 — 값을 감추지 않는다. 표본 부족이어도 %가 보인다.
  // 30-2 — 대신 숫자를 --muted 로 낮춘다. 확정값(--ink)과 색으로 구분된다.
  const ypct = ycard.locator(".ycard-p");
  const ypctText = (await ypct.innerText()).trim();
  const ypctColor = await ypct.evaluate((el) => getComputedStyle(el).color);
  const mutedRgb = await page.evaluate(() => {
    const probe = document.createElement("span");
    probe.style.color = "var(--muted)";
    document.body.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  chk("30-1·2 값은보이고흐리다", ypctText === "100%" && ypctColor === mutedRgb,
    `연간 카드 진척 숫자 "${ypctText}" (감추지 않는다) · 색 ${ypctColor} = var(--muted) ${mutedRgb}`);

  // 2029 Q1 은 현재 분기가 아니라 기본이 접혀 있다 — 월 행을 보려면 펼친다.
  const openQuarter = async () => {
    const sec = page.locator(".qsec", { hasText: `${MARK} Q1` }).first();
    if ((await sec.getAttribute("class"))?.includes("open")) return;
    await sec.locator(".qsec-fold .qsec-q").click();
    await page.waitForTimeout(700);
    if (await page.locator(".tdp-backdrop").count()) {   // 혹시 패널이 열렸으면 닫고 간다
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };

  // 30-5 — 두 화면이 **같은 함수**에서 나오는지. 코드가 아니라 화면에서 대조한다.
  //        같은 상태(집계 1건)의 월 목표 행과 연간 카드가 같은 말을 해야 한다.
  await openQuarter();
  const mrow = page.locator(".grow", { hasText: `${MARK} 1월` }).first();
  const mprog = mrow.locator(".gprog");
  const mText = (await mprog.locator(".gpv").innerText()).replace(/\n/g, " ").trim();
  const mFill = await mprog.locator(".bar i").count();
  const mLow = await mprog.locator(".gpv.low").count();
  const yNorm = ytext.split(" · ").filter((x) => x.includes("%") || x.includes("표본 부족")).join(" ");
  chk("30-5 두화면이같은말을한다",
    mFill === 0 && mLow === 1 && mText.includes("100%") && mText.includes("업무 1건 — 표본 부족"),
    `연간 카드 "${yNorm}" · 월 행 "${mText}" · 월 채운 막대 ${mFill}개 · 월 .gpv.low ${mLow}개 ` +
    `— 둘 다 progressDisplay() 한 함수에서 나온다`);

  // 짝이 되는 존재 단언 — 3건이면 막대가 **그려져야** 한다. 안 그러면 위 0건은
  // "이 카드는 막대를 아예 안 그린다"와 구별되지 않는다.
  for (const t of ["둘", "셋"]) {
    const r = await one(
      `INSERT INTO task (area_id, work_type, title, status, assignee_id, priority, origin, created_by, visibility, progress, goal_source)
       VALUES ($1,'team',$2,'done',1,'mid','human',1,'team',100,'manual') RETURNING id`,
      [area.id, `${MARK} 업무 ${t}`]);
    made.taskIds.push(r.id);
  }
  await page.request.put(`${BASE}/api/goals/${mg.id}`,
    { data: { taskIds: made.taskIds.slice(-3) } });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "전체", exact: true }).first().click();
  await page.waitForTimeout(1800);
  const ycard3 = page.locator(".ycard", { hasText: MARK }).first();
  const ytext3 = (await ycard3.innerText()).replace(/\n/g, " · ");
  const yfill3 = await ycard3.locator(".ycard-bar .bar i").count();
  const ylow3 = await ycard3.locator(".ycard-p.low").count();
  await openQuarter();
  const mrow3 = page.locator(".grow", { hasText: `${MARK} 1월` }).first().locator(".gprog");
  const mFill3 = await mrow3.locator(".bar i").count();
  const mLow3 = await mrow3.locator(".gpv.low").count();
  chk("표본가드-3건이면그린다",
    yfill3 === 1 && ylow3 === 0 && ytext3.includes("업무 3건 기준") && mFill3 === 1 && mLow3 === 0,
    `업무 3건으로 늘리니 연간 "${ytext3}" · 채운 막대 ${yfill3}개 · 흐림 ${ylow3}개(0이어야 한다) · ` +
    `월 행 채운 막대 ${mFill3}개 · 흐림 ${mLow3}개 — 두 화면이 함께 확정값으로 돌아온다`);

  // ── §C2 연결 데이터는 한 건도 안 지웠다 ─────────────────────────────
  // 이 검사가 만든 것만 빼고 비교한다. 실측 프로젝트 1건이 목표를 가리키고,
  // 방금 월 목표에 업무 3건을 붙였다.
  const now = await census();
  chk("C2-연결데이터보존",
    now.projGoal === before.projGoal + 1 && now.goalTask === before.goalTask + 3
      && now.inherited === before.inherited && now.none === before.none,
    `project.goal_id ${before.projGoal}→${now.projGoal}(실측 +1) · ` +
    `goal_task ${before.goalTask}→${now.goalTask}(실측 +3) · ` +
    `goal_source inherited ${before.inherited}→${now.inherited}(그대로) · ` +
    `none ${before.none}→${now.none}(그대로)`);

  console.log(`\nJS 오류 ${errs.length}건${errs.length ? " — " + errs.join(" / ") : ""}`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/link-walk.json`, JSON.stringify(rows, null, 2));
} finally {
  // 자기가 만든 것만 지운다. 표식이 없는 행이 실측 대상을 참조하면 **이름을 찍고** 멈춘다.
  const strays = made.projectId ? await sql(
    `SELECT id, title FROM task WHERE project_id = $1 AND title NOT LIKE $2`,
    [made.projectId, `${MARK}%`]) : [];
  if (strays.length) console.log(`⚠ 표식 없는 업무가 실측 프로젝트를 참조 중: ${strays.map((s) => `#${s.id} ${s.title}`).join(", ")}`);
  await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [made.taskIds]);
  await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [made.taskIds]);
  await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [made.taskIds]);
  if (made.projectId) await sql(`DELETE FROM project WHERE id = $1`, [made.projectId]);
  const allGoals = [made.goalId, ...made.extraGoalIds].filter(Boolean);
  if (allGoals.length) {
    await sql(`DELETE FROM goal_snapshot WHERE goal_id = ANY($1::int[])`, [allGoals]);
    await sql(`UPDATE goal SET parent_id = NULL WHERE id = ANY($1::int[])`, [allGoals]);   // 자식 먼저 끊는다
    await sql(`DELETE FROM goal WHERE id = ANY($1::int[])`, [allGoals]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE $1`, [`%${MARK}%`]);
  console.log(`정리 — 목표 ${allGoals.length} · 프로젝트 1 · 업무 ${made.taskIds.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
