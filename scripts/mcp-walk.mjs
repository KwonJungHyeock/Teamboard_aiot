// Claude 연결(0040 · /api/mcp) — 키로 들어온 Claude 가 **그 사람으로서만** 적고 읽고 고친다.
//
//   node scripts/mcp-walk.mjs            재기만 한다
//   SHOT=1 node scripts/mcp-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 키 — 만들면 한 번만 돌려준다 · 목록에는 앞 글자만 · DB 에는 키 원문이 없다
//   ② 문 — 키 없음 · 틀린 키는 401 · initialize · tools/list(9개) · 알림은 202
//   ③ 내 기록 — add_worklog(#카테고리) → list_worklog 에 보인다 → update_worklog 로 고친다
//   ④ 내 업무 — create_task → list_my_tasks → update_task(완료 · 제목) · 활동 기록에 「(Claude)」
//   ⑤ 남의 것 — 남의 개인 업무 get/update · 남의 기록 update 가 실패한다(화면과 같은 규칙)
//   ⑥ 오늘 한 줄 — set_today 가 관제 한 줄 · 상태를 정한다
//   ⑦ 끊기 — 끊은 키는 바로 401 · 남의 키는 못 끊는다(404)
//   ⑧ 화면 — 내 정보에 「Claude 연결」 · 키를 만들면 Claude Code 명령과 데스크톱 설정이 뜬다 · 콘솔 오류 0
//
// **로컬 전용.** 이름이 「[검사]」로 시작하는 키 · 업무, 본문에 「[검사]」가 든 기록, 두 사람의 오늘 한 줄만 되돌린다.
import { chromium } from "playwright";
import { createHmac, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("mcp-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/mcp";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const MARK = "[검사]";
let browser, ids = [], today = "", dailyBefore = [];
const cleanup = async () => {
  await sql(`DELETE FROM api_token WHERE name LIKE $1 || '%'`, [MARK]);
  await sql(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]);
  await sql(`DELETE FROM task WHERE title LIKE $1 || '%'`, [MARK]);
  if (ids.length) {
    await sql(`DELETE FROM work_log WHERE owner_actor_id = ANY($1) AND body LIKE '%' || $2 || '%'`, [ids, MARK]);
    await sql(`DELETE FROM work_log_category c WHERE c.owner_actor_id = ANY($1) AND c.name = '검사연동'
                 AND NOT EXISTS (SELECT 1 FROM work_log w WHERE w.category_id = c.id)`, [ids]);
  }
};

try {
  const people = await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active ORDER BY (a.role IN ('admin','lead')) DESC, a.actor_id LIMIT 2`);
  if (people.length < 2) throw new Error("활성 계정이 둘 필요하다");
  const [me, other] = people;
  ids = [me.id, other.id];
  today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  dailyBefore = await sql(`SELECT actor_id, line, state FROM daily_note WHERE day = $1::date AND actor_id = ANY($2)`, [today, ids]);
  await cleanup();

  const cookie = (u) => `tb_session=${tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" })}`;
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: cookie(u), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  let rid = 0;
  const rpc = async (key, method, params, notify = false) => {
    const r = await fetch(`${BASE}/api/mcp`, { method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", method, ...(notify ? {} : { id: ++rid }), ...(params ? { params } : {}) }) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const tool = async (key, name, args) => {
    const r = await rpc(key, "tools/call", { name, arguments: args });
    return { status: r.status, text: r.data?.result?.content?.[0]?.text ?? JSON.stringify(r.data), isError: !!r.data?.result?.isError };
  };

  // ── ① 키 ─────────────────────────────────────────────────────
  const made = await api(me, "POST", "/api/tokens", { name: `${MARK} 데스크톱` });
  const key = made.data?.token;
  const list = await api(me, "GET", "/api/tokens");
  const row = (await sql(`SELECT token_hash, prefix FROM api_token WHERE id = $1`, [made.data?.id]))[0];
  const listed = (list.data?.tokens ?? []).find((t) => t.id === made.data?.id);
  chk("①-키", made.status === 200 && /^tbk_/.test(key ?? "") && listed && !JSON.stringify(list.data).includes(key)
      && row?.token_hash === createHash("sha256").update(key).digest("hex") && row.token_hash !== key,
      `만들기 ${made.status} · 목록에 앞 글자 ${listed?.prefix} · 목록에 원문 ${JSON.stringify(list.data).includes(key ?? "x") ? "있음" : "없음"} · DB 는 해시`);

  // ── ② 문 ─────────────────────────────────────────────────────
  const noKey = await rpc(null, "initialize", {});
  const badKey = await rpc("tbk_" + "x".repeat(43), "initialize", {});
  const init = await rpc(key, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "walk", version: "0" } });
  const note = await rpc(key, "notifications/initialized", undefined, true);
  const tl = await rpc(key, "tools/list", {});
  const names = (tl.data?.result?.tools ?? []).map((t) => t.name);
  chk("②-문", noKey.status === 401 && badKey.status === 401 && init.data?.result?.protocolVersion === "2025-06-18"
      && note.status === 202 && names.length === 9,
      `키 없음 ${noKey.status} · 틀린 키 ${badKey.status} · initialize ${init.data?.result?.serverInfo?.name} · 알림 ${note.status} · 도구 [${names.join(",")}]`);

  // ── ③ 내 기록 ─────────────────────────────────────────────────
  const a1 = await tool(key, "add_worklog", { body: `#검사연동 ${MARK} 학생 페이지 로그인 마무리` });
  const wl = await tool(key, "list_worklog", { query: "학생 페이지" });
  const wid = Number((a1.text.match(/#(\d+)/) ?? [])[1]);
  const u1 = await tool(key, "update_worklog", { id: wid, body: `${MARK} 학생 페이지 로그인 · 비밀번호 찾기까지` });
  const wrow = (await sql(`SELECT w.body, c.name FROM work_log w LEFT JOIN work_log_category c ON c.id = w.category_id WHERE w.id = $1 AND w.owner_actor_id = $2`, [wid, me.id]))[0];
  chk("③-내-기록", !a1.isError && wl.text.includes(`#${wid}`) && wl.text.includes("[검사연동]") && !u1.isError
      && wrow?.body.includes("비밀번호 찾기까지"),
      `남김 "${a1.text.slice(0, 60)}" · 목록에 #${wid} ${wl.text.includes(`#${wid}`)} · 고친 뒤 "${wrow?.body}"`);

  // ── ④ 내 업무 ─────────────────────────────────────────────────
  const c1 = await tool(key, "create_task", { title: `${MARK} 덱 빌더 업로드 한도 반영`, due_date: today });
  const tid = Number((c1.text.match(/#(\d+)/) ?? [])[1]);
  const lt = await tool(key, "list_my_tasks", { query: "덱 빌더 업로드" });
  const u2 = await tool(key, "update_task", { id: tid, status: "done", title: `${MARK} 덱 빌더 업로드 한도 100MB 반영` });
  const g = await tool(key, "get_task", { id: tid });
  const trow = (await sql(`SELECT status, title, assignee_id FROM task WHERE id = $1`, [tid]))[0];
  const act = await sql(`SELECT message FROM activity_log WHERE task_id = $1 ORDER BY id DESC`, [tid]);
  chk("④-내-업무", !c1.isError && lt.text.includes(`#${tid}`) && !u2.isError && trow?.status === "done"
      && trow?.assignee_id === me.id && trow?.title.includes("100MB") && g.text.includes("[완료]")
      && act.some((a) => a.message.includes("(Claude)")),
      `만듦 #${tid} · 목록에 ${lt.text.includes(`#${tid}`)} · 상태 ${trow?.status} · 담당 나 ${trow?.assignee_id === me.id} · 활동에 (Claude) ${act.some((a) => a.message.includes("(Claude)"))}`);

  // ── ⑤ 남의 것 ─────────────────────────────────────────────────
  const priv = await api(other, "POST", "/api/tasks", { title: `${MARK} 남의 개인 업무`, visibility: "private" });
  const otherLog = await api(other, "POST", "/api/worklog", { body: `${MARK} 남의 기록` });
  const g2 = await tool(key, "get_task", { id: priv.data?.id });
  const u3 = await tool(key, "update_task", { id: priv.data?.id, title: "바꿔 보기" });
  const u4 = await tool(key, "update_worklog", { id: otherLog.data?.entry?.id, body: "바꿔 보기" });
  const still = (await sql(`SELECT title FROM task WHERE id = $1`, [priv.data?.id]))[0]?.title;
  const stillLog = (await sql(`SELECT body FROM work_log WHERE id = $1`, [otherLog.data?.entry?.id]))[0]?.body;
  chk("⑤-남의-것은-안-된다", priv.status === 200 && g2.isError && u3.isError && u4.isError
      && still === `${MARK} 남의 개인 업무` && stillLog === `${MARK} 남의 기록`,
      `남의 개인 업무 읽기 "${g2.text.slice(0, 40)}" · 고치기 실패 ${u3.isError} · 남의 기록 고치기 실패 ${u4.isError} · 그대로 ${still === `${MARK} 남의 개인 업무` && stillLog === `${MARK} 남의 기록`}`);

  // ── ⑥ 오늘 한 줄 ─────────────────────────────────────────────
  const s1 = await tool(key, "set_today", { line: `${MARK} 업로드 한도 반영`, state: "focus" });
  const d = (await sql(`SELECT line, state FROM daily_note WHERE actor_id = $1 AND day = $2::date`, [me.id, today]))[0];
  chk("⑥-오늘-한-줄", !s1.isError && d?.line === `${MARK} 업로드 한도 반영` && d?.state === "focus", `"${d?.line}" · ${d?.state}`);

  // ── ⑦ 끊기 ───────────────────────────────────────────────────
  const otherRevoke = await api(other, "DELETE", `/api/tokens/${made.data.id}`);
  const stillOk = await rpc(key, "ping", {});
  const rv = await api(me, "DELETE", `/api/tokens/${made.data.id}`);
  const after = await rpc(key, "ping", {});
  chk("⑦-끊기", otherRevoke.status === 404 && stillOk.status === 200 && rv.status === 200 && after.status === 401,
      `남이 끊기 ${otherRevoke.status} · 그 뒤에도 됨 ${stillOk.status} · 내가 끊기 ${rv.status} · 끊은 뒤 ${after.status}`);

  // ── ⑧ 화면 ───────────────────────────────────────────────────
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: me.nm, role: me.role, adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type(); if (t === "error" || t === "warning") errs.push(`[${t}] ${m.text().slice(0, 160)}`); });
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });
  await page.goto(`${BASE}/v3/me`, { waitUntil: "networkidle" });
  await page.locator(".v3-cc-in").fill(`${MARK} 노트북`);
  await page.getByRole("button", { name: "연결 키 만들기" }).click();
  await page.locator(".v3-cc-pre").first().waitFor({ timeout: 9000 });
  const pres = await page.locator(".v3-cc-pre").allInnerTexts();
  await shot(page, { path: `${OUT}/M1-키-만듦.png`, fullPage: true });
  await page.getByRole("button", { name: "다 붙였습니다" }).click();
  await page.waitForTimeout(600);
  const listedUi = await page.locator(".v3-cc-list li").filter({ hasText: `${MARK} 노트북` }).count();
  const shownAgain = (await page.locator("body").innerText()).includes("tbk_") && (await page.locator(".v3-cc-pre").count()) > 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, { path: `${OUT}/M2-좁은화면.png`, fullPage: true });
  chk("⑧-화면", pres.length === 2 && pres[0].startsWith("claude mcp add --transport http") && pres[0].includes("/api/mcp")
      && pres[0].includes("Bearer tbk_") && pres[1].includes("mcp-remote") && listedUi === 1 && !shownAgain && over <= 0,
      `설정 칸 ${pres.length} · Claude Code 명령 ${pres[0]?.slice(0, 40)}… · 목록 ${listedUi} · 닫은 뒤 키 다시 안 보임 ${!shownAgain} · 390px 넘침 ${over}`);
  chk("⑧-콘솔-오류-0", errs.length === 0, errs.length ? errs.slice(0, 3).join(" | ") : "0건");
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  await cleanup().catch((e) => console.log(`정리 실패 ${e.message}`));
  if (ids.length && today) {
    await sql(`DELETE FROM daily_note WHERE day = $1::date AND actor_id = ANY($2)`, [today, ids]).catch(() => {});
    for (const b of dailyBefore)
      await sql(`INSERT INTO daily_note (actor_id, day, line, state) VALUES ($1, $2::date, $3, $4)`, [b.actor_id, today, b.line, b.state]).catch(() => {});
  }
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
