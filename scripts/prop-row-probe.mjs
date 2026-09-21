// 겹친 버튼을 **실제로 눌러 본다** (MD-P-2026-063 §A-2).
//
// ── 왜 재는가 ────────────────────────────────────────────────────
//
// §A-1 은 그 두 줄을 `<button>` 으로 감싸지 않게 바꾼다. 그러면 거기서
// `editor` 를 여는 길이 없어진다. **없던 길을 없애는 것과 있던 길을 없애는
// 것은 다르다** — 끄기 전에 지금 무엇이 일어나는지 잰다.
//
// 짐작하면 안 되는 이유가 하나 더 있다. `<button>` 안의 `<button>` 은
// **브라우저 파서가 고쳐 놓는다.** HTML 명세상 button 은 button 을 품을 수
// 없어서, 안쪽이 바깥 밖으로 끌려 나와 형제가 되기도 한다. 그러면 소스의
// 모양과 화면의 모양이 다르다. 그래서 **렌더된 DOM 을 읽고, 실제로 누른다.**
//
// ── 무엇을 재는가 ───────────────────────────────────────────────
//
//   ① 렌더된 DOM 의 모양 — 안쪽 버튼이 정말 바깥 버튼 **안에** 있는가
//   ② 안쪽 버튼을 누르면 — 편집기가 열리는가 / 업무로 가는가 / 둘 다 / 아무것도
//   ③ 바깥에서 안쪽이 **안 덮은 자리**를 누르면 — 편집기가 열리는가
//   ④ 안 켤 줄(「이 업무가 막는 업무」)은 지금 어떤 모양인가 (회귀 잣대)
//
// **로컬 전용** · 만든 것은 지운다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("prop-row-probe.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const MARK = "[063탐침]";
let browser, made = [];
try {
  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name n FROM account a
       JOIN actor ac ON ac.id = a.actor_id
      WHERE (a.role IN ('admin','lead') OR a.admin_grant) AND ac.is_active
      ORDER BY a.actor_id LIMIT 1`))[0];
  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0];

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: me.n, role: me.role, adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const warns = [];
  page.on("console", (m) => { if (/cannot be a descendant/.test(m.text())) warns.push(m.text().slice(0, 80)); });

  const api = async (method, path, body) => page.request.fetch(`${BASE}${path}`,
    { method, headers: { "Content-Type": "application/json" }, data: body });

  // ── 조건을 만든다 — 상위가 있고, 막혀 있고, 남을 막는 업무 ──────
  const mk = async (n) => {
    const r = await (await api("post", "/api/tasks", { title: `${MARK} ${n}`, areaId: area.id })).json();
    made.push(r.id);
    return r.id;
  };
  const parent = await mk("상위");
  const blocker = await mk("막는 쪽");
  const victim = await mk("막히는 쪽");
  const target = await mk("가운데");
  await api("patch", `/api/tasks/${target}`, { parentTaskId: parent });
  await api("patch", `/api/tasks/${target}`, { blockedByTaskId: blocker });
  await api("patch", `/api/tasks/${victim}`, { blockedByTaskId: target });   // target 이 victim 을 막는다
  console.log(`조건 — 가운데 #${target} (상위 #${parent} · 차단 #${blocker} · 이 업무가 막는 것 #${victim})\n`);

  await page.goto(`${BASE}/tasks?panel=task:${target}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  /* ── ① 렌더된 DOM 의 모양 ──────────────────────────────────── */
  const shape = await page.evaluate(() => {
    const out = [];
    for (const row of document.querySelectorAll(".tdp .prop-row")) {
      const label = row.querySelector(".prop-l")?.textContent.trim() ?? "?";
      const v = row.querySelector(".prop-v");
      if (!v) { out.push({ label, wrapper: "(prop-v 없음)" }); continue; }
      const inner = v.querySelectorAll("button, a");
      out.push({
        label,
        wrapper: `${v.tagName.toLowerCase()}.${[...v.classList].join(".")}`,
        // **안쪽이 바깥 안에 있는가** — 파서가 끌어내 놓았으면 0이 된다.
        innerInside: inner.length,
        // 끌려 나갔다면 줄 안에 형제로 남아 있을 것이다.
        innerBeside: [...row.querySelectorAll(":scope > button, :scope > a")].length,
        rowButtons: row.querySelectorAll("button").length,
      });
    }
    return out;
  });
  console.log("── ① 렌더된 모양 ──");
  for (const s of shape)
    console.log(`  ${String(s.label).padEnd(12)} 감싸개 ${String(s.wrapper).padEnd(26)}` +
                ` 안쪽 버튼·링크 ${s.innerInside ?? "-"} · 줄의 형제 ${s.innerBeside ?? "-"} · 줄 전체 버튼 ${s.rowButtons ?? "-"}`);
  console.log(`  겹침 경고 ${warns.length}건\n`);

  /* ── ②③ 눌러 본다 ────────────────────────────────────────── */
  const rowOf = (label) => page.locator(".tdp .prop-row", { has: page.locator(`.prop-l:text-is("${label}")`) }).first();
  const press = async (label, where) => {
    await page.goto(`${BASE}/tasks?panel=task:${target}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const row = rowOf(label);
    const before = new URL(page.url()).search;
    if (where === "안쪽") await row.locator(".prop-v button, .prop-v a").first().click({ timeout: 4000 });
    else {
      // 안쪽이 안 덮은 자리 — 감싸개의 **오른쪽 끝**을 누른다.
      const box = await row.locator(".prop-v").boundingBox();
      await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2);
    }
    await page.waitForTimeout(900);
    return {
      편집기: await page.locator(".tdp .prop-pop").count(),
      주소: new URL(page.url()).search,
      옮겨감: new URL(page.url()).search !== before,
      열린줄: (await page.locator(".tdp .prop-row.open .prop-l").allInnerTexts()).join(",") || "(없음)",
    };
  };

  console.log("── ②③ 눌러 본 결과 ──");
  for (const label of ["상위 업무", "차단"]) {
    for (const where of ["안쪽", "바깥"]) {
      const r = await press(label, where).catch((e) => ({ 오류: e.message.slice(0, 70) }));
      console.log(`  「${label}」 ${where} 누름 → ` +
        (r.오류 ? `못 눌렀다 (${r.오류})`
         : `편집기 ${r.편집기}개 · 열린 줄 ${r.열린줄} · 주소 "${r.주소}" ${r.옮겨감 ? "(옮겨감)" : "(그대로)"}`));
    }
  }

  /* ── ③짝 얼마나 남는가 · 자판으로도 되는가 ─────────────────
   *
   * 「바깥을 누르면 열린다」만으로는 모자라다. 안쪽 버튼이 감싸개를 거의 다
   * 덮고 있으면 그 길은 **있지만 닿기 어려운** 길이다. 남는 폭을 잰다.
   * 그리고 감싸개가 `<button>` 이라 자판으로도 닿는다 — Tab 으로 가서
   * Enter 를 눌러 본다. 손이 아니라 자판만 쓰는 사람에게도 길인지를 묻는다.
   */
  console.log("\n── ③짝 남는 폭과 자판 ──");
  for (const label of ["상위 업무", "차단"]) {
    await page.goto(`${BASE}/tasks?panel=task:${target}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const row = rowOf(label);
    const wrap = await row.locator(".prop-v").boundingBox();
    const inner = await row.locator(".prop-v button, .prop-v a").first().boundingBox();
    const byKey = await row.locator(".prop-v").evaluate((el) => {
      el.focus();
      const got = document.activeElement === el;
      el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      el.click();                                    // 자판의 Enter 는 button 에서 click 으로 바뀐다
      return got;
    });
    await page.waitForTimeout(700);
    const opened = await page.locator(".tdp .prop-pop").count();
    console.log(`  「${label}」 감싸개 폭 ${Math.round(wrap.width)}px · 안쪽 ${Math.round(inner.width)}px` +
      ` → 안 덮인 폭 ${Math.round(wrap.width - inner.width)}px` +
      ` · 자판 초점 ${byKey ? "받음" : "못 받음"} · Enter 로 편집기 ${opened}개`);
  }

  /* ── ④ 안 켤 줄 — 회귀 잣대 ──────────────────────────────── */
  const ro = shape.find((s) => s.label === "이 업무가 막는 업무");
  console.log(`\n── ④ 안 켤 줄 (062 §C-10 의 증거) ──`);
  console.log(`  ${ro ? `감싸개 ${ro.wrapper} · 안쪽 버튼 ${ro.innerInside}개` : "줄이 없다 — 조건을 못 만들었다"}`);
} finally {
  if (made.length) {
    await pool.query(`UPDATE task SET blocked_by = NULL, parent_task_id = NULL WHERE blocked_by = ANY($1::int[]) OR parent_task_id = ANY($1::int[])`, [made]);
    await pool.query(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [made]);
    await pool.query(`DELETE FROM task WHERE id = ANY($1::int[])`, [made]);
  }
  const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
  console.log(`\n뒷정리 — ${MARK} 남은 것 ${left}건 (0이어야 한다)`);
  await browser?.close();
  await pool.end();
}
