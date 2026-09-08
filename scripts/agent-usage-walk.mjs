// 에이전트 흔적 집계 화면 실측 (MD-P-2026-038 §B-1).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
//
// 이 화면의 약속은 두 개다.
//   ⓐ 관리자만 본다
//   ⓑ **읽기만 한다** — 지우는 자리가 하나도 없다
// 둘 다 「그렇게 짰다」가 아니라 화면에서 읽어서 확인한다.
//
//   ① 팀장은 화면에 못 들어간다 (관리자 ⊋ 팀장 — 등급이 포함 관계라도 여긴 관리자뿐)
//   ② 팀장은 API 에서 403
//   ③ 관리자는 표를 본다 — 6줄
//   ④ 화면 숫자 = DB 숫자 (여섯 줄 모두 대조)
//   ⑤ 숫자 옆 「무엇인가」가 여섯 줄 다 비어 있지 않다
//   ⑥ **지우는 자리가 없다** — 버튼·form·삭제 문구 0개
//   ⑦ 목록 행 수 = 건수 (에이전트 업무 · 초안)
//   ⑧ 라우트 소스에 DELETE·UPDATE·INSERT 가 없다
//   ⑨ 역할을 **시작 전 지문 그대로** 되돌린다 (절대값이 아니라 대조 · §G)
//   ⑩ 콘솔 오류 0
//
// 검사를 하려면 관리자가 있어야 하는데 로컬 시드에는 없다. 그래서 만든다 —
// 다만 **조건은 관측보다 먼저 만들고**(§G), 끝나면 시작 전 지문과 글자 그대로
// 맞춰 되돌린다. 절대값 「admin 0명」을 기대하지 않는다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("agent-usage-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-038/agent-usage";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(22)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(22)} ${n}`); } };

const ADMIN_ID = 1;                // 권정혁 — 잠깐 올렸다 되돌린다
const LEAD_ID = 7;                 // ROBODYNE 관리자 — 팀장 짝

