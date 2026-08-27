// `/status` 담당자 줄 (MD-P-2026-031 §C 회신 1-1).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32). 만든 것만 지운다.
//
// 무엇을 보는가.
//   자기점검 이 검사가 쓰는 선택자가 전부 살아 있다
//   ① 머리줄이 문서대로 다섯이다 — 담당자 · 진행 중 · 지연 · 이번 주 · 막고 있는 것
//   ② 「평균 진척」이 화면 어디에도 없다. **짝** — 남아야 할 머리글은 그대로 있다
//   ③ 「담당자별 부하」(옛 블록)도 없다
//   ④ **「막고 있는 것」이 실제로 센다** — 차단 관계를 만들어 before/after 를 잰다.
//      시드에는 남을 막는 업무가 0건이라, 안 만들면 이 열은 **한 번도 밟히지 않는다.**
//      「밟히지 않은 분기는 통과가 아니라 미검사다」(§G).
//   ⑤ 자기 것끼리는 안 센다 — 같은 담당끼리 막아도 숫자가 안 오른다
//   ⑥ 지연과 이번 주가 **겹치지 않는다** — 둘의 합이 진행 중을 넘지 않는다
//   ⑦ 0 은 「—」로 적힌다. **짝** — 0 이 아닌 값은 숫자로 적힌다
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("status-assignee-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const one = async (t, p = []) => (await sql(t, p))[0] ?? null;
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(14)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(14)} ${n}`); };

let browser, made = [];
try {
  const people = await sql(`SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
                             WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 2`);
  if (people.length < 2) throw new Error("사람이 둘 이상 있어야 「자기 것끼리는 안 센다」를 잴 수 있다");
  const [lead, other] = people;

  const areaId = (await one(`SELECT id FROM area WHERE is_active AND kind='workspace' ORDER BY sort_order, id LIMIT 1`)).id;
  const mk = async (title, assignee) => {
    const r = await one(
      `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, is_demo)
       VALUES ($2, 'doing', 0, $1, $3, 'team', $4, true) RETURNING id`, [lead.id, title, assignee, areaId]);
    made.push(r.id);
    return r.id;
  };

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") jsErrors.push(m.text().slice(0, 160)); });

  /** `/status` 를 다시 읽고 담당자별 숫자를 이름으로 뽑는다. */
  const read = async () => {
    await page.goto(`${BASE}/status`, { waitUntil: "networkidle" });
    const frn = page.locator(".frn-skip");
    if (await frn.count()) { await frn.first().click(); await page.locator(".frn-bg").waitFor({ state: "detached", timeout: 5000 }); }
    await page.waitForSelector(".as-tbl", { timeout: 10000 });
    const list = await page.$$eval(".as-row.click", (rs) => rs.map((r) => {
      const c = [...r.children].map((x) => x.textContent.trim());
      const n = (v) => (v === "—" ? 0 : Number(v));
      return { name: c[0], doing: n(c[1]), late: n(c[2]), thisWeek: n(c[3]), blocking: n(c[4]), raw: c };
    }));
    return new Map(list.map((r) => [r.name, r]));
  };

  let m = await read();

  // ── 자기 점검 ─────────────────────────────────────────────
  const probes = {
    ".as-tbl": await page.locator(".as-tbl").count(),
    ".as-head > span": await page.locator(".as-head > span").count(),
    ".as-row.click": await page.locator(".as-row.click").count(),
  };
  const dead = Object.entries(probes).filter(([, n]) => n === 0).map(([k]) => k);
  dead.length === 0
    ? ok("자기점검", Object.entries(probes).map(([k, n]) => `${k}=${n}`).join(" · "))
    : bad("자기점검", `죽은 선택자 ${dead.join(", ")} — 아래 판정은 증거가 아니다`);

  // ── ① 머리줄 ─────────────────────────────────────────────
  const head = await page.$$eval(".as-head > span", (e) => e.map((x) => x.textContent.trim()));
  const want = ["담당자", "진행 중", "지연", "이번 주", "막고 있는 것"];
  JSON.stringify(head) === JSON.stringify(want)
    ? ok("①머리줄", head.join(" · "))
    : bad("①머리줄", `문서와 다르다 — 있는 것: ${head.join(" · ") || "(없음)"} / 문서: ${want.join(" · ")}`);

  // ── ② 「평균 진척」 부재 + 짝 ────────────────────────────
  const avg = await page.getByText("평균 진척").count();
  if (head.length === 0) bad("②평균진척", "짝이 깨졌다 — 머리줄이 통째로 비었다. 부재를 근거로 쓸 수 없다");
  else if (avg > 0) bad("②평균진척", `「평균 진척」이 아직 ${avg}곳에 있다`);
  else ok("②평균진척", `「평균 진척」 0곳 (짝: 머리글 ${head.length}개는 그대로 있다)`);

  // ── ③ 옛 「담당자별 부하」 블록 ──────────────────────────
  const load = await page.getByText("담당자별 부하").count();
  load === 0 ? ok("③옛블록", "「담당자별 부하」 0곳 — 사람별 블록이 하나뿐이다")
             : bad("③옛블록", `「담당자별 부하」가 아직 ${load}곳에 있다 — 사람별 블록이 둘이다`);

  // ── ④ 「막고 있는 것」이 실제로 센다 ────────────────────
  const before = m.get(lead.display_name)?.blocking;
  const cause = await mk("[검사] 남을 막는 원인 업무", lead.id);
  const victim = await mk("[검사] 막혀 있는 남의 업무", other.id);
  await sql(`UPDATE task SET blocked = true, blocked_by = $1 WHERE id = $2`, [cause, victim]);
  m = await read();
  const after = m.get(lead.display_name)?.blocking;
  if (before === undefined || after === undefined) bad("④막고있음", `담당자 줄에 "${lead.display_name}" 가 없다`);
  else if (after !== before + 1)
    bad("④막고있음", `차단 관계를 하나 만들었는데 숫자가 안 올랐다 — ${before} → ${after} (1 올라야 한다)`);
  else ok("④막고있음", `차단 1건 만드니 "${lead.display_name}" 막고 있는 것 ${before} → ${after}`);

  // ── ⑤ 자기 것끼리는 안 센다 ────────────────────────────
  const mine = await mk("[검사] 내가 내 것을 막는다", lead.id);
  await sql(`UPDATE task SET blocked = true, blocked_by = $1 WHERE id = $2`, [cause, mine]);
  m = await read();
  const same = m.get(lead.display_name)?.blocking;
  same === after
    ? ok("⑤자기것제외", `같은 담당끼리 막아도 그대로 ${same} — 남을 막는 것만 센다`)
    : bad("⑤자기것제외", `자기 업무를 막았는데 숫자가 올랐다 — ${after} → ${same}`);

  // ── ⑥ 지연과 이번 주가 안 겹친다 ───────────────────────
  const over = [...m.values()].filter((r) => r.late + r.thisWeek > r.doing);
  over.length === 0
    ? ok("⑥안겹침", `모든 줄에서 지연+이번 주 ≤ 진행 중 (${[...m.values()].map((r) => `${r.name} ${r.late}+${r.thisWeek}≤${r.doing}`).join(" · ")})`)
    : bad("⑥안겹침", `같은 업무가 두 칸에서 세어진다 — ${over.map((r) => `${r.name} ${r.late}+${r.thisWeek}>${r.doing}`).join(" · ")}`);

  // ── ⑦ 0 은 「—」 + 짝 ──────────────────────────────────
  const cells = await page.$$eval(".as-row.click > span:not(.as-name)", (e) => e.map((x) => x.textContent.trim()));
  const zeros = cells.filter((c) => c === "—");
  const nums = cells.filter((c) => /^\d+$/.test(c));
  if (nums.length === 0) bad("⑦0표기", `짝이 깨졌다 — 숫자로 적힌 칸이 하나도 없다 (전부 "—" 면 데이터가 없는 것이다)`);
  else if (cells.some((c) => c === "0")) bad("⑦0표기", `0 이 숫자로 적힌 칸이 있다 — ${cells.join(", ")}`);
  else ok("⑦0표기", `빈 칸 ${zeros.length}개는 「—」 · 값 있는 칸 ${nums.length}개는 숫자 (0 으로 적힌 칸 0개)`);

  jsErrors.length === 0 ? ok("JS오류", "0건") : bad("JS오류", `${jsErrors.length}건 — ${jsErrors[0]}`);
} catch (e) {
  console.log(String(e && e.stack ? e.stack : e));
  bad("예외", String(e && e.message ? e.message.split("\n")[0] : e));
} finally {
  if (browser) { try { await browser.close(); } catch (e) { console.log(`   브라우저 종료 실패: ${e}`); } }
  const tidy = async (label, text, params) => {
    try { await sql(text, params); }
    catch (e) { console.log(`   정리 실패 ${label}: ${String(e && e.message ? e.message : e)} — 손으로 지워야 한다`); }
  };
  // 차단 참조를 먼저 끊는다 — 원인 업무를 먼저 지우면 FK 가 막는다.
  if (made.length) await tidy("blocked_by", `UPDATE task SET blocked = false, blocked_by = NULL WHERE blocked_by = ANY($1::int[])`, [made]);
  for (const id of made) {
    await tidy("goal_task", `DELETE FROM goal_task WHERE task_id=$1`, [id]);
    await tidy("activity_log", `DELETE FROM activity_log WHERE task_id=$1`, [id]);
    await tidy("task", `DELETE FROM task WHERE id=$1`, [id]);
  }
  try { await pool.end(); } catch { /* 종료 경로 */ }
  const f = rows.filter((r) => r.pass === false).length;
  const p = rows.filter((r) => r.pass === true).length;
  console.log(`\n결과 ${p}/${p + f} 통과`);
  if (rows.length === 0) { console.error("측정된 줄이 0건이다 — 서버가 떠 있는지 확인하라"); process.exit(2); }
  process.exit(f ? 1 : 0);
}
