// §B 빠른 등록 화면 검사 (MD-P-2026-032 배치 ②).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32). 만든 것만 지운다.
//
// 규칙(`lib/project-buttons.ts`)이 맞는지는 `project-buttons-walk.mjs` 가 이미
// 순수 함수로 확인했다. **여기는 그리기가 맞는지만 본다.** 두 검사기가 같은 것을
// 두 번 세지 않게 경계를 나눈다.
//
//   ① 「연결」이 등록 모달 텍스트에 **0건** — §B 가 끝났다는 가장 간단한 증거
//      짝 — 모달이 실제로 떠 있고 글자가 0자가 아니다(빈 화면이면 0건도 참이다)
//   ② 고급이 **닫힌 채로 뜬다.** 열었다 닫고 다시 열어도 닫혀 있다 (기억하지 않는다)
//   ③ 네 칸이 접기 없이 보인다 — 제목 · 프로젝트 · 기간 · 특이사항
//   ④ 프로젝트 버튼이 그려지고 **1순위 영역의 상시가 눌려 있다**
//   ⑤ 버튼은 **단일 선택 토글**
//   ⑥ 제목만 넣고 만들 수 있다 — 그리고 **프로젝트가 실제로 붙는다**
//   ⑦ 고급에서 목표 목록이 **비어 있지 않다** (monthGoals 오독으로 늘 비어 있었다)
//   ⑧ 팝오버에서 Esc 를 눌러도 **모달은 살아 있다**
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("quick-create-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const TITLE = "[검사] §B 빠른 등록";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

let pass = 0, fail = 0;
const ok = (id, n) => { pass++; console.log(`OK   ${id.padEnd(16)} ${n}`); };
const bad = (id, n) => { fail++; console.log(`FAIL ${id.padEnd(16)} ${n}`); };
const t = (c, id, n) => (c ? ok(id, n) : bad(id, n));

let browser;
let goalShot = null;
try {
  const lead = await one(`SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
                           WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 1`);
  if (!lead) throw new Error("사람 계정이 없다 — 시드부터 하라");
  // 기대값을 화면이 아니라 **DB 에서** 만든다. 화면이 낸 값으로 화면을 채점하면
  // 화면이 틀려도 통과한다.
  const myAreas = (await sql(
    `SELECT area_id FROM actor_area WHERE actor_id = $1 ORDER BY sort_order, area_id`, [lead.id]
  )).map((r) => r.area_id);
  const wantStanding = await one(
    `SELECT id, name FROM project WHERE type='standing' AND area_id = $1 AND is_active`, [myAreas[0]]
  );
  const goalProjects = Number((await one(`SELECT count(*)::int n FROM project WHERE type='goal' AND is_active`)).n);
  const wantBtn = goalProjects + myAreas.length;
  console.log(`기대 — 소속 영역 [${myAreas.join(", ")}] · 1순위 상시 #${wantStanding?.id} ${wantStanding?.name}`);
  console.log(`기대 — 버튼 ${goalProjects}(goal) + ${myAreas.length}(상시) = ${wantBtn}`);
  console.log("");

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") jsErrors.push(m.text()); });

  // ⑦이 잴 조건을 **모달을 열기 전에** 만든다.
  //
  // 처음엔 ⑦ 자리에서 만들었다가 FAIL 이 났다 — 모달은 열릴 때 `/api/meta/selectors`
  // 를 한 번 받아 두므로, **그 뒤에 DB 를 바꾸면 화면은 모른다.**
  // 검사기가 옳은 화면을 결함으로 읽은 것이다.
  // **조건은 관측보다 먼저 만든다.**
  goalShot = (await sql(`SELECT id, is_active FROM goal ORDER BY id`))
    .map((r) => `${r.id}:${r.is_active}`).join(" ");
  const someGoal = await one(
    `SELECT id FROM goal WHERE period_type IN ('quarter','month') ORDER BY id LIMIT 1`);
  if (someGoal) await pool.query(`UPDATE goal SET is_active = true WHERE id = $1`, [someGoal.id]);

  // FirstRun 은 **서버 상태**(account.onboarded_at)로 뜬다. 화면을 눌러 닫으려 하기
  // 전에 그 상태가 어디서 오는지 본다 — 클릭만으로는 계속 다시 떴다.
  await pool.query(`UPDATE account SET onboarded_at = now() WHERE onboarded_at IS NULL`);

  const openModal = async () => {
    await page.goto(`${BASE}/tasks?panel=task:new`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".ntm", { timeout: 20000 });
    // ⚠ `.pp-b, .pp-off` 아무거나 기다리면 **selectors 응답 전의 화면**을 잰다.
    //   기대값을 DB 에서 이미 아니 **그 수만큼 그려질 때까지** 기다린다.
    await page.waitForFunction(
      (n) => document.querySelectorAll(".pp-b").length === n, wantBtn, { timeout: 15000 }
    ).catch(() => {});
  };
  await openModal();

  // ── ① 「연결」 0건 ──────────────────────────────────────────────
  const text = (await page.locator(".ntm").innerText()).trim();
  t(text.length > 30, "①짝", `모달 글자 ${text.length}자 (0자면 아래 0건은 뜻이 없다)`);
  const hits = text.split("연결").length - 1;
  t(hits === 0, "①연결0건",
    hits === 0 ? "등록 모달 텍스트에 「연결」 없음"
      : `**${hits}건** — ${text.split("\n").filter((l) => l.includes("연결")).join(" / ")}`);
  const attrs = await page.locator(".ntm [title], .ntm [aria-label], .ntm [placeholder]").evaluateAll(
    (els) => els.flatMap((e) => [e.getAttribute("title"), e.getAttribute("aria-label"), e.getAttribute("placeholder")]).filter(Boolean)
  );
  const attrHits = attrs.filter((a) => a.includes("연결"));
  t(attrHits.length === 0, "①속성", attrHits.length === 0
    ? `title·aria-label·placeholder ${attrs.length}개 전부 깨끗` : `**${attrHits.join(" / ")}**`);

  // ── ③ 네 칸 ────────────────────────────────────────────────────
  const four = {
    제목: await page.locator(".ntm-title").count(),
    프로젝트: await page.locator(".ntm-f .pp, .ntm-f .pp-off").count(),
    기간: await page.locator(".ntm-when").count(),
    특이사항: await page.locator(".ntm-desc").count(),
  };
  t(Object.values(four).every((n) => n === 1), "③네칸",
    Object.entries(four).map(([k, v]) => `${k} ${v}`).join(" · "));

  // ── ② 고급은 닫힌 채로 뜨고, 기억하지 않는다 ────────────────────
  t(await page.locator(".ntm-side").count() === 0, "②고급닫힘", "처음에 .ntm-side 없음");
  await page.locator(".ntm-adv").click();
  await page.waitForSelector(".ntm-side", { timeout: 5000 });
  const advRows = await page.locator(".ntm-side .prop-row").count();
  t(advRows === 6, "②고급6줄", `공개범위·목표·담당·상태·우선순위·영역 = ${advRows}줄`);
  await page.locator(".ntm-adv").click();
  await openModal();
  t(await page.locator(".ntm-side").count() === 0, "②기억안함", "다시 열어도 고급은 닫혀 있다");

  // ── ④ 버튼 수 · 기본 선택 ──────────────────────────────────────
  const nBtn = await page.locator(".pp-b").count();
  t(nBtn === wantBtn, "④버튼수", `${nBtn} (기대 ${wantBtn})`);
  const onLabels = await page.locator(".pp-b.on").allInnerTexts();
  t(onLabels.length === 1, "④단일선택", `눌린 버튼 ${onLabels.length}개 [${onLabels.join(" | ")}]`);
  const wantLabel = myAreas.length > 1
    ? `상시 · ${(await one(`SELECT name FROM area WHERE id = $1`, [myAreas[0]])).name}` : "상시";
  t(onLabels[0] === wantLabel, "④기본값", `눌린 것 「${onLabels[0]}」 (기대 「${wantLabel}」)`);

  // ── ⑤ 단일 선택 토글 ───────────────────────────────────────────
  const other = page.locator(".pp-b:not(.on)").first();
  const otherLabel = await other.innerText();
  await other.click();
  const after = await page.locator(".pp-b.on").allInnerTexts();
  t(after.length === 1 && after[0] === otherLabel, "⑤바꾸기",
    `「${otherLabel}」 누르니 [${after.join(" | ")}] — 앞의 것이 벗어야 한다`);
  await page.locator(".pp-b.on").first().click();
  t(await page.locator(".pp-b.on").count() === 0, "⑤벗기기", "같은 것을 다시 누르면 벗는다");
  await page.locator(".pp-b", { hasText: wantLabel }).first().click();

  // ── ⑦ 목표 목록이 비어 있지 않다 ───────────────────────────────
  //
  // ⚠ **조건을 만들지 않으면 이 단언은 아무것도 증명하지 못한다.**
  //   로컬 시드의 goal 이 전부 `is_active=false` 라서, 그대로 재면
  //   「화면 0개 == DB 0개」로 통과한다. 그런데 이 단언이 잡으려는 결함이
  //   바로 **목록이 늘 비어 있던 것**이다. 비어 있는 것끼리 맞춰 놓고
  //   「통과」라고 적으면 그 결함이 돌아와도 모른다.
  //
  //   그래서 분기·월 목표 하나를 **활성으로 만들어 놓고** 잰다. 뒷정리에서
  //   시작 전 지문 그대로 되돌린다(§G — 절대값이 아니라 시작 전 상태와 대조).
  const wantGoals = Number((await one(
    `SELECT count(*)::int n FROM goal WHERE is_active AND period_type IN ('quarter','month')`)).n);
  await page.locator(".ntm-adv").click();
  await page.waitForSelector(".ntm-side", { timeout: 5000 });
  const gi = await page.locator(".ntm-side .prop-l").evaluateAll(
    (els) => els.findIndex((e) => e.textContent.trim() === "목표"));
  await page.locator(".ntm-side .prop-row").nth(gi).click();
  await page.waitForSelector(".prop-goals", { timeout: 5000 });
  const gOpts = await page.locator(".prop-goals label").count();
  const gNone = await page.locator(".prop-goals .prop-none").count();
  // 조건을 만들었으므로 wantGoals 는 0 이 아니어야 한다. 0 이면 조건 만들기가
  // 실패한 것이고, 그때 「0개 == 0개」로 통과시키지 않는다.
  t(wantGoals > 0 && gOpts === wantGoals, "⑦목표목록",
    `선택지 ${gOpts}개 (DB 분기·월 목표 ${wantGoals}개)` +
    (gOpts === 0 && wantGoals > 0 ? " — **늘 비어 있던 그 증상이다**"
     : wantGoals === 0 ? " — **조건을 못 만들었다. 이 단언은 아무것도 재지 못했다**" : ""));
  void gNone;

  // ── ⑧ Esc 는 팝오버만 닫는다 ───────────────────────────────────
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  t(await page.locator(".prop-goals").count() === 0 && await page.locator(".ntm").count() === 1,
    "⑧Esc", "팝오버만 닫히고 모달은 살아 있다");
  await page.locator(".ntm-adv").click();

  // ── ⑥ 제목만으로 만들어지고 프로젝트가 붙는다 ───────────────────
  await page.locator(".ntm-title").fill(TITLE);
  await page.locator(".ntm-foot .btn-primary").click();
  await page.waitForSelector(".ntm", { state: "detached", timeout: 15000 }).catch(() => {});
  const made = await one(
    `SELECT t.id, t.project_id, p.name AS pname, p.type FROM task t
       LEFT JOIN project p ON p.id = t.project_id WHERE t.title = $1`, [TITLE]);
  t(Boolean(made), "⑥제목만", made ? `업무 #${made.id} 생성됨` : "**안 만들어졌다**");
  t(made?.project_id === wantStanding?.id, "⑥프로젝트",
    made ? `붙은 프로젝트 #${made.project_id} ${made.pname} (${made.type}) — 기대 #${wantStanding?.id}`
         : "업무가 없어 확인 불가");

  const real = jsErrors.filter((e) => !e.includes("[project-picker]"));
  t(real.length === 0, "JS오류", real.length ? real.join(" / ") : "없음");

  console.log("");
  console.log(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  // 업무를 만들면 activity_log 가 따라 붙고 FK 가 삭제를 막는다.
  // 삼키되 조용히는 아니다 — 이유를 찍는다.
  try {
    await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title = $1)`, [TITLE]);
    await pool.query(`DELETE FROM goal_task WHERE task_id IN (SELECT id FROM task WHERE title = $1)`, [TITLE]);
    await pool.query(`DELETE FROM task WHERE title = $1`, [TITLE]);
  } catch (e) {
    console.error("뒷정리 실패:", String(e && e.message ? e.message : e));
  }
  // 목표 활성 상태를 **시작 전 지문 그대로** 되돌린다.
  let goalBack = "(안 건드림)";
  if (goalShot) {
    for (const pair of goalShot.split(" ")) {
      const [id, act] = pair.split(":");
      await pool.query(`UPDATE goal SET is_active = $1 WHERE id = $2`, [act === "true", Number(id)]).catch(() => {});
    }
    const now = (await sql(`SELECT id, is_active FROM goal ORDER BY id`))
      .map((r) => `${r.id}:${r.is_active}`).join(" ");
    goalBack = now === goalShot ? "시작 전과 같음" : `**다름** ${now}`;
    if (now !== goalShot) process.exitCode = 1;
  }
  const left = await one(`SELECT count(*)::int n FROM task WHERE title = $1`, [TITLE]).catch(() => null);
  console.log(`뒷정리 확인 — [검사] 업무 ${left?.n ?? "?"} (0이어야 한다) · 목표 활성 ${goalBack}`);
  if (left && left.n !== 0) process.exitCode = 1;
  await pool.end().catch(() => {});
}
