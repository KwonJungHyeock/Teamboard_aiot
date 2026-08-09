// 드래그 정렬 실측 (MD-P-2026-028 §C · §E).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
//
// §E 가 요구한 것.
//   · 드래그 후 새로고침해도 순서가 유지되는가.
//   · 필터를 바꿔도 전역 순서가 깨지지 않는가.
//   · ⌥↑ / ⌥↓ 키보드 이동.
//   · reduce 에서 FLIP 이 멈추는가.
// C-b · 상위와 하위가 같은 평면에서 섞이지 않는가.
//
// ⚠ | head 로 파이프하지 말 것.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("reorder-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-028/reorder";
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

const MARK = "MD028순서";
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
  const mk = async (n, parentTaskId) => {
    const r = await (await api("post", "/api/tasks",
      { title: `${MARK} ${n}`, areaId: area.id, ...(parentTaskId ? { parentTaskId } : {}) })).json();
    made.taskIds.push(r.id);
    return r.id;
  };
  const P1 = await mk("가");
  const P2 = await mk("나");
  const P3 = await mk("다");
  const K1 = await mk("가-1", P1);
  const K2 = await mk("가-2", P1);

  // ── 새 업무는 맨 뒤에 붙는다 (C-a 후속 조치) ─────────────────────
  const created = await sql(
    `SELECT id, sort_order FROM task WHERE id = ANY($1::int[]) AND parent_task_id IS NULL ORDER BY sort_order`,
    [[P1, P2, P3]]);
  chk("C-a 새업무는맨뒤",
    created.map((r) => r.id).join() === [P1, P2, P3].join()
      && created.every((r) => r.sort_order > 0)
      && created[0].sort_order < created[1].sort_order && created[1].sort_order < created[2].sort_order,
    `만든 순서대로 sort_order 가 커진다 — ${created.map((r) => `#${r.id}:${r.sort_order}`).join(" · ")} ` +
    `(예전에는 전부 0 이라 새것이 맨 앞에 몰렸다)`);

  // ── §C1 정렬이 "직접 정한 순서" 일 때만 핸들 ─────────────────────
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const gripOff = await page.locator("tbody .dgrip").count();
  const hint = await page.locator(".dragoff").innerText().catch(() => "(없음)");
  await page.selectOption('select[aria-label="정렬 기준"]', "manual");
  await page.waitForTimeout(1400);
  const gripOn = await page.locator("tbody .dgrip").count();
  const hintGone = await page.locator(".dragoff").count();
  await page.screenshot({ path: `${OUT}/C1-핸들.png` });
  chk("C1-핸들은수동일때만",
    gripOff === 0 && hint.includes("직접 정한 순서") && gripOn > 0 && hintGone === 0,
    `기한순일 때 핸들 ${gripOff}개(0이어야) · 안내 "${hint}" · ` +
    `"직접 정한 순서" 로 바꾸니 핸들 ${gripOn}개 · 안내 ${hintGone}개`);

  // 핸들은 hover/포커스에서만 보인다 — 존재하지만 그려지지 않는다.
  const gripEl = page.locator("tbody tr", { hasText: `${MARK} 가` }).first().locator(".dgrip");
  const gripIdle = await gripEl.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { opacity: cs.opacity, display: cs.display };
  });
  await gripEl.focus();
  const gripFocused = await gripEl.evaluate((el) => ({
    opacity: getComputedStyle(el).opacity, isActive: document.activeElement === el,
  }));
  // 짝이 되는 존재 단언 — 안 보이는 것과 **닿을 수 없는 것**은 다르다.
  //   display:none 으로 숨기면 탭 순서에서 빠져 키보드로 영영 못 잡는다.
  chk("C2-보이지않되닿을수있다",
    gripIdle.opacity === "0" && gripIdle.display !== "none"
      && gripFocused.opacity === "1" && gripFocused.isActive,
    `평상시 opacity=${gripIdle.opacity} display=${gripIdle.display}(none 이면 안 된다) · ` +
    `포커스 후 opacity=${gripFocused.opacity} · 실제로 포커스됨=${gripFocused.isActive}`);

  // ── §C 순서 바꾸기 — API 로 저장하고 새로고침해도 남는가 ─────────
  await api("post", "/api/tasks/reorder", { parentTaskId: null, orderedIds: [P3, P1, P2] });
  const afterMove = await sql(
    `SELECT id FROM task WHERE id = ANY($1::int[]) ORDER BY sort_order, id`, [[P1, P2, P3]]);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const rowText = async () =>
    (await page.locator("tbody tr").allInnerTexts()).map((x) => x.replace(/\s+/g, " ").trim());
  const onScreen = (await rowText()).filter((x) => x.includes(MARK) && !x.includes(`${MARK} 가-`));
  chk("C-새로고침해도유지",
    afterMove.map((r) => r.id).join() === [P3, P1, P2].join()
      && onScreen[0].includes("다") && onScreen[1].includes("가") && onScreen[2].includes("나"),
    `DB 순서 ${afterMove.map((r) => `#${r.id}`).join(" → ")} · ` +
    `새로고침 후 화면 [${onScreen.join(" / ")}]`);

  // ── §C3 부모가 다르면 거절한다 ───────────────────────────────────
  const cross = await api("post", "/api/tasks/reorder", { parentTaskId: null, orderedIds: [P1, K1] });
  const crossBody = await cross.json().catch(() => ({}));
  chk("C3-부모섞으면거절", cross.status() === 400 && (crossBody.error ?? "").includes("같은 상위"),
    `HTTP ${cross.status()} · "${crossBody.error ?? "(없음)"}"`);

  // 짝이 되는 존재 단언 — 같은 상위 안의 하위끼리는 통한다.
  const inner = await api("post", "/api/tasks/reorder", { parentTaskId: P1, orderedIds: [K2, K1] });
  const kids = await sql(`SELECT id FROM task WHERE parent_task_id = $1 ORDER BY sort_order, id`, [P1]);
  chk("C3-같은상위안에선통한다", inner.ok() && kids.map((r) => r.id).join() === [K2, K1].join(),
    `HTTP ${inner.status()} · 하위 순서 ${kids.map((r) => `#${r.id}`).join(" → ")} (K2=#${K2} 가 앞)`);

  // ── C-b 상위와 하위가 같은 평면에서 섞이지 않는다 ────────────────
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const caret = page.locator("tbody tr", { hasText: `${MARK} 가` }).first().locator(".sub-cv");
  await caret.waitFor({ timeout: 15000 });
  await caret.click();
  await page.waitForTimeout(700);
  const order = (await rowText()).filter((x) => x.includes(MARK));
  const iParent = order.findIndex((x) => x.includes(`${MARK} 가`) && !x.includes(`${MARK} 가-`));
  const iK1 = order.findIndex((x) => x.includes(`${MARK} 가-1`));
  const iK2 = order.findIndex((x) => x.includes(`${MARK} 가-2`));
  const iOther = order.findIndex((x) => x.includes(`${MARK} 나`) || x.includes(`${MARK} 다`));
  await page.screenshot({ path: `${OUT}/Cb-계층유지.png` });
  chk("C-b 하위는상위를따라온다",
    iParent >= 0 && iK1 > iParent && iK2 > iParent
      && Math.abs(iK1 - iK2) === 1
      && !(iOther > iParent && iOther < Math.max(iK1, iK2)),
    `화면 순서 [${order.join(" / ")}] — 하위는 상위 바로 아래 붙어 있고 ` +
    `다른 상위(#${iOther})가 그 사이에 끼지 않는다`);

  // ── §C2 키보드 이동 ⌥↑ / ⌥↓ ────────────────────────────────────
  // 드래그만 되는 기능은 접근성 이전에 트랙패드에서 불편하다 (§C2).
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  const before = (await sql(
    `SELECT id FROM task WHERE id = ANY($1::int[]) ORDER BY sort_order, id`, [[P1, P2, P3]]))
    .map((r) => r.id);
  const grip = page.locator("tbody tr", { hasText: `${MARK} 다` }).first().locator(".dgrip");
  await grip.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForTimeout(1500);
  const after = (await sql(
    `SELECT id FROM task WHERE id = ANY($1::int[]) ORDER BY sort_order, id`, [[P1, P2, P3]]))
    .map((r) => r.id);
  chk("C2-키보드로한칸",
    before[0] === P3 && after[1] === P3 && before.join() !== after.join(),
    `⌥↓ 한 번 — ${before.map((x) => `#${x}`).join(" → ")} 에서 ` +
    `${after.map((x) => `#${x}`).join(" → ")} 로 (P3=#${P3} 가 한 칸 내려간다)`);

  // ── §C3 필터가 걸려 있어도 전역 순서가 깨지지 않는다 ──────────────
  // 안 보이는 형제(P2)를 사이에 두고, 보이는 둘만 자리를 바꾼다.
  // 서버가 안 보이는 자리를 그대로 두고 보이는 자리에만 새 순서를 끼워 넣어야 한다.
  const seq = (ids) => sql(
    `SELECT id, sort_order FROM task WHERE id = ANY($1::int[]) ORDER BY sort_order, id`, [ids]);
  const full0 = (await seq([P1, P2, P3])).map((r) => r.id);
  const visible = full0.filter((x) => x !== P2);              // P2 는 필터에 걸려 안 보인다고 친다
  await api("post", "/api/tasks/reorder", { parentTaskId: null, orderedIds: [...visible].reverse() });
  const full1 = (await seq([P1, P2, P3])).map((r) => r.id);
  const p2Before = full0.indexOf(P2), p2After = full1.indexOf(P2);
  chk("C3-필터걸려도전역순서유지",
    p2Before === p2After && full1.filter((x) => x !== P2).join() === [...visible].reverse().join(),
    `보이는 것만 뒤집었다 — 전 ${full0.map((x) => `#${x}`).join(" → ")} · ` +
    `후 ${full1.map((x) => `#${x}`).join(" → ")} · ` +
    `안 보이던 #${P2} 의 자리 ${p2Before} → ${p2After} (그대로여야 한다)`);

  // ── §E reduce 에서 FLIP 이 멈추는가 ──────────────────────────────
  const rctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
  await rctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" }]);
  const rpage = await rctx.newPage();
  await rpage.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await rpage.waitForTimeout(1500);
  const rowTrans = await rpage.locator("tbody tr").first()
    .evaluate((el) => getComputedStyle(el).transitionDuration);
  const gripTrans = await rpage.locator("tbody .dgrip").first()
    .evaluate((el) => getComputedStyle(el).transitionDuration).catch(() => "(핸들 없음)");
  await rctx.close();
  chk("E-reduce에서짧아진다",
    rowTrans === "0.12s" || rowTrans === "0s",
    `reduce 에서 행 transition ${rowTrans} (--dur-1 0.12s 로 줄거나 0) · 핸들 ${gripTrans}`);

  console.log(`\nJS 오류 ${errs.length}건${errs.length ? " — " + errs.join(" / ") : ""}`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/reorder-walk.json`, JSON.stringify(rows, null, 2));
} finally {
  if (made.taskIds.length) {
    await sql(`UPDATE task SET parent_task_id = NULL, blocked_by = NULL WHERE id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [made.taskIds]);
    await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [made.taskIds]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE $1`, [`%${MARK}%`]);
  console.log(`정리 — 업무 ${made.taskIds.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