let browser, roleBefore = null;
try {
  // ── 시작 전 지문 ─────────────────────────────────────────────────
  // 「admin 이 0명이어야 한다」가 아니라 **시작 전 값과 대조한다**(§G).
  const fp = async () => (await sql(
    `SELECT a.actor_id, ac.display_name, a.role FROM account a
       JOIN actor ac ON ac.id = a.actor_id ORDER BY a.actor_id`))
    .map((r) => `${r.actor_id}:${r.display_name}:${r.role}`).join(" | ");
  const before = await fp();
  console.log(`   (시작 전) ${before}`);

  const [{ role: origRole }] = await sql(`SELECT role FROM account WHERE actor_id = $1`, [ADMIN_ID]);
  roleBefore = origRole;
  const [{ role: leadRole }] = await sql(`SELECT role FROM account WHERE actor_id = $1`, [LEAD_ID]);
  // 짝이 뜻을 가지려면 **정말 팀장이어야** 한다. 아니면 ①②는 아무것도 증명 못 한다.
  chk("0-짝조건", leadRole === "lead", `${LEAD_ID}번 역할 = ${leadRole} (팀장이라야 ①② 가 뜻을 가진다)`);

  await sql(`UPDATE account SET role = 'admin' WHERE actor_id = $1`, [ADMIN_ID]);
  console.log(`   (조건) ${ADMIN_ID}번을 ${origRole} → admin 으로 올렸다 — 끝나면 되돌린다`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const host = new URL(BASE).hostname;
  const mk = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    await ctx.addCookies([{ name: "tb_session", value: tok(u), domain: host, path: "/" }]);
    return ctx;
  };

  // ══ ①② 팀장 짝 ══════════════════════════════════════════════════
  const leadCtx = await mk({ id: LEAD_ID, actorId: LEAD_ID, name: "ROBODYNE 관리자", role: "lead", email: "l@l" });
  const leadPage = await leadCtx.newPage();
  await leadPage.goto(`${BASE}/admin/agent-usage`, { waitUntil: "networkidle" });
  await leadPage.waitForTimeout(600);
  const leadUrl = new URL(leadPage.url()).pathname;
  chk("①-팀장은-못본다", leadUrl !== "/admin/agent-usage", `팀장이 열면 → ${leadUrl}`);

  // 막았으면 **보이지도 않아야** 한다 — 보이면 눌린다(§G).
  // 「구성원」도 같이 본다. 화면은 `isAdmin` 인데 사이드바는 `hasLead` 로 그려서
  // 팀장이 누르면 이유 없이 튕겼다. 그 짝을 여기서 잠근다.
  await leadPage.locator(".grp").last().evaluate((el) => el.setAttribute("open", ""));
  const leadNav = await leadPage.locator(".grp").last().innerText();
  chk("①짝-팀장은-링크도-없다",
      !leadNav.includes("에이전트 흔적") && !leadNav.includes("구성원"),
      `팀장의 「관리」 = ${leadNav.split("\n").filter(Boolean).join(" · ")}`);

  const leadApi = await leadPage.evaluate(async () => {
    const r = await fetch("/api/admin/agent-usage");
    return { status: r.status, body: await r.json().catch(() => null) };
  });
  chk("②-팀장은-403", leadApi.status === 403, `API ${leadApi.status} · ${leadApi.body?.error ?? "—"}`);
  await leadCtx.close();

  // ══ ③~⑦ 관리자 ═══════════════════════════════════════════════════
  const ctx = await mk({ id: ADMIN_ID, actorId: ADMIN_ID, name: "권정혁", role: "admin", email: "a@a" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const reqs = []; page.on("request", (r) => reqs.push({ method: r.method(), url: r.url() }));
  await page.goto(`${BASE}/admin/agent-usage`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.locator(".frn-skip").first().click({ timeout: 2000 })
    .catch(() => console.log("   (첫 실행 안내 없음 — 닫을 것이 없다)"));
  await page.locator(".au-t").first().waitFor({ timeout: 8000 });

  const head = page.locator(".au-t").first();
  const rows = head.locator("tbody tr");
  chk("③-여섯줄", await rows.count() === 6, `집계 표 ${await rows.count()}줄`);

  // ④ 화면 ↔ DB. 한 값만 맞춰 보면 「셌다」와 「세다가 빠뜨렸다」가 안 갈린다(§G) —
  //   여섯 줄을 **다** 대조한다.
  const [db] = await sql(
    `SELECT (SELECT count(*)::int FROM actor WHERE type='agent')        AS a,
            (SELECT count(*)::int FROM agent_config)                    AS b,
            (SELECT count(*)::int FROM agent_job)                       AS c,
            (SELECT count(*)::int FROM drafts)                          AS d,
            (SELECT count(*)::int FROM task WHERE origin='agent')       AS e,
            (SELECT count(*)::int FROM task WHERE status='proposed')    AS f`);
  const want = [db.a, db.b, db.c, db.d, db.e, db.f];
  const seen = [], whats = [];
  for (let i = 0; i < 6; i++) {
    const tds = rows.nth(i).locator("td");
    seen.push(Number((await tds.nth(1).innerText()).trim()));
    whats.push((await tds.nth(2).innerText()).trim());
  }
  chk("④-화면=DB", seen.join(",") === want.join(","), `화면 [${seen}] · DB [${want}]`);
  chk("⑤-무엇인가", whats.every((w) => w.length > 3 && w !== "—"),
      `여섯 줄 모두 설명이 있다 — 예: "${whats[4]}"`);

  // ⑥ 지우는 자리가 없다 — **조작 요소 0개 + 오간 요청이 전부 GET**.
  //
  //   처음엔 화면 글에서 "삭제·지우·철거" 를 찾게 했다. 그때 몰랐던 것: 이 화면의
  //   안내문이 바로 "**철거** 전에 세어 두는 값입니다 · **지우**는 버튼은 없습니다"
  //   다. 안 지운다는 안내가 지운다는 증거로 잡혔다. 낱말로 종류를 판정하면
  //   이렇게 된다(§G). 그래서 낱말이 아니라 **실제로 무엇이 오갔는지**를 본다.
  const btns = await page.locator(".au button, .au form, .au input, .au select").count();
  const wrote = reqs.filter((r) => r.method !== "GET" && new URL(r.url).origin === new URL(BASE).origin);
  chk("⑥-지우는자리-없다", btns === 0 && wrote.length === 0,
      `조작 요소 ${btns}개 · 오간 요청 ${reqs.length}건 전부 GET${wrote.length ? ` (아님: ${wrote.map((r) => r.method + " " + r.url)})` : ""}`);

  // ⑦ 목록 행 수 = 건수. 목록이 잘려 나오면 건수만 보고는 모른다.
  const tabs = page.locator(".au-t");
  const nTab = await tabs.count();
  const taskRows = db.e === 0 ? 0 : await tabs.nth(1).locator("tbody tr").count();
  const draftRows = db.d === 0 ? 0 : await tabs.nth(nTab - 1).locator("tbody tr").count();
  chk("⑦-목록=건수", taskRows === db.e && draftRows === db.d,
      `에이전트 업무 ${taskRows}/${db.e} · 초안 ${draftRows}/${db.d}`);

  await page.screenshot({ path: `${OUT}/agent-usage.png`, fullPage: true });

  // ⑧ 소스에 쓰기 경로가 없다 — 화면에 버튼이 없어도 API 가 쓰면 소용없다.
  const src = fs.readFileSync("app/api/admin/agent-usage/route.ts", "utf8")
    .split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  const writes = ["DELETE", "UPDATE", "INSERT", "TRUNCATE", "DROP"].filter((w) => src.includes(w));
  chk("⑧-쓰기경로-없다", writes.length === 0, `라우트에 쓰기 낱말 ${writes.length}개${writes.length ? ` (${writes})` : ""}`);

  // ⑪ 관리자는 **찾아갈 수 있다**. 주소를 알아야만 닿는 화면은 없는 화면이다.
  await page.locator(".grp").last().evaluate((el) => el.setAttribute("open", ""));
  const link = page.locator('.grp a[href="/admin/agent-usage"]');
  chk("⑪-관리자는-찾아간다", await link.count() === 1,
      `사이드바 「관리」에 링크 ${await link.count()}개`);
  await link.first().click();
  await page.waitForURL("**/admin/agent-usage", { timeout: 5000 }).catch(() => {});
  chk("⑪짝-눌러서-도착", new URL(page.url()).pathname === "/admin/agent-usage",
      `눌렀더니 → ${new URL(page.url()).pathname}`);

  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/agent-usage-nav.png`, clip: { x: 0, y: 0, width: 720, height: 1100 } });

  chk("⑩-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  // ══ ⑨ 되돌리기 ═══════════════════════════════════════════════════
  await sql(`UPDATE account SET role = $2 WHERE actor_id = $1`, [ADMIN_ID, roleBefore]);
  roleBefore = null;
  const after = await fp();
  chk("⑨-시작전과-같다", after === before, after === before ? "지문 일치" : `\n     전 ${before}\n     후 ${after}`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} finally {
  // 검사가 중간에 죽어도 역할은 되돌린다 — 남겨 두면 다음 검사의 「시작 전」이 오염된다.
  if (roleBefore !== null) {
    await pool.query(`UPDATE account SET role = $2 WHERE actor_id = $1`, [ADMIN_ID, roleBefore])
      .catch((e) => console.error("역할 되돌리기 실패 —", e.message));
    console.log(`   (정리) ${ADMIN_ID}번 역할을 ${roleBefore} 로 되돌렸다`);
  }
  await browser?.close();
  await pool.end();
}
