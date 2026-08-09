// 차단 관계 실측 (MD-P-2026-028 §B · §E).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// §E 가 요구한 것을 그대로 잰다.
//   · 가드가 **화면에서** 어떻게 보이는가. 서버가 409 를 준다는 것만으로 부족하다.
//   · 지정 → "차단 없음" 해제의 **왕복**.
//   · B2 방향 — A 가 B 를 막게 했을 때 "이 업무가 막는 업무" 가 A 에만 뜨고 B 에는 안 뜬다.
//   · B4 — 원인 완료 시 안내가 뜨고 버튼이 실제로 푼다. **자동으로는 안 풀린다**(부재 단언).
//   · B3 — 칩이 앰버이고 코랄이 아니다. 지목이 없으면 사유가 툴팁으로 남는다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("block-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-028/block";
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

const MARK = "MD028차단";
let browser;
const made = { taskIds: [] };

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

  const area = await one(`SELECT id FROM area WHERE is_active AND kind='workspace' ORDER BY sort_order, id LIMIT 1`);
  const mk = async (n) => {
    const r = await (await api("post", "/api/tasks", { title: `${MARK} ${n}`, areaId: area.id })).json();
    made.taskIds.push(r.id);
    return r.id;
  };
  const A = await mk("A");   // 나중에 B 를 막는다
  const B = await mk("B");   // A 에 막힌다
  const C = await mk("C");   // 순환 시도용

  // ── §B1 지정 — 화면에서 ────────────────────────────────────────
  // B 의 속성에서 "차단" 을 눌러 콤보박스로 A 를 고른다. API 로 밀지 않는다 —
  // §E 가 "가드가 화면에서 어떻게 보이는지" 를 요구했다.
  await page.goto(`${BASE}/tasks?panel=task:${B}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const blkRow = page.locator(".tdp .prop-row", { hasText: "차단" }).first();
  await blkRow.locator(".prop-v, .prop-empty, button").first().click();
  await page.waitForTimeout(500);
  const comboSeen = await page.locator(".tdp .tcb").count();
  const noneFirst = await page.locator(".tdp .tcb .pcb-o").first().innerText();
  await page.locator(".tdp .tcb .pcb-q").fill(`${MARK} A`);
  await page.waitForTimeout(400);
  await page.locator(".tdp .tcb .pcb-o", { hasText: `${MARK} A` }).first().click();
  await page.waitForTimeout(1400);
  const bRow = await one(`SELECT blocked, blocked_by FROM task WHERE id = $1`, [B]);
  await page.screenshot({ path: `${OUT}/B1-지정.png` });
  chk("B1-콤보로지정",
    comboSeen === 1 && noneFirst.includes("차단 없음") && bRow.blocked === true && bRow.blocked_by === A,
    `콤보 ${comboSeen}개 · 첫 줄 "${noneFirst.replace(/\n/g, " ")}" · ` +
    `저장된 값 blocked=${bRow.blocked} blocked_by=${bRow.blocked_by}(A=#${A})`);

  // 지목한 차단에서 "사유 (필수)" 를 요구하면 안 된다 (§B1) — 캡처를 열어 보고 발견.
  const ph = await page.locator(".tdp .tdp-block-reason").getAttribute("placeholder");
  const bnote = await page.locator(".tdp .tdp-block-note").innerText().catch(() => "");
  chk("B1-지목이면사유는선택",
    !(ph ?? "").includes("필수") && bnote.includes("선택"),
    `사유 칸 안내 "${ph}" · 아래 문구 "${bnote}"`);

  // ── §B1 순환 가드 — **화면 문구를 그대로 싣는다** ──────────────
  // A 를 B 로 막으려 하면 순환이다 (B 는 이미 A 에 막혀 있다).
  await page.goto(`${BASE}/tasks?panel=task:${A}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const aBlkRow = page.locator(".tdp .prop-row", { hasText: "차단" }).first();
  await aBlkRow.locator(".prop-v, .prop-empty, button").first().click();
  await page.waitForTimeout(500);
  await page.locator(".tdp .tcb .pcb-q").fill(`${MARK} B`);
  await page.waitForTimeout(400);
  await page.locator(".tdp .tcb .pcb-o", { hasText: `${MARK} B` }).first().click();
  await page.waitForTimeout(1200);
  const cycText = await page.locator(".tdp .pcb-err").innerText().catch(() => "(문구 없음)");
  const aRow = await one(`SELECT blocked, blocked_by FROM task WHERE id = $1`, [A]);
  await page.screenshot({ path: `${OUT}/B1-순환거부.png` });
  chk("B1-순환은화면에서막힌다",
    aRow.blocked_by === null && cycText.includes("순환"),
    `저장 안 됨(blocked_by=${aRow.blocked_by}) · **화면 문구**:\n        "${cycText}"`);

  // 자기 자신도 같은 자리에서 거절되는가 (409). 콤보는 자기를 후보에서 빼므로 API 로 확인한다.
  const selfRes = await api("patch", `/api/tasks/${A}`, { blockedByTaskId: A });
  const selfBody = await selfRes.json().catch(() => ({}));
  const selfInList = await page.locator(".tdp .tcb .pcb-o", { hasText: `${MARK} A` }).count();
  chk("B1-자기자신거부",
    selfRes.status() === 409 && selfInList === 0,
    `HTTP ${selfRes.status()} "${selfBody.error ?? "(없음)"}" · 콤보 후보에 자기 자신 ${selfInList}개(0이어야 한다)`);

  // ── §B2 역방향 — 방향이 뒤집히지 않았는가. **양쪽에서** 본다 ────
  const aDetail = await (await api("get", `/api/tasks/${A}`)).json();
  const bDetail = await (await api("get", `/api/tasks/${B}`)).json();
  await page.goto(`${BASE}/tasks?panel=task:${A}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const aRowsText = await page.locator(".tdp .prop-row").allInnerTexts();
  const aHas = aRowsText.some((x) => x.includes("이 업무가 막는 업무"));
  await page.screenshot({ path: `${OUT}/B2-역방향.png` });
  await page.goto(`${BASE}/tasks?panel=task:${B}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  const bRowsText = await page.locator(".tdp .prop-row").allInnerTexts();
  const bHas = bRowsText.some((x) => x.includes("이 업무가 막는 업무"));
  chk("B2-방향이맞다",
    aHas && !bHas
      && aDetail.task.blocking.length === 1 && aDetail.task.blocking[0].id === B
      && bDetail.task.blocking.length === 0,
    `A(#${A}, 막는 쪽) 화면에 "이 업무가 막는 업무" ${aHas ? "있음" : "없음"} · blocking ${JSON.stringify(aDetail.task.blocking.map((x) => x.id))} · ` +
    `B(#${B}, 막힌 쪽) 화면에 ${bHas ? "있음(뒤집힘!)" : "없음"} · blocking ${JSON.stringify(bDetail.task.blocking.map((x) => x.id))}`);

  // ── §B3 목록 칩 — 앰버이고 코랄이 아니다 ────────────────────────
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const chip = page.locator("tbody tr", { hasText: `${MARK} B` }).first().locator(".st.blkd");
  await chip.waitFor({ timeout: 15000 });
  const chipText = await chip.innerText();
  const chipCss = await chip.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, tag: el.tagName, title: el.getAttribute("title") };
  });
  const coral = await page.evaluate(() => {
    const p = document.createElement("span"); p.style.color = "var(--coral)";
    document.body.appendChild(p); const c = getComputedStyle(p).color; p.remove(); return c;
  });
  await page.screenshot({ path: `${OUT}/B3-목록칩.png` });
  chk("B3-칩은앰버이고코랄아님",
    chipText.trim() === "차단됨" && chipCss.tag === "BUTTON" && chipCss.bg !== coral,
    `칩 "${chipText.trim()}" · ${chipCss.tag}(원인이 있으면 누를 수 있어야 한다) · ` +
    `배경 ${chipCss.bg} ≠ 코랄 ${coral} · title "${chipCss.title}"`);

  // 지목 없이 사유만 있는 차단도 같은 칩을 쓴다 — 갈 곳이 없으면 span 이고 사유가 툴팁이다.
  await api("patch", `/api/tasks/${C}`, { blocked: true, blockedReason: `${MARK} 부품 입고 지연` });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const chipC = page.locator("tbody tr", { hasText: `${MARK} C` }).first().locator(".st.blkd");
  const cInfo = await chipC.evaluate((el) => ({ tag: el.tagName, title: el.getAttribute("title") }));
  chk("B3-사유만있어도같은칩",
    (await chipC.innerText()).trim() === "차단됨" && cInfo.tag === "SPAN" && (cInfo.title ?? "").includes("부품 입고 지연"),
    `지목 없는 차단 — ${cInfo.tag}(누를 곳이 없으니 span) · 툴팁 "${cInfo.title}"`);

  // ── §B4 원인이 완료됐을 때 ──────────────────────────────────────
  await api("patch", `/api/tasks/${A}`, { status: "done" });
  const bAfter = await one(`SELECT blocked, blocked_by FROM task WHERE id = $1`, [B]);
  // **부재 단언** — 자동으로 풀리면 안 된다.
  chk("B4-자동으로안풀린다", bAfter.blocked === true && bAfter.blocked_by === A,
    `원인 A 를 완료했는데 B 는 blocked=${bAfter.blocked} blocked_by=${bAfter.blocked_by} — 그대로여야 한다`);

  // 활동에도 남는가 (사람이 화면을 안 보고 있을 수 있다)
  const act = await one(
    `SELECT message FROM activity_log WHERE task_id = $1 AND message LIKE '%차단 원인%' ORDER BY id DESC LIMIT 1`, [B]);
  chk("B4-활동에남는다", !!act, `"${act?.message ?? "(없음)"}"`);

  // 안내가 뜨고, 버튼이 **실제로** 푸는가
  await page.goto(`${BASE}/tasks?panel=task:${B}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const noteText = await page.locator(".tdp .blkdone").innerText().catch(() => "(없음)");
  await page.screenshot({ path: `${OUT}/B4-원인완료안내.png` });
  await page.locator(".tdp .blkdone .lk").click();
  await page.waitForTimeout(1600);
  const bFreed = await one(`SELECT blocked, blocked_by FROM task WHERE id = $1`, [B]);
  const noteGone = await page.locator(".tdp .blkdone").count();
  chk("B4-안내와한번에해제",
    noteText.includes("완료됐습니다") && bFreed.blocked === false && bFreed.blocked_by === null && noteGone === 0,
    `안내 "${noteText.replace(/\n/g, " ")}" → 해제 후 blocked=${bFreed.blocked} blocked_by=${bFreed.blocked_by} · 안내 ${noteGone}개`);

  // ── §B1 왕복 — 다시 지정했다가 "차단 없음" 으로 푼다 ─────────────
  const re = await api("patch", `/api/tasks/${B}`, { blockedByTaskId: C });
  const mid = await one(`SELECT blocked, blocked_by FROM task WHERE id = $1`, [B]);
  const off = await api("patch", `/api/tasks/${B}`, { blockedByTaskId: null });
  const end = await one(`SELECT blocked, blocked_by, blocked_reason FROM task WHERE id = $1`, [B]);
  chk("B1-지정해제왕복",
    re.ok() && mid.blocked_by === C && off.ok()
      && end.blocked === false && end.blocked_by === null && end.blocked_reason === null,
    `지정 → blocked_by=${mid.blocked_by}(C=#${C}) · "차단 없음" → blocked=${end.blocked} ` +
    `blocked_by=${end.blocked_by} 사유=${end.blocked_reason ?? "null"}`);

  console.log(`\nJS 오류 ${errs.length}건${errs.length ? " — " + errs.join(" / ") : ""}`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/block-walk.json`, JSON.stringify(rows, null, 2));
} finally {
  if (made.taskIds.length) {
    await sql(`UPDATE task SET blocked_by = NULL, parent_task_id = NULL WHERE id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id = ANY($1::int[])`, [made.taskIds])
      .catch(() => {});
    await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [made.taskIds]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE $1`, [`%${MARK}%`]);
  console.log(`정리 — 업무 ${made.taskIds.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
