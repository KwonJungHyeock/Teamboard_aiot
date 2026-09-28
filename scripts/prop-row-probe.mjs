// 속성 줄의 겹친 버튼 — 재고, 고친 뒤 지킨다 (MD-P-2026-063 §A-2 · 064 §A-3).
//
// ── 어디서 왔는가 ────────────────────────────────────────────────
//
// 063 에서는 **끄기 전에 재는** 도구였다. 「감싸기를 끄면 무엇을 잃는가」를 물었고,
// 답이 「폭의 2/3 와 자판 경로」였다. 그래서 끄지 않고 멈췄다.
// 064 에서 B-15(031 §E3)와 같은 짜임으로 고쳤고, 이제 이 파일이 **그때 잰 값을
// 지키는 검사**가 된다. 새 프로브를 만들지 않는다 — 잰 사람이 지킨다.
//
// ── 무엇을 보는가 ───────────────────────────────────────────────
//
//   ① 안쪽(값)을 누르면 **이동만** — 두 줄 다 편집기 0개
//      063 에서 「차단」은 이동과 편집이 **같이** 일어났다. 그것이 병이었다.
//   ② 편집 자리를 누르면 편집기 1개 · **폭이 그대로다**
//      063 측정: 상위 업무 294px · 차단 279px. 좁은 손잡이로 바꾸면 고친 게
//      아니라 사람 손이 가던 자리를 옮긴 것이다(§A-2-4).
//   ③ 자판 — 편집 버튼이 초점을 받고 Enter 로 열린다. **탭 차례**를 적는다.
//   ④ 겹침 0 — `.prop-v` 안에 버튼이 없고 콘솔 겹침 경고 0건
//   ⑤ 회귀 잣대 — 안 건드린 줄(「이 업무가 막는 업무」)이 **그대로**다:
//      `span.prop-v.ro` · 버튼 셋. 062 §C-10 에서 이 줄이 증거였다.
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

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

/*
 * 063 이 잰 값. 이보다 좁아지면 손잡이를 옮긴 것이다.
 * 여유는 **1px** 만 둔다(소수점 반올림). 처음엔 8px 을 뒀다가 6px 이 조용히
 * 깎이는 것을 놓칠 뻔했다 — `.prop-v` 의 `gap` 만큼 손잡이가 밀려나 있었다.
 * 「거의 맞다」는 맞는 것이 아니다(061 §B 에서 1px 로 배운 것과 같은 자리).
 */
const WIDTH_063 = { "상위 업무": 294, "차단": 279 };

