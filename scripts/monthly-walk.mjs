// 월간 보고(개인 · 0042) — 초안 → 고치기 → 내기 → 팀장 확인 · 코멘트. 내기 전에는 나만.
//
//   node scripts/monthly-walk.mjs            재기만 한다
//   SHOT=1 node scripts/monthly-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① AI 초안 — 내 기록 · 끝낸 업무가 들어간다(로컬은 키가 없어 데모 글) · 남의 기록은 안 들어간다
//   ② 쓰는 중에는 팀장 목록에 없다 · 내면 있다 · 팀장 알림함에 「승인 요청」
//   ③ 낸 보고는 못 고친다(409) · 되돌리면 고칠 수 있다
//   ④ 팀장 확인 · 코멘트 → 쓴 사람 알림함에 · 팀원은 확인 못 한다(403)
//   ⑤ 화면 — 내 기록의 링크 → 월간 보고 · 초안 · 저장 · 내기 · 팀장 탭 · 알림에서 그 보고로 · 390px · 콘솔 0
//
// **로컬 전용.** 그 달의 두 사람 보고 · 「[검사]」 기록 · 업무 · 알림만 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("monthly-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/monthly";
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
let browser, ids = [], month = "";
try {
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead || !member) throw new Error("팀장 하나 · 팀원 하나가 필요하다");
  ids = [lead.id, member.id];
  month = (await sql(`SELECT to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM') m`))[0].m;
  const saved = await sql(`SELECT * FROM monthly_report WHERE actor_id = ANY($1) AND month = $2`, [ids, month]);
  if (saved.length) throw new Error(`이 달에 두 사람의 진짜 보고가 있다(${saved.length}건) — 덮지 않으려고 멈춘다`);
  const ck = (u) => tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" });
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: `tb_session=${ck(u)}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  // 조건 — 팀원의 이 달 기록 둘 · 끝낸 업무 하나, 팀장의 기록 하나(새면 안 되는 것)
  await api(member, "POST", "/api/worklog", { body: `#검사보고 ${MARK} 덱 빌더 업로드 나눠 올리기 마무리` });
  await api(member, "POST", "/api/worklog", { body: `${MARK} 학생 페이지 로그인 화면` });
  await api(lead, "POST", "/api/worklog", { body: `${MARK} 팀장만의 비밀 기록` });
  const t = await api(member, "POST", "/api/tasks", { title: `${MARK} 이 달 끝낸 업무` });
  await api(member, "PATCH", `/api/tasks/${t.data?.id}`, { status: "done" });

  // ── ① ─────────────────────────────────────────────────────────
  const d = await api(member, "POST", "/api/monthly", { month, action: "ai" });
  const body = d.data?.mine?.body ?? "";
  chk("①-초안에-내-것만", d.status === 200 && body.includes("덱 빌더 업로드") && body.includes("이 달 끝낸 업무") && !body.includes("팀장만의 비밀"),
      `초안 ${d.status} · 내 기록 ${body.includes("덱 빌더 업로드")} · 끝낸 업무 ${body.includes("이 달 끝낸 업무")} · 남의 기록 ${body.includes("팀장만의 비밀") ? "**들어감**" : "없음"}`);

  // ── ② ─────────────────────────────────────────────────────────
  const before = (await api(lead, "GET", `/api/monthly?m=${month}`)).data?.team ?? [];
  const sub = await api(member, "POST", "/api/monthly", { month, action: "submit" });
  const after = (await api(lead, "GET", `/api/monthly?m=${month}`)).data?.team ?? [];
  const memberTeam = (await api(member, "GET", `/api/monthly?m=${month}`)).data?.team;
  const leadBell = await sql(`SELECT id FROM notification WHERE user_id = $1 AND type = 'approval' AND ref_type = 'monthly_report' AND ref_id = $2`, [lead.id, sub.data?.mine?.id]);
  chk("②-내야-팀장에게", !before.some((r) => r.actorId === member.id) && sub.status === 200 && after.some((r) => r.actorId === member.id)
      && memberTeam === null && leadBell.length === 1,
      `내기 전 팀장 목록 ${before.some((r) => r.actorId === member.id) ? "**있음**" : "없음"} · 낸 뒤 있음 · 팀원에게 팀 목록 ${memberTeam === null ? "없음" : "**있음**"} · 팀장 알림 ${leadBell.length}`);

  // ── ③ ─────────────────────────────────────────────────────────
  const locked = await api(member, "PUT", "/api/monthly", { month, body: "몰래 고치기" });
  const wd = await api(member, "POST", "/api/monthly", { month, action: "withdraw" });
  const edit = await api(member, "PUT", "/api/monthly", { month, body: `${body}\n- 덧붙임` });
  const re = await api(member, "POST", "/api/monthly", { month, action: "submit" });
  chk("③-낸-보고는-잠긴다", locked.status === 409 && wd.status === 200 && edit.status === 200 && re.status === 200,
      `낸 뒤 고치기 ${locked.status} · 되돌리기 ${wd.status} · 고치기 ${edit.status} · 다시 내기 ${re.status}`);

  // ── ④ ─────────────────────────────────────────────────────────
  const rid = re.data?.mine?.id;
  const no = await api(member, "PATCH", `/api/monthly/${rid}`, { comment: "셀프 확인" });
  const ok = await api(lead, "PATCH", `/api/monthly/${rid}`, { comment: "업로드 정리 좋습니다" });
  const mine = (await api(member, "GET", `/api/monthly?m=${month}`)).data?.mine;
  const back = await sql(`SELECT id FROM notification WHERE user_id = $1 AND type = 'reply' AND ref_type = 'monthly_report' AND ref_id = $2`, [member.id, rid]);
  chk("④-팀장-확인·코멘트", no.status === 403 && ok.status === 200 && mine?.leadComment === "업로드 정리 좋습니다" && !!mine?.leadReadAt && back.length === 1,
      `팀원 확인 ${no.status} · 팀장 ${ok.status} · 코멘트 "${mine?.leadComment}" · 쓴 사람 알림 ${back.length}`);

  // ── ⑤ 화면 ───────────────────────────────────────────────────
  await api(member, "POST", "/api/monthly", { month, action: "withdraw" });
  await api(member, "PUT", "/api/monthly", { month, body: "" });
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: ck(member) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const ty = m.type(); if (ty === "error" || ty === "warning") errs.push(`[${ty}] ${m.text().slice(0, 160)}`); });
  page.on("dialog", (dlg) => dlg.accept());
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });
  await page.goto(`${BASE}/v3/log`, { waitUntil: "networkidle" });
  await page.locator(".v3-log-mr").click();
  await page.waitForURL(/\/v3\/report/, { timeout: 9000 });
  await page.getByRole("button", { name: "AI 초안 만들기" }).click();
  await page.waitForFunction(() => (document.querySelector(".v3-mr-in")?.value ?? "").includes("덱 빌더"), null, { timeout: 60000 });
  await page.locator(".v3-mr-in").fill((await page.locator(".v3-mr-in").inputValue()) + "\n- 화면에서 덧붙임");
  await page.getByRole("button", { name: "저장" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "팀장에게 내기" }).click();
  await page.locator(".v3-mr-pill.sent").waitFor({ timeout: 9000 });
  await shot(page, { path: `${OUT}/M1-내-보고.png`, fullPage: true });
  const saved2 = (await sql(`SELECT body, status, id, lead_comment FROM monthly_report WHERE actor_id = $1 AND month = $2`, [member.id, month]))[0];
  const staleComment = await page.locator(".v3-mr-cm").count();

  const lctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await lctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/", value: ck(lead) }]);
  const lp = await lctx.newPage();
  lp.on("console", (m) => { const ty = m.type(); if (ty === "error" || ty === "warning") errs.push(`[${ty}] ${m.text().slice(0, 160)}`); });
  await lp.goto(`${BASE}/v3/report?r=${saved2?.id}`, { waitUntil: "networkidle" });
  await lp.locator(".v3-mr-card", { hasText: member.nm }).waitFor({ timeout: 9000 });
  const teamTab = await lp.getByRole("tab", { name: /팀원 보고/ }).getAttribute("aria-selected");
  const shownBody = await lp.locator(".v3-mr-card", { hasText: member.nm }).innerText();
  await shot(lp, { path: `${OUT}/M2-팀원-보고.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  chk("⑤-화면", saved2?.status === "submitted" && saved2.body.includes("화면에서 덧붙임") && teamTab === "true"
      && saved2.lead_comment === null && staleComment === 0
      && shownBody.includes("화면에서 덧붙임") && over <= 0 && errs.length === 0,
      `낸 글 덧붙임 ${saved2?.body.includes("화면에서 덧붙임")} · 다시 낸 글에 옛 코멘트 ${staleComment ? "**남음**" : "없음"} · 알림 링크 → 팀원 탭 ${teamTab} · 팀장 화면에 글 ${shownBody.includes("화면에서 덧붙임")} · 390px ${over} · 콘솔 ${errs.length}${errs[0] ? ` — ${errs[0]}` : ""}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  if (ids.length && month) {
    await sql(`DELETE FROM notification WHERE ref_type = 'monthly_report' AND ref_id IN (SELECT id FROM monthly_report WHERE actor_id = ANY($1) AND month = $2)`, [ids, month]).catch(() => {});
    await sql(`DELETE FROM monthly_report WHERE actor_id = ANY($1) AND month = $2`, [ids, month]).catch(() => {});
    await sql(`DELETE FROM work_log WHERE owner_actor_id = ANY($1) AND body LIKE '%' || $2 || '%'`, [ids, MARK]).catch(() => {});
    await sql(`DELETE FROM work_log_category c WHERE c.owner_actor_id = ANY($1) AND c.name = '검사보고'
                 AND NOT EXISTS (SELECT 1 FROM work_log w WHERE w.category_id = c.id)`, [ids]).catch(() => {});
  }
  await sql(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM task WHERE title LIKE $1 || '%'`, [MARK]).catch(() => {});
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
