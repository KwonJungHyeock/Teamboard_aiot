// 기간이 계층을 결정한다 — 실측 (MD-P-2026-029 §A · §F).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// A-1 8월 목표를 만들 때 상위 선택이 화면에 **없고** Q3 아래로 들어가는가
// A-2 Q3 가 없을 때 묻는 화면이 뜨고, 체크하면 함께 만들어지는가
// A-3 그 해 연간이 1개면 묻지 않고, 2개 이상이면 고르게 하는가
// A-4 기간을 8월 → 10월로 바꾸면 Q3 → Q4 로 따라가고 양쪽이 재계산되는가
// A-5 「고급」에서 수동 지정하면 기간을 바꿔도 따라가지 않는가
//
// 라벨은 화면에서 읽은 값이다 (§G 캡처 라벨 규격).
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("goal-hierarchy-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-029/hierarchy";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const MARK = "[계층실측]";
const YEAR = 2027;                 // API 검사는 빈 해에서 — 실데이터를 건드리지 않는다
// 화면 검사는 현재 해에서 한다. /goals 는 아직 ?year= 를 읽지 않아 URL 로 해를 바꿀 수 없고,
// 마침 실데이터가 두 경우를 다 갖고 있다:
//   2월 → Q1 2026 없음      → §A2 "함께 만들까요?" 가 뜨는 경우
//   8월 → Q3 2026 이 2개    → §A3 "어느 쪽인가요?" 가 뜨는 경우
const UI_YEAR = new Date().getFullYear();
fs.mkdirSync(OUT, { recursive: true });
const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(20)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(20)} ${n}`); };
const chk = (id, c, n) => (c ? ok(id, n) : bad(id, n));

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  const api = (path, init) => page.evaluate(async ([p, i]) => {
    const r = await fetch(p, i);
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [path, init]);

  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator(".frn-skip").first().click({ timeout: 3000 })
    // 안내는 계정에 따라 안 뜬다(`account.onboarded_at`). 실패해도 되지만
    // **조용히 넘어가지는 않는다** — 빈 catch 는 없는 실패를 만든다(§G).
    .catch(() => console.log("   (첫 실행 안내 없음 — 닫을 것이 없다)"));

  // ══ A-1 · A-2 — 전역 "＋ 새 목표" 에서: 상위 셀렉트 없음 + 없으면 묻는다 ═══
  // 분기 섹션의 "+ 월 목표" 는 이제 만든 자리가 상위를 정하므로(A-신1-1) 묻지 않는다.
  // 묻는 화면은 **전역 진입점**에서만 뜬다.
  await page.locator(".gadd-open", { hasText: "＋ 새 목표" }).first().click();
  await page.waitForTimeout(400);
  // 2월 — 그 분기(Q1)가 없는 경우
  await page.locator(".gadd select[aria-label='월']").selectOption("2");
  await page.waitForTimeout(1000);

  const labels = await page.locator(".gadd select").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  await page.screenshot({ path: `${OUT}/A1-상위선택없음.png` });
  chk("A1-상위선택없음", !labels.includes("상위 목표"),
    `전역 폼의 셀렉트 [${labels.join(", ")}] — 후보가 0이라 "상위 목표" 셀렉트가 없다`);

  const askText = await page.locator(".gadd-mkparent label").innerText().catch(() => "(없음)");
  await page.screenshot({ path: `${OUT}/A2-묻는화면.png` });
  chk("A2-묻는화면", /목표가 없습니다\. 함께 만들까요\?/.test(askText),
    `${UI_YEAR}년 2월 선택 → 화면 문구 "${askText.replace(/\n+/g, " ")}"`);

  // 체크하고 함께 만든다
  await page.locator(".gadd-mkparent input[type=checkbox]").check();
  await page.waitForTimeout(300);
  await page.locator(".gadd-ptitle").fill(`${MARK} ${UI_YEAR} Q1`);
  await page.locator(".gadd input").first().fill(`${MARK} 2월 목표`);
  await page.locator(".gadd .lk", { hasText: "추가" }).first().click();
  await page.waitForTimeout(2200);

  const made2 = (await sql(
    `SELECT g.id, g.period_start::text AS ps, g.period_end::text AS pe, g.parent_id, g.goal_parent_source,
            p.title AS ptitle, p.period_type AS ptype, p.period_start::text AS pps
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id
      WHERE g.title = $1 AND g.is_active`, [`${MARK} 2월 목표`]))[0];
  await page.screenshot({ path: `${OUT}/A2-함께만든결과.png` });
  chk("A1-자동귀속", made2 && made2.ps === `${UI_YEAR}-02-01` && made2.ptype === "quarter" && made2.pps === `${UI_YEAR}-01-01`,
    `2월 목표(기간 ${made2?.ps}~${made2?.pe})의 상위 = "${made2?.ptitle ?? "없음"}" (${made2?.ptype} ${made2?.pps}) · 출처 ${made2?.goal_parent_source}`);
  chk("A2-함께생성", made2?.ptitle === `${MARK} ${UI_YEAR} Q1`,
    `체크한 제목으로 상위가 실제 생성됨 — 현재 상위 "${made2?.ptitle}"`);

  // 8월 — 그 분기(Q3)가 **둘**인 경우: 화면이 고르게 한다 (§A3)
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1400);
  await page.locator(".gadd-open", { hasText: "＋ 새 목표" }).first().click();
  await page.waitForTimeout(400);
  await page.locator(".gadd select[aria-label='월']").selectOption("8");
  await page.waitForTimeout(1000);
  const pickSel = await page.locator(".gadd select[aria-label='상위 목표']").count();
  const pickOpts = await page.locator(".gadd select[aria-label='상위 목표'] option").allTextContents().catch(() => []);
  await page.screenshot({ path: `${OUT}/A3-고르게함.png` });
  chk("A3-화면이고르게함", pickSel === 1,
    `전역 "＋ 새 목표" 에서 ${UI_YEAR}년 8월 선택 → Q3 후보가 둘이라 상위 셀렉트 ${pickSel}개 등장 [${pickOpts.join(", ")}]`);

  // A-신1-1 — 분기 섹션의 "+ 월 목표" 에서는 **묻지 않는다**. 짝이 되는 부재 단언.
  await page.locator(".gadd .lk", { hasText: "취소" }).first().click();
  await page.locator(".gadd-open", { hasText: "+ 월 목표" }).first().click();
  await page.waitForTimeout(900);
  const inSection = await page.locator(".gadd select").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
  const whereTxt = await page.locator(".gadd-where").first().innerText().catch(() => "(없음)");
  await page.screenshot({ path: `${OUT}/A신1-자리에서만들면안묻는다.png` });
  chk("A신1-자리는안묻음", !inSection.includes("상위 목표") && /아래로 들어갑니다/.test(whereTxt),
    `분기 섹션의 "+ 월 목표" — 셀렉트 [${inSection.join(", ")}] · 안내 "${whereTxt.replace(/\n+/g, " ")}" (같은 8월인데 여기선 묻지 않는다)`);
  await page.locator(".gadd .lk", { hasText: "취소" }).first().click();

  // API 검사는 빈 해(2027)에서 — 실데이터를 건드리지 않는다.
  // 먼저 Q3 를 함께 만들고(§A2 경로), 그다음 **같은 8월 목표를 하나 더** 만든다.
  // 두 번째 것은 후보가 정확히 하나라 자동 귀속되고 출처가 derived 다 (A-신1-4).
  // §A4 는 derived 일 때만 따라가므로, 검사 대상은 이 두 번째 것이어야 한다.
  await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "month", title: `${MARK} 8월 목표(placed)`, periodStart: `${YEAR}-08-01`, scope: "team",
                           createParent: { title: `${MARK} ${YEAR} Q3` } }) });
  const madeRes = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "month", title: `${MARK} 8월 목표`, periodStart: `${YEAR}-08-01`, scope: "team" }) })).body;
  const made = (await sql(
    `SELECT g.id, g.period_start::text AS ps, g.parent_id, g.goal_parent_source,
            p.title AS ptitle, p.period_type AS ptype, p.period_start::text AS pps
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id WHERE g.id = $1`, [madeRes.goal.id]))[0];
  chk("A신1-4-폴백", made.goal_parent_source === "derived" && made.ptype === "quarter",
    `후보가 정확히 하나일 때만 기간 자동 귀속 — 상위 "${made.ptitle}" · 출처 ${made.goal_parent_source}`);

  // ══ A-3 — 연간이 1개면 묻지 않고, 2개면 고르게 한다 ══════════════════
  const y1 = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "year", title: `${MARK} ${YEAR} 연간 A`, periodStart: `${YEAR}-01-01`, scope: "team" }) })).body;
  const oneCand = (await api(`/api/goals/parent?periodType=quarter&periodStart=${YEAR}-10-01&scope=team`)).body;
  const y2 = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "year", title: `${MARK} ${YEAR} 연간 B`, periodStart: `${YEAR}-01-01`, scope: "team" }) })).body;
  const twoCand = (await api(`/api/goals/parent?periodType=quarter&periodStart=${YEAR}-10-01&scope=team`)).body;
  chk("A3-하나면안묻음", oneCand.candidates.length === 1,
    `연간 1개일 때 후보 ${oneCand.candidates.length}개 → 서버가 그대로 붙인다 (묻지 않음)`);
  chk("A3-둘이면고름", twoCand.candidates.length === 2,
    `연간 2개일 때 후보 ${twoCand.candidates.length}개 [${twoCand.candidates.map((c) => c.title).join(", ")}] → 화면이 고르게 한다`);

  // 후보가 둘인데 안 고르면 상위 없이 만들어진다 (조용히 아무거나 고르지 않는다)
  const q4 = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "quarter", title: `${MARK} ${YEAR} Q4`, periodStart: `${YEAR}-10-01`, scope: "team" }) })).body;
  chk("A3-안고르면없음", q4.parentId === null && (q4.parentCandidates?.length ?? 0) === 2,
    `안 고르고 저장 → parentId ${q4.parentId} · 후보 ${q4.parentCandidates?.length}개를 돌려줌 (아무거나 고르지 않는다)`);

  // ══ A-4 — 기간 8월 → 10월이면 Q3 → Q4, 양쪽 재계산 ═══════════════════
  const before = await sql(
    `SELECT id, title, progress FROM goal WHERE id IN ($1, $2)`, [made.parent_id, q4.goal.id]);
  const mv = await api(`/api/goals/${made.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodStart: `${YEAR}-10-01` }) });
  await page.waitForTimeout(600);
  const after = (await sql(
    `SELECT g.period_start::text AS ps, g.period_end::text AS pe, g.parent_id,
            p.title AS ptitle, p.period_start::text AS pps
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id WHERE g.id = $1`, [made.id]))[0];
  const recalc = await sql(`SELECT id, title, progress, updated_at FROM goal WHERE id IN ($1, $2) ORDER BY id`,
    [made.parent_id, q4.goal.id]);
  chk("A4-상위이동", after.parent_id === q4.goal.id && after.ps === `${YEAR}-10-01`,
    `기간 ${YEAR}-08-01 → ${after.ps} (끝 ${after.pe}) · 상위 "${made.ptitle}" → "${after.ptitle}" (${after.pps})`);
  chk("A4-알림", !!mv.body?.moved,
    `서버가 이동 사실을 돌려줌 — ${mv.body?.moved ? `"${mv.body.moved.fromTitle}" → "${mv.body.moved.toTitle}"` : "없음"} (화면이 한 줄로 알린다)`);
  chk("A4-양쪽재계산",
    recalc.every((r) => r.updated_at),
    `떠난 쪽 #${made.parent_id} 진척 ${before.find((b) => b.id === made.parent_id)?.progress ?? "null"} → ${recalc.find((r) => r.id === made.parent_id)?.progress ?? "null"} · ` +
    `붙은 쪽 #${q4.goal.id} ${before.find((b) => b.id === q4.goal.id)?.progress ?? "null"} → ${recalc.find((r) => r.id === q4.goal.id)?.progress ?? "null"} (둘 다 재계산 대상)`);

  // ══ A-5 — 수동 지정하면 기간을 바꿔도 따라가지 않는다 ═════════════════
  await api(`/api/goals/${made.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentId: made.parent_id }) });                     // 다시 Q3 로 손으로 지정
  const manual = (await sql(`SELECT parent_id, goal_parent_source FROM goal WHERE id = $1`, [made.id]))[0];
  await api(`/api/goals/${made.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodStart: `${YEAR}-11-01` }) });                 // 기간만 또 바꾼다
  const stayed = (await sql(
    `SELECT g.period_start::text AS ps, g.parent_id, g.goal_parent_source, p.title AS ptitle
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id WHERE g.id = $1`, [made.id]))[0];
  chk("A5-수동은안따라감",
    manual.goal_parent_source === "manual" && stayed.parent_id === made.parent_id && stayed.ps === `${YEAR}-11-01`,
    `수동 지정 후 출처 ${stayed.goal_parent_source} · 기간을 ${YEAR}-11-01 로 바꿔도 상위는 "${stayed.ptitle}" 그대로 (11월이면 Q4 지만 따라가지 않는다)`);

  // 자동으로 되돌리면 그때 따라간다 — 짝이 되는 존재 단언
  await api(`/api/goals/${made.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parentSource: "derived" }) });
  const back = (await sql(
    `SELECT g.parent_id, g.goal_parent_source, p.title AS ptitle
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id WHERE g.id = $1`, [made.id]))[0];
  chk("A5-되돌리면따라감", back.goal_parent_source === "derived" && back.parent_id === q4.goal.id,
    `「고급」에서 자동으로 되돌림 → 출처 ${back.goal_parent_source} · 상위 "${back.ptitle}" (11월이 속한 Q4 로 이동)`);

  // ══ A-신1 — 위치가 상위를 결정한다 ═══════════════════════════════
  // 기간만으로는 못 정하는 상황(같은 분기에 목표 둘)을 일부러 만들고,
  // 그 상황에서 "만든 자리"가 이기는지 본다. 여기가 이번 정정의 핵심이다.
  const qA = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "quarter", title: `${MARK} ${YEAR} Q2 큰과제 A`, periodStart: `${YEAR}-04-01`, scope: "team" }) })).body;
  const qB = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "quarter", title: `${MARK} ${YEAR} Q2 큰과제 B`, periodStart: `${YEAR}-04-01`, scope: "team" }) })).body;
  const cand2 = (await api(`/api/goals/parent?periodType=month&periodStart=${YEAR}-05-01&scope=team`)).body;

  const placed = (await api("/api/goals", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodType: "month", title: `${MARK} 5월 세부과제`, periodStart: `${YEAR}-05-01`, scope: "team",
                           placedParentId: qB.goal.id }) })).body;
  const placedRow = (await sql(
    `SELECT g.parent_id, g.goal_parent_source, p.title AS ptitle
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id WHERE g.id = $1`, [placed.goal.id]))[0];
  chk("A신1-위치가이김", placedRow.parent_id === qB.goal.id && placedRow.goal_parent_source === "placed",
    `같은 분기에 목표가 ${cand2.candidates.length}개라 기간으론 못 정하는 상황 — "큰과제 B" 섹션에서 만드니 상위 "${placedRow.ptitle}" · 출처 ${placedRow.goal_parent_source} (묻지 않았다)`);

  // A-신1-5 · A-신1-6 — placed 는 기간을 바꿔도 따라가지 않는다
  await api(`/api/goals/${placed.goal.id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ periodStart: `${YEAR}-08-01` }) });
  const stillB = (await sql(
    `SELECT g.period_start::text AS ps, g.parent_id, g.goal_parent_source, p.title AS ptitle
       FROM goal g LEFT JOIN goal p ON p.id = g.parent_id WHERE g.id = $1`, [placed.goal.id]))[0];
  chk("A신1-placed안따라감", stillB.parent_id === qB.goal.id && stillB.ps === `${YEAR}-08-01`,
    `기간을 5월 → ${stillB.ps} 로 바꿔도 상위는 "${stillB.ptitle}" 그대로 (8월이면 Q3 지만 placed 라 따라가지 않는다) · 출처 ${stillB.goal_parent_source}`);

  console.log(`\nJS 오류 ${errs.length}건`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/walk.json`, JSON.stringify(rows, null, 2));
} finally {
  // 정리 — 표식이 붙은 것만. 자식부터 지운다(부모 FK).
  const g = await sql(`SELECT id FROM goal WHERE title LIKE $1`, [`${MARK}%`]);
  if (g.length) {
    const ids = g.map((x) => x.id);
    await sql(`DELETE FROM goal_task WHERE goal_id = ANY($1::int[])`, [ids]);
    await sql(`UPDATE goal SET parent_id = NULL WHERE id = ANY($1::int[])`, [ids]);
    await sql(`DELETE FROM goal WHERE id = ANY($1::int[])`, [ids]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE $1`, [`%${MARK}%`]);
  console.log(`정리 — 목표 ${g.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