const MARK = "[064속성]";
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
  page.on("console", (m) => { if (/cannot be a descendant/.test(m.text())) warns.push(m.text().slice(0, 90)); });

  const api = async (method, path, body) => page.request.fetch(`${BASE}${path}`,
    { method, headers: { "Content-Type": "application/json" }, data: body });

  /*
   * ── 조건을 먼저 만든다 ─────────────────────────────────────
   * 상위가 있고, 막혀 있고, **셋을 막는** 업무 하나. ⑤ 가 「버튼 셋」을 묻기
   * 때문에 막히는 쪽을 셋 만든다 — 하나만 만들어 놓고 「셋이어야 한다」를
   * 물으면 검사가 제 조건을 안 만든 것이다.
   */
  const mk = async (n) => {
    const r = await (await api("post", "/api/tasks", { title: `${MARK} ${n}`, areaId: area.id })).json();
    made.push(r.id);
    return r.id;
  };
  const parent = await mk("상위");
  const blocker = await mk("막는 쪽");
  const target = await mk("가운데");
  const victims = [await mk("막히는 쪽 1"), await mk("막히는 쪽 2"), await mk("막히는 쪽 3")];
  await api("patch", `/api/tasks/${target}`, { parentTaskId: parent });
  await api("patch", `/api/tasks/${target}`, { blockedByTaskId: blocker });
  for (const v of victims) await api("patch", `/api/tasks/${v}`, { blockedByTaskId: target });
  console.log(`조건 — 가운데 #${target} (상위 #${parent} · 차단 #${blocker} · 막는 것 ${victims.length}건)\n`);

  const open = async () => {
    await page.goto(`${BASE}/tasks?panel=task:${target}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
  };
  const rowOf = (label) => page.locator(".tdp .prop-row", { has: page.locator(`.prop-l:text-is("${label}")`) }).first();
  const pops = () => page.locator(".tdp .prop-pop").count();

  await open();

  /* ── ① 안쪽을 누르면 이동만 ──────────────────────────────── */
  const inside = {};
  for (const label of ["상위 업무", "차단"]) {
    await open();
    const before = new URL(page.url()).search;
    await rowOf(label).locator(".prop-v .prop-link").first().click({ timeout: 5000 });
    await page.waitForTimeout(900);
    inside[label] = { pops: await pops(), moved: new URL(page.url()).search !== before };
  }
  chk("①-안쪽은-이동만",
      Object.values(inside).every((r) => r.pops === 0 && r.moved),
      Object.entries(inside).map(([k, v]) => `「${k}」 편집기 ${v.pops}개·${v.moved ? "이동함" : "**안 옮겨감**"}`).join(" · ") +
      ` — 063 에서 「차단」은 이동과 편집이 같이 일어났다. 그것이 병이었다`);

  /* ── ② 편집 자리를 누르면 편집기 1개 · 폭이 그대로 ─────────── */
  const edit = {};
  for (const label of ["상위 업무", "차단"]) {
    await open();
    const row = rowOf(label);
    /*
     * 065 — **절대 px 로 묶지 않는다.**
     * 063 의 294px·279px 를 그대로 기준으로 뒀더니, 검사가 만드는 업무의 **번호
     * 자릿수**가 달라지자(#35 → #2136) 값 링크 폭이 변해 2px 이 모자랐다.
     * 데이터에 따라 움직이는 수를 합격선으로 쓰면 언젠가 흔들린다(§G 062 · 064 §D).
     *
     * 물어야 할 것은 「**값이 안 덮은 자리를 손잡이가 다 덮는가**」다.
     * 그건 관계라서 데이터와 무관하다. 063 의 값은 참고로 같이 적는다.
     */
    const geo = await row.locator(".prop-v").evaluate((el) => {
      const wrap = el.getBoundingClientRect();
      const link = el.querySelector(".prop-link")?.getBoundingClientRect();
      const edit = el.querySelector(".prop-edit")?.getBoundingClientRect();
      return { wrap: wrap.width, link: link?.width ?? 0, edit: edit?.width ?? 0 };
    });
    await row.locator(".prop-edit").click({ timeout: 5000 });
    await page.waitForTimeout(700);
    edit[label] = { pops: await pops(), w: Math.round(geo.edit),
                    rest: Math.round(geo.wrap - geo.link), want: WIDTH_063[label] };
  }
  chk("②-편집-자리는-열린다",
      Object.values(edit).every((r) => r.pops === 1),
      Object.entries(edit).map(([k, v]) => `「${k}」 편집기 ${v.pops}개`).join(" · "));
  chk("②짝-값이-안-덮은-자리를-다-덮는다",
      Object.values(edit).every((r) => r.w >= r.rest - 1),
      Object.entries(edit).map(([k, v]) =>
        `「${k}」 손잡이 ${v.w}px / 값이 안 덮은 폭 ${v.rest}px (063 측정 ${v.want}px)`).join(" · ") +
      ` — 좁아지면 고친 게 아니라 사람 손이 가던 자리를 옮긴 것이다`);

  /* ── ③ 자판 ─────────────────────────────────────────────── */
  const keys = {};
  for (const label of ["상위 업무", "차단"]) {
    await open();
    const row = rowOf(label);
    // 탭 차례는 tabindex 를 안 쓰므로 **DOM 차례**가 곧 탭 차례다. 그대로 읽는다.
    const order = await row.locator(".prop-v").evaluate((el) =>
      [...el.querySelectorAll("button, a, [tabindex]")]
        .map((n) => n.className.split(" ").find((c) => c.startsWith("prop-")) ?? n.tagName.toLowerCase()));
    const got = await row.locator(".prop-edit").evaluate((el) => { el.focus(); return document.activeElement === el; });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    keys[label] = { order, got, pops: await pops() };
  }
  chk("③-자판으로도-열린다",
      Object.values(keys).every((r) => r.got && r.pops === 1
        && r.order.length === 2 && r.order[0] === "prop-link" && r.order[1] === "prop-edit"),
      Object.entries(keys).map(([k, v]) =>
        `「${k}」 탭 차례 [${v.order.join(" → ")}] · 초점 ${v.got ? "받음" : "못 받음"} · Enter 로 편집기 ${v.pops}개`).join(" · ") +
      ` — 값이 먼저, 편집이 다음이다`);

  /* ── ④ 겹침 0 ───────────────────────────────────────────── */
  await open();
  const nested = await page.evaluate(() =>
    [...document.querySelectorAll(".tdp .prop-row")].map((row) => {
      const v = row.querySelector(".prop-v");
      if (!v) return 0;
      // 감싸개가 button 이면서 안에 button 이 있는 경우만 겹침이다.
      return v.tagName === "BUTTON" ? v.querySelectorAll("button, a").length : 0;
    }).reduce((a, b) => a + b, 0));
  chk("④-겹침-0", nested === 0 && warns.length === 0,
      `button 안의 button ${nested}개 · 콘솔 겹침 경고 ${warns.length}건${warns.length ? ` [${warns[0]}]` : ""}`);

  /* ── ⑤ 안 건드린 줄은 그대로 ─────────────────────────────── */
  const ro = await rowOf("이 업무가 막는 업무").locator(".prop-v").evaluate((el) => ({
    tag: el.tagName.toLowerCase(), cls: [...el.classList].join("."), btns: el.querySelectorAll("button").length,
  })).catch(() => null);
  chk("⑤-안-건드린-줄은-그대로",
      ro !== null && ro.tag === "span" && ro.cls === "prop-v.ro" && ro.btns === 3,
      ro ? `${ro.tag}.${ro.cls} · 버튼 ${ro.btns}개 (span.prop-v.ro 에 셋이어야 한다)` : "줄이 없다 — 조건을 못 만들었다");

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  if (made.length) {
    await pool.query(`UPDATE task SET blocked_by = NULL, parent_task_id = NULL
                       WHERE blocked_by = ANY($1::int[]) OR parent_task_id = ANY($1::int[])`, [made]);
    await pool.query(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [made]);
    await pool.query(`DELETE FROM task WHERE id = ANY($1::int[])`, [made]);
  }
  const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
  console.log(`뒷정리 — ${MARK} 남은 것 ${left}건 (0이어야 한다)`);
  await browser?.close();
  await pool.end();
}
