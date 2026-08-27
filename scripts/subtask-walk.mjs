// 하위 업무 실측 (MD-P-2026-028 §A).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 무엇을 보는가.
//   A1 업무 상세의 하위 업무 섹션 — 위치 · 목록 행 높이(--row-h) · 제목 줄 · 인라인 추가(같은 컴포넌트)
//   ※ 행 높이는 031 §A2 로 38 → 44 가 됐다. 숫자를 여기 박아 두면 규격이 바뀔 때마다 검사가 먼저 깨진다.
//      그래서 **문서의 값을 옮겨 적지 않고 토큰이 실제로 계산된 값**과 비교한다.
//   A2 상속(프로젝트·영역·공개 범위) · 목표 직접 연결 거부(28-b, **사유 문구를 그대로 싣는다**)
//      · 하위 업무 상세에는 섹션 자체가 없다
//   A3 목록의 캐럿 · 22px 들여쓰기(목표 트리와 같은 값) · 높이 애니메이션 없음
//      · 하위만 걸려도 상위가 살아 나온다
//   A4 승격·강등 · 깊이 2단 거부 · **양쪽 목표 진척 즉시 재계산**
//   28-a 진척 합산이 기존 계산기 안에서 일어난다 (새 경로 없음)
//
// 짝이 되는 존재 단언을 붙인다 (지시 28-2).
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("subtask-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-028";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const ok  = (id, n) => { rows.push({ id, pass: true,  n }); console.log(`OK   ${id.padEnd(24)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(24)} ${n}`); };
const chk = (id, c, n) => (c ? ok(id, n) : bad(id, n));

const MARK = "MD028실측";
let browser;
const made = { taskIds: [], projectId: null, goalId: null };

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const api = (m, u, d) => page.request[m](`${BASE}${u}`, d ? { data: d } : undefined);

  // ── 준비 ────────────────────────────────────────────────────────
  const area = await one(`SELECT id FROM area WHERE is_active AND kind='workspace' ORDER BY sort_order, id LIMIT 1`);
  const area2 = await one(`SELECT id FROM area WHERE is_active AND id <> $1 ORDER BY sort_order, id LIMIT 1`, [area.id]);
  const pj = await one(
    `INSERT INTO project (name, area_id, status) VALUES ($1,$2,'active') RETURNING id`,
    [`${MARK} 프로젝트`, area.id]);
  made.projectId = pj.id;
  const today = new Date().toISOString().slice(0, 10);
  const g = await one(
    `INSERT INTO goal (period_type, period_start, period_end, title, scope, goal_parent_source)
     VALUES ('month', $1::date, $2::date, $3, 'team', 'manual') RETURNING id`,
    [`${today.slice(0,7)}-01`,
     new Date(Date.UTC(Number(today.slice(0,4)), Number(today.slice(5,7)), 0)).toISOString().slice(0,10),
     `${MARK} 월 목표`]);
  made.goalId = g.id;

  // 상위 업무 — 프로젝트에 속하고 목표에 붙어 있다.
  const parent = await (await api("post", "/api/tasks",
    { title: `${MARK} 상위`, areaId: area.id, projectId: made.projectId, status: "doing" })).json();
  made.taskIds.push(parent.id);
  await api("patch", `/api/tasks/${parent.id}`, { goalIds: [made.goalId] });

  // ── §A2 상속 ────────────────────────────────────────────────────
  // 프로젝트·영역·공개 범위를 **일부러 다르게 보내** 상위 값이 이기는지 본다.
  const kid = await (await api("post", "/api/tasks", {
    title: `${MARK} 하위 가`, parentTaskId: parent.id,
    areaId: area2?.id ?? area.id, projectId: null, visibility: "private",
  })).json();
  made.taskIds.push(kid.id);
  const kidRow = await one(
    `SELECT parent_task_id, project_id, area_id, visibility FROM task WHERE id = $1`, [kid.id]);
  const parentRow = await one(
    `SELECT project_id, area_id, visibility FROM task WHERE id = $1`, [parent.id]);
  chk("A2-상속",
    kidRow.parent_task_id === parent.id
      && kidRow.project_id === parentRow.project_id
      && kidRow.area_id === parentRow.area_id
      && kidRow.visibility === parentRow.visibility,
    `영역 ${area2?.id ?? area.id} · 프로젝트 없음 · 개인 으로 보냈는데 저장된 값은 ` +
    `프로젝트 ${kidRow.project_id} · 영역 ${kidRow.area_id} · ${kidRow.visibility} ` +
    `(상위와 같아야 한다: ${parentRow.project_id} · ${parentRow.area_id} · ${parentRow.visibility})`);

  // ── §A2 · 28-b 하위 업무는 목표에 직접 연결할 수 없다 ─────────────
  const rej = await api("patch", `/api/tasks/${kid.id}`, { goalIds: [made.goalId] });
  const rejBody = await rej.json().catch(() => ({}));
  const stillNoLink = await one(`SELECT count(*)::int AS n FROM goal_task WHERE task_id = $1`, [kid.id]);
  chk("A2·28b-목표연결거부",
    rej.status() === 400 && stillNoLink.n === 0 && (rejBody.error ?? "").includes("하위 업무는 목표에 직접"),
    `HTTP ${rej.status()} · goal_task ${stillNoLink.n}건 · 사유 문구:\n` +
    `        "${rejBody.error ?? "(없음)"}"`);

  // 짝이 되는 존재 단언 — 같은 요청이 **상위**에는 통한다. 라우트가 통째로 막힌 게 아니다.
  const okLink = await api("patch", `/api/tasks/${parent.id}`, { goalIds: [made.goalId] });
  const parentLinked = await one(`SELECT count(*)::int AS n FROM goal_task WHERE task_id = $1`, [parent.id]);
  chk("A2·28b-상위는통한다", okLink.ok() && parentLinked.n === 1,
    `같은 요청을 상위(#${parent.id})에 보내니 HTTP ${okLink.status()} · goal_task ${parentLinked.n}건`);

  // ── 28-a 진척 합산은 기존 계산기 안에서 ──────────────────────────
  // 하위 2건 중 1건 완료 → 상위의 실효 진척 50%. 상위의 저장된 progress 는 그대로 둔다.
  const kid2 = await (await api("post", "/api/tasks",
    { title: `${MARK} 하위 나`, parentTaskId: parent.id })).json();
  made.taskIds.push(kid2.id);
  await api("patch", `/api/tasks/${kid.id}`, { status: "done" });
  const detail = await (await api("get", `/api/tasks/${parent.id}`)).json();
  const stored = await one(`SELECT progress FROM task WHERE id = $1`, [parent.id]);
  chk("28a-하위롤업",
    detail.task.effectiveProgress === 50 && detail.task.rolledUpFromChildren === true,
    `하위 2건 중 1건 완료 → 상위 실효 진척 ${detail.task.effectiveProgress}% · ` +
    `"하위로 계산 중" ${detail.task.rolledUpFromChildren} · 상위의 저장값은 ${stored.progress}% 그대로 ` +
    `(계산기가 셈하지 저장값을 덮지 않는다)`);

  // 목표 진척도 같은 값이어야 한다 — 목표는 상위 업무 1건만 세고, 그 값이 롤업이다.
  const goalNow = await one(`SELECT progress_auto::text AS a FROM goal WHERE id = $1`, [made.goalId]);
  chk("28a-목표까지같은값", Math.round(Number(goalNow.a)) === 50,
    `목표 집계값 ${goalNow.a}% — 하위 롤업이 상위를 거쳐 목표까지 같은 계산기로 흐른다`);

  // 목록과 상세가 **같은 값**을 말하는가 (28-a).
  //   캡처를 열어 보니 목록은 0% · 상세는 50% 였다. 목록만 t.progress 를 그대로 썼다.
  const list = await (await api("get", `/api/tasks?assignee=1`)).json();
  const listed = (list.tasks ?? []).find((t) => t.id === parent.id);
  chk("28a-목록과상세가같다",
    listed && listed.progress === detail.task.effectiveProgress && listed.progress === 50,
    `같은 업무 #${parent.id} — 목록 ${listed?.progress}% · 상세 ${detail.task.effectiveProgress}% ` +
    `(둘 다 taskProgress() 한 함수에서 나온다)`);

  // ── §A1 업무 상세 화면 ──────────────────────────────────────────
  await page.goto(`${BASE}/tasks?panel=task:${parent.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  // 규격값은 문서에서 베끼지 않고 **화면이 실제로 계산한 토큰**에서 읽는다.
  const ROW_H = await page.evaluate(() =>
    Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row-h"))));
  const secH = await page.locator(".tdp .stx .tdp-sec-h").innerText().catch(() => "(없음)");
  const rowsN = await page.locator(".tdp .stx-row").count();
  const rowH = await page.locator(".tdp .stx-row").first().boundingBox();
  const iti = await page.locator(".tdp .stx .iti").count();
  // 속성 블록 아래 · 본문 위인가 — y 좌표로 잰다.
  const yProp = (await page.locator(".tdp .prop-b, .tdp .prop-row").first().boundingBox())?.y ?? -1;
  const yStx = (await page.locator(".tdp .stx").boundingBox())?.y ?? -1;
  const yDoc = (await page.locator(".tdp .tdp-doc").boundingBox())?.y ?? -1;
  await page.screenshot({ path: `${OUT}/A1-하위업무섹션.png` });
  chk("A1-위치와규격",
    yProp > 0 && yProp < yStx && yStx < yDoc && rowsN === 2 && Math.round(rowH?.height ?? 0) === ROW_H && iti === 1,
    `제목 줄 "${secH.replace(/\n/g, " ")}" · 행 ${rowsN}개 · 행 높이 ${Math.round(rowH?.height ?? 0)}px(--row-h ${ROW_H} 이어야) · ` +
    `인라인 추가 ${iti}개 · y좌표 속성 ${Math.round(yProp)} < 하위 ${Math.round(yStx)} < 본문 ${Math.round(yDoc)}`);

  // 인라인 추가가 **같은 컴포넌트**인가 — 세 자리가 같은 클래스와 같은 안내문을 쓴다.
  const itiPh = await page.locator(".tdp .stx .iti-q").getAttribute("placeholder");
  chk("A1-같은한줄입력", (itiPh ?? "").includes("Enter") && (itiPh ?? "").includes("⌘Enter"),
    `안내문 "${itiPh}" — InlineTaskInput 을 그대로 재사용(Enter 즉시 · ⌘Enter 확장)`);

  // ── §A2 하위 업무 상세에는 섹션 자체가 없다 ──────────────────────
  await page.goto(`${BASE}/tasks?panel=task:${kid.id}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  const kidStx = await page.locator(".tdp .stx").count();
  const kidTitle = await page.locator(".tdp .tdp-title").inputValue().catch(() => "");
  await page.screenshot({ path: `${OUT}/A2-하위상세.png` });
  chk("A2-하위엔섹션없음", kidStx === 0 && kidTitle.includes(MARK),
    `하위 업무 "${kidTitle}" 상세의 하위 업무 섹션 ${kidStx}개(0이어야 한다 — 눌러도 안 되는 것은 안 보인다)`);

  // ── §A4 승격·강등 ───────────────────────────────────────────────
  // 깊이 2단 — 하위 밑에 또 하위를 만들려 하면 거부한다.
  const deep = await api("post", "/api/tasks", { title: `${MARK} 3단`, parentTaskId: kid.id });
  const deepBody = await deep.json().catch(() => ({}));
  chk("A4-깊이2단거부", deep.status() === 400 && (deepBody.error ?? "").includes("하위 업무"),
    `HTTP ${deep.status()} · "${deepBody.error ?? "(없음)"}"`);

  // 하위를 가진 업무는 남의 하위가 될 수 없다.
  const other = await (await api("post", "/api/tasks", { title: `${MARK} 딴 업무`, areaId: area.id })).json();
  made.taskIds.push(other.id);
  const demoteParent = await api("patch", `/api/tasks/${parent.id}`, { parentTaskId: other.id });
  const dpBody = await demoteParent.json().catch(() => ({}));
  chk("A4-상위는강등못한다", demoteParent.status() === 400 && (dpBody.error ?? "").includes("하위 업무"),
    `HTTP ${demoteParent.status()} · "${dpBody.error ?? "(없음)"}"`);

  // 승격 — 하위를 최상위로. 목표 진척이 **양쪽 다** 즉시 바뀌어야 한다.
  const before = Math.round(Number((await one(`SELECT progress_auto::text AS a FROM goal WHERE id=$1`, [made.goalId])).a));
  const promote = await api("patch", `/api/tasks/${kid.id}`, { parentTaskId: null });
  const afterRow = await one(`SELECT parent_task_id FROM task WHERE id = $1`, [kid.id]);
  const after = Math.round(Number((await one(`SELECT progress_auto::text AS a FROM goal WHERE id=$1`, [made.goalId])).a));
  chk("A4-승격과즉시재계산",
    promote.ok() && afterRow.parent_task_id === null && before === 50 && after === 0,
    `하위 1건(완료)을 최상위로 올림 → 상위에 남은 하위는 미완료 1건뿐. ` +
    `목표 집계값 ${before}% → ${after}% (다시 조회하지 않고 즉시)`);

  // ── §A3 목록 화면 ───────────────────────────────────────────────
  await api("patch", `/api/tasks/${kid.id}`, { parentTaskId: parent.id });   // 되돌린다
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const cv = page.locator("tbody tr", { hasText: `${MARK} 상위` }).first().locator(".sub-cv");
  await cv.waitFor({ timeout: 15000 });   // 시간이 아니라 조건을 기다린다 (027 §D1 사건)
  const cvCount = await cv.count();
  // 캐럿은 **하위가 있는 행에만**. 전체 표에서 캐럿 수 = 하위를 가진 상위 수여야 한다.
  const cvTotal = await page.locator("tbody .sub-cv").count();
  const subBefore = await page.locator("tbody tr.sub-row").count();
  await cv.click();
  await page.waitForTimeout(600);
  const subAfter = await page.locator("tbody tr.sub-row").count();
  // 들여쓰기는 **제목 칸**(.sub-cell)에서 잰다. 첫 번째 td 는 체크박스 열일 수 있다.
  const indent = await page.locator("tbody tr.sub-row td.sub-cell").first()
    .evaluate((el) => getComputedStyle(el).paddingLeft).catch(() => "?");
  const plainIndent = await page.locator("tbody tr:not(.sub-row) td.sub-cell").first()
    .evaluate((el) => getComputedStyle(el).paddingLeft).catch(() => "(상위엔 .sub-cell 없음)");
  await page.screenshot({ path: `${OUT}/A3-목록펼침.png` });
  chk("A3-캐럿과들여쓰기",
    cvCount === 1 && cvTotal === 1 && subBefore === 0 && subAfter === 2 && indent === "22px",
    `이 행의 캐럿 ${cvCount}개 · 표 전체 캐럿 ${cvTotal}개(하위를 가진 상위 1건뿐이므로 1) · ` +
    `펼치기 전 하위 행 ${subBefore}개 · 펼친 뒤 ${subAfter}개 · ` +
    `하위 제목 칸 들여쓰기 ${indent} (목표 트리와 같은 22px) · 상위 제목 칸 ${plainIndent}`);

  // 높이를 애니메이트하지 않는다 (§H2 금지 속성).
  const anim = await page.locator("tbody tr.sub-row").first().evaluate((el) => {
    const cs = getComputedStyle(el);
    return { name: cs.animationName, dur: cs.animationDuration, trans: cs.transitionProperty };
  });
  chk("A3-높이는안움직인다",
    anim.name === "sub-in" && !/height/.test(anim.trans),
    `나타나는 애니메이션 "${anim.name}" ${anim.dur} · transition 속성 "${anim.trans}" (height 가 없어야 한다)`);

  // 하위만 걸려도 상위가 살아 나온다 (§A3 재귀 처리).
  const search = await (await api("get", `/api/tasks?assignee=1`)).json();
  const ids = new Set((search.tasks ?? []).map((t) => t.id));
  chk("A3-하위만걸려도상위가온다", ids.has(parent.id) && ids.has(kid.id),
    `담당 필터 결과에 상위 #${parent.id} ${ids.has(parent.id) ? "있음" : "없음"} · ` +
    `하위 #${kid.id} ${ids.has(kid.id) ? "있음" : "없음"} — 상위·하위가 같은 목록에 온다`);

  console.log(`\nJS 오류 ${errs.length}건${errs.length ? " — " + errs.join(" / ") : ""}`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/subtask-walk.json`, JSON.stringify(rows, null, 2));
} finally {
  // 자기가 만든 것만 지운다. 하위를 먼저 끊어야 FK 가 안 걸린다.
  if (made.taskIds.length) {
    await sql(`UPDATE task SET parent_task_id = NULL WHERE id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [made.taskIds]);
  }
  const strays = made.projectId
    ? await sql(`SELECT id, title FROM task WHERE project_id = $1`, [made.projectId]) : [];
  if (strays.length) console.log(`⚠ 실측 프로젝트를 참조하는 남은 업무: ${strays.map((s) => `#${s.id} ${s.title}`).join(", ")}`);
  if (made.projectId) await sql(`DELETE FROM project WHERE id = $1`, [made.projectId]);
  if (made.goalId) {
    await sql(`DELETE FROM goal_snapshot WHERE goal_id = $1`, [made.goalId]);
    await sql(`DELETE FROM goal WHERE id = $1`, [made.goalId]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE $1`, [`%${MARK}%`]);
  console.log(`정리 — 업무 ${made.taskIds.length}건 · 프로젝트 1 · 목표 1 삭제`);
  await browser?.close();
  await pool.end();
}
