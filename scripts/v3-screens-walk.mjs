// 새로 선 화면 셋 실측 — 목표 · 구성원 · 내 정보 (MD-P-2026-067 §B·§C·§D).
//
//   node scripts/v3-screens-walk.mjs
//
//   §B-11  목표별 진척이 집계 화면과 **글자 그대로** 같은 것
//   §B-12  목표 상세의 업무 id 집합이 **같은 집합**인 것 (건수로 안 센다)
//   §C-18  팀원에게 구성원 화면이 **막음 화면도 아니고 열리지도 않는 것**
//   §C-19  마지막 관리자 내리기가 **화면에서 안 눌리고** API 는 **400** 인 것
//   §D-20  넷이 보이고 읽기만인 것 · §D-21 할 수 있는 것은 **하나**
//   §D-23  `/profile` 이 **막음이 아니라** 내 정보로 오는 것
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";
import { testUser } from "./test-user.mjs";
import { ownPeople } from "./own-people.mjs";            // 076 §A — 권한을 바꿔 보는 것은 제 계정만
import { peopleSnapshot, peopleDiff } from "./people-guard.mjs";   // 076 §A — 사람 줄 대조

requireLocalDb("v3-screens-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HOST = new URL(BASE).hostname;
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(32)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(32)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[067검사]";
const ME = await testUser("admin");
const MEMBER = await testUser("member");

let browser, swBefore = null, made = [], beforeCount = null;
/**
 * 계정 **전부의** 시작 전 상태(역할 · 권한). ⑤ 가 조건을 만들려고 권한을 끄므로,
 * 끝에서 **이 표 그대로** 되돌리고 대조한다.
 *
 * 처음 판은 「끈 권한만」 기억했다. 그런데 ⑤ 가 보낸 요청이 **역할을 바꿨고**
 * (서버가 통과시켰다 — 판정이 맞았다), 검사기는 역할을 되돌릴 줄 몰랐다.
 * 로컬 계정 하나가 admin → member 로 남았다. 지문이 잡았다. 그래서 이제
 * **바꿀 수 있는 칸 전부**를 찍어 두고 전부 되돌린다(§G 034: 시작 전과 대조).
 */
let accountsBefore = null;
const own = ownPeople(pool, MARK);
let peopleGuard = null, ownGoal = null, skipped = 0;
try {
  peopleGuard = await peopleSnapshot(pool);
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  /*
   * ── 조건 — **목표에 달린 업무를 만든다** ──────────────────────────
   *
   * 로컬 DB 에 `goal_task` 가 **0행**이다. 그대로 재면 ② 가 빈 집합끼리
   * 비교해서 초록이 된다 — 아무것도 안 잰 값이다(§G 053).
   * 그래서 업무 하나를 만들어 목표에 건다. 끝나고 지운다.
   */
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  /*
   * 076 §A — 업무를 거는 목표도 **제 것**이다. 075 까지는 가장 최근 분기·월 목표(사람 목표)에
   * 제 업무를 걸었다 — 목표 목록에 남의 업무가 붙어 보였다. 이번 달을 덮는 월 목표를 만든다.
   */
  const ym = today.slice(0, 7);
  const mEnd = (await sql(`SELECT (date_trunc('month', $1::date) + interval '1 month - 1 day')::date::text d`, [today]))[0].d;
  ownGoal = (await sql(
    `INSERT INTO goal (period_type, period_start, period_end, title, scope, level, goal_parent_source)
     VALUES ('month', $1::date, $2::date, $3, 'team', 'month', 'manual') RETURNING id, title`,
    [`${ym}-01`, mEnd, `${MARK} 제 월 목표`]))[0];
  const goalForLink = ownGoal;
  if (goalForLink) {
    const t = (await sql(
      `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id)
       VALUES ($1, 'doing', $2::date, $3, 'team', 'team', $4, $4) RETURNING id`,
      [`${MARK} 목표에 달린 업무`, today, areaId, ME.id]))[0].id;
    made.push(t);
    await sql(`INSERT INTO goal_task (goal_id, task_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
              [goalForLink.id, t]);
    console.log(`   (조건) 업무 #${t} 를 목표 #${goalForLink.id} "${goalForLink.title}" 에 걸었다`);
  }

  accountsBefore = await sql(`SELECT actor_id, role, admin_grant FROM account ORDER BY actor_id`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(ME) }]);
  const page = await ctx.newPage();
  const errs = [];
  const wanted = [];
  const take = (t) => {
    // 이 검사기는 §C-19 에서 **일부러 400 을 만든다.** 따로 센다(065 §A-1).
    if (/Failed to load resource.*\b400\b/.test(t)) { wanted.push(t); return; }
    errs.push(t);
  };
  page.on("pageerror", (e) => take(e.message));
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    if (!ignoredWhy(line)) take(line); });

  const go = async (u) => {
    await page.goto(`${BASE}${u}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    return new URL(page.url());
  };

  /* ══ §B 목표 ═══════════════════════════════════════════════════ */

  await go("/v3/goals");
  const listed = await page.locator(".v3-goal").evaluateAll((els) => els.map((e) => ({
    title: (e.querySelector(".v3-row-t")?.textContent ?? "").trim(),
    pct: (e.querySelector(".v3-goal-pct")?.textContent ?? "").trim(),
    href: e.getAttribute("href"),
  })));
  chk("0조건-목표가-목록에-있다", listed.length > 0,
      `${listed.length}건 — 0이면 아래 §B 는 전부 아무것도 안 잰 값이다`);

  /*
   * 집계 쪽 값은 **제품에게 묻는다**(`/api/goals`). 검사기가 진척을 따로 세면
   * 제품이 쓰는 값과 갈라진다 — v3-detail-walk 의 가오픈 시각에서 겪은 그것.
   */
  const api = await page.evaluate(async () => {
    const d = await (await fetch("/api/goals")).json();
    const flat = [];
    const walk = (ns) => { for (const g of ns ?? []) { flat.push(g); walk(g.children); } };
    walk(d.tree);
    return flat.map((g) => ({ id: g.id, title: g.title, progress: g.progress, counted: g.countedTasks }));
  });
  const wrong = listed.filter((row) => {
    const g = api.find((x) => x.title === row.title);
    if (!g) return true;
    return (g.progress === null ? "—" : `${g.progress}%`) !== row.pct;
  });
  chk("①-목표-진척이-글자-그대로-같다", wrong.length === 0,
      `${listed.map((r) => `${r.title.slice(0, 10)} ${r.pct}`).join(" · ")}` +
      `${wrong.length ? ` — 다른 것 ${wrong.map((w) => w.title).join(",")}` : ""}`);

  /*
   * ── ② 목표 상세의 업무 id 집합 (§B-12) ─────────────────────────
   *
   * **건수로 안 센다.** 우연히 같은 수가 나오면 틀린 것이 통과한다.
   *
   * 고를 목표는 **DB 에 물어서** 정한다. 처음엔 `countedTasks > 0` 으로 골랐는데
   * 그 값은 **집계 대상** 수라, 업무가 달린 월 목표가 아니라 연 목표(0건)가
   * 골라져서 **빈 집합끼리 비교**했다 — 화면 [] · DB [] 로 초록이었다.
   * 아무것도 안 잰 값이다(§G 053).
   */
  const linkedGoal = (await sql(
    `SELECT gt.goal_id id, count(*)::int n FROM goal_task gt
       JOIN task t ON t.id = gt.task_id AND t.is_active AND t.status <> 'proposed'
      GROUP BY gt.goal_id ORDER BY n DESC, gt.goal_id LIMIT 1`))[0];
  chk("②조건-업무가-달린-목표가-있다", linkedGoal !== undefined && linkedGoal.n > 0,
      linkedGoal ? `목표 #${linkedGoal.id} 에 업무 ${linkedGoal.n}건 — 이게 없으면 ② 는 빈 집합끼리 비교한다`
                 : "**업무가 달린 목표가 하나도 없다** — ② 를 못 잰다");
  const withTasks = api.find((g) => g.id === linkedGoal?.id) ?? api[0];
  await go(`/v3/goals/${withTasks.id}`);
  const shown = await page.locator('.v3-card a[href^="/v3/tasks/"]').evaluateAll(
    (els) => els.map((e) => Number(String(e.getAttribute("href")).split("/").pop())));
  const dbIds = (await sql(
    `SELECT t.id FROM task t JOIN goal_task gt ON gt.task_id = t.id
      WHERE gt.goal_id = $1 AND t.is_active AND t.status <> 'proposed'
        AND (t.visibility = 'team' OR t.created_by = $2)
      ORDER BY t.id`, [withTasks.id, ME.id])).map((r) => r.id);
  const same = shown.length === dbIds.length && dbIds.every((id) => shown.includes(id));
  chk("②-목표-상세-업무가-같은-집합", same,
      `화면 [${shown.sort((a, b) => a - b).join(",")}] · DB [${dbIds.join(",")}]` +
      ` (목표 #${withTasks.id} "${withTasks.title.slice(0, 14)}")`);

  /* ══ §C 구성원 ═════════════════════════════════════════════════ */

  // ── ③ 관리자에게는 열린다 (짝 단언) ────────────────────────────
  const u3 = await go("/v3/members");
  const heads = (await page.locator(".v3-lede").first().textContent()) ?? "";
  const memRows = await page.locator(".v3-mem").count();
  const dbAll = (await sql(`SELECT count(*)::int n FROM account`))[0].n;
  chk("③-관리자에게는-열린다", u3.pathname === "/v3/members" && memRows === dbAll,
      `${u3.pathname} · 줄 ${memRows} · DB 계정 ${dbAll} · 머리 "${heads.trim()}"`);

  // ── ④ 팀원에게는 **막음 화면도 아니고 열리지도 않는다** (§C-18) ─
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await c2.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(MEMBER) }]);
  const p2 = await c2.newPage();
  await p2.goto(`${BASE}/v3/members`, { waitUntil: "networkidle" });
  await p2.waitForTimeout(700);
  const u4 = new URL(p2.url());
  const body4 = await p2.locator("body").innerText();
  const railHas = await p2.locator(".v3-rail .v3-navlink", { hasText: "구성원" }).count();
  chk("④-팀원에게는-안-열린다-·-막음도-아니다",
      u4.pathname !== "/v3/members" && u4.pathname !== "/v3/not-yet" && railHas === 0,
      `팀원(${MEMBER.name}) → ${u4.pathname}${u4.search} · 레일의 「구성원」 ${railHas}개` +
      ` · 이유 "${(body4.match(/구성원 관리는[^\n]*/) ?? ["(없음)"])[0]}"`);
  await c2.close();

  // ── ⑤ 마지막 관리자 — 화면에서 안 눌린다 (§C-19) ───────────────
  await go("/v3/members");
  const admins = (await sql(
    `SELECT a.actor_id id, ac.display_name name FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role = 'admin' OR a.admin_grant = true) ORDER BY a.actor_id`));
  /*
   * 조건 — 지금 관리자가 **여럿이면** 「마지막 한 명」이 아니라서 화면이 막지
   * 않는다. 그러면 이 줄은 아무것도 안 잰 값이 된다. 그래서 **DB 에서 셈을
   * 먼저 적고**, 여럿일 때는 「지금은 못 잰다」로 적는다 — 데이터를 바꾸지 않는다.
   */
  /*
   * 조건 — 「마지막 한 명」을 만든다.
   *
   * 권한(`admin_grant`)을 **전부** 잠깐 끄고, `role='admin'` 한 사람만 남긴다.
   * 그 사람은 **역할로만** 관리자다 — 그래야 역할을 내리는 순간 관리자가 0명이
   * 된다. 권한이 켜져 있으면 역할을 내려도 권한으로 남으므로 서버가 맞게
   * 통과시킨다(처음 판이 거기서 넘어졌다).
   */
  /*
   * 076 §A — 075 까지는 **사람 계정의 관리자 권한을 전부** 잠깐 꺼서 「역할로만 관리자인 한 명」을
   * 만들었다. 서버와 화면은 활성 관리자 **전체**를 세므로, 사람 권한을 안 만지면 그 조건을 못
   * 만든다. 못 고르면 안 만진다 — ⑤ 는 **미검사**로 적는다(재려면 사람 없는 빈 검사용 DB).
   */
  skipped += 3;
  console.log(`SKIP ⑤-마지막-관리자는-화면에서-안-눌린다 · ⑤짝 둘   사람 관리자 ${admins.length}명의 권한을 끄지 않고는 「마지막 한 명」을 못 만든다 — 미검사(076 §A)`);

  // ── ⑥ API 는 400 이다 (§C-19) — 화면과 서버 **둘 다** ──────────
  //    관리자가 여럿이어도 **자기 자신을 팀원으로 내리는** 요청이 마지막 한 명일
  //    때만 400 이므로, 여기서는 「역할이 관리자인 사람의 권한 끄기」를 쓴다 —
  //    서버가 늘 400 으로 거절하는 자리다(`grantChanged && role==='admin'`).
  // 076 §A — 거절될 요청이라도 **사람 계정에 보내지 않는다.** 역할이 관리자인 제 계정에 보낸다
  const target = await own.make({ role: "admin", grant: false, label: "역할 관리자" });
  const res = await page.evaluate(async (id) => {
    const r = await fetch(`/api/members/${id}`, { method: "PUT",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ adminGrant: false }) });
    return { status: r.status, body: await r.text() };
  }, target.id);
  chk("⑥-서버도-400-으로-거절한다", res.status === 400,
      `${res.status} · ${res.body.slice(0, 80)}`);
  const stillAdmin = (await sql(
    `SELECT count(*)::int n FROM account WHERE actor_id = $1 AND role = 'admin'`, [target.id]))[0].n;
  chk("⑥짝-거절되면-안-바뀐다", stillAdmin === 1, `role='admin' 그대로 ${stillAdmin}`);

  /* ══ §D 내 정보 ════════════════════════════════════════════════ */

  await go("/v3/me");
  const props = await page.locator(".v3-prop").evaluateAll((els) => els.map((e) => e.getAttribute("data-k")));
  const editable = await page.locator(".v3-prop-v.act, .v3-prop-edit").count();
  chk("⑦-넷이-보이고-읽기만-이다",
      ["이름", "이메일", "역할", "소속 팀"].every((k) => props.includes(k)) && editable === 0,
      `[${props.join(" · ")}] · 고칠 수 있는 칸 ${editable}개 (0이어야 한다)`);
  // 할 수 있는 것은 **하나**다 — 비밀번호 바꾸기.
  const buttons = await page.locator(".v3-card button").allTextContents();
  chk("⑦짝-할-수-있는-것은-하나", buttons.length === 1 && buttons[0].includes("바꾸기"),
      `단추 [${buttons.map((b) => b.trim()).join(" · ")}]`);

  // ── ⑧ `/profile` 은 **막음이 아니라** 내 정보로 (§D-23) ─────────
  const u8 = await go("/profile");
  const u9 = await go("/settings");
  chk("⑧-옛-프로필은-내-정보로", u8.pathname === "/v3/me",
      `/profile → ${u8.pathname}`);
  chk("⑧짝-설정은-그대로-막음", u9.pathname === "/v3/not-yet" && u9.searchParams.get("k") === "settings",
      `/settings → ${u9.pathname}?${u9.searchParams.toString()} (가오픈 뒤다)`);

  chk("콘솔짝-우리가-만든-400", wanted.length > 0,
      `일부러 만든 400 ${wanted.length}건 (1건 이상이라야 ⑥ 이 실제로 돌았다)`);
  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
} catch (e) {
  fail += 1;
  console.error("\n넘어졌다 —", e.stack ?? e.message);
} finally {
  if (browser) await browser.close();
  // 076 §A — 제 계정 · 제 목표를 **먼저** 지운다. 아래 계정 대조가 시작 전 표와 같아야 하므로
  const droppedOwn = await own.dropAll().catch((e) => { console.error("제 계정 지우기 실패", e.message); return -1; });
  if (ownGoal) {
    await pool.query(`DELETE FROM goal_task WHERE goal_id = $1`, [ownGoal.id]).catch(() => {});
    await pool.query(`DELETE FROM goal_snapshot WHERE goal_id = $1`, [ownGoal.id]).catch(() => {});
    await pool.query(`DELETE FROM goal WHERE id = $1`, [ownGoal.id]).catch((e) => console.error("제 목표 지우기 실패", e.message));
  }
  console.log(`정리 — 제 계정 ${droppedOwn}개 · 제 목표 ${ownGoal ? 1 : 0}개 지움`);
  // 계정 — **시작 전 표 그대로** 되돌리고 대조한다. 넘어졌어도 여기는 돈다.
  if (accountsBefore) {
    for (const a of accountsBefore) {
      await pool.query(`UPDATE account SET role = $2, admin_grant = $3 WHERE actor_id = $1`,
                       [a.actor_id, a.role, a.admin_grant])
        .catch((e) => console.error("계정 되돌리기 실패 —", a.actor_id, e.message));
    }
    const after = (await pool.query(`SELECT actor_id, role, admin_grant FROM account ORDER BY actor_id`)).rows;
    const same = JSON.stringify(after) === JSON.stringify(accountsBefore);
    console.log(`\n계정 되돌림 — ${after.map((a) => `#${a.actor_id} ${a.role}${a.admin_grant ? "+G" : ""}`).join(" · ")}` +
                `${same ? " (시작 전과 같다)" : " **시작 전과 다르다**"}`);
    if (!same) process.exitCode = 1;
  }
  for (const id of made) {
    await pool.query(`DELETE FROM goal_task WHERE task_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM activity_log WHERE task_id = $1`, [id]).catch(() => {});
    await pool.query(`DELETE FROM task WHERE id = $1`, [id]).catch(() => {});
  }
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const links = (await pool.query(`SELECT count(*)::int n FROM goal_task`)).rows[0].n;
    const ok = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount}) · goal_task ${links}행${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  if (peopleGuard) {
    const diff = await peopleDiff(pool, peopleGuard).catch((e) => [`대조 실패 — ${e.message}`]);
    console.log(`사람 줄 대조 — 시작 전과 다른 것 ${diff.length}건${diff.length ? ` **[${diff.slice(0, 6).join(" · ")}]**` : ""}`);
    if (diff.length) process.exitCode = 1;
  }
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail} · 미검사 ${skipped}`);
  if (fail > 0) process.exitCode = 1;
}
