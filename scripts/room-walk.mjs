// 회의실(0038) — 열고, 같이 올리고, 정하고, 끝내면 회의록이 남는다.
//
//   node scripts/room-walk.mjs            재기만 한다
//   SHOT=1 node scripts/room-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 회의 열기 — 이름이 없으면 400 · 열면 연 사람이 참석자다
//   ② 항목 — 안건 · 링크 · 결정 · 할 일이 올라간다 · http(s) 가 아닌 링크는 400
//   ③ 권한 — 팀원은 결정 확정 · 남의 항목 내리기 · 회의 끝내기가 403 · 찬성은 누구나
//   ④ 참석 — 두 번째 사람이 들어오면 둘 다 「접속」 · 관제의 「지금 팀」에 「회의 중」
//   ⑤ 화면 — 레일의 회의실 → 목록 → 열린 회의 → 엔터로 안건이 올라간다 · 영상은 눌러야 켜진다
//   ⑥ 끝내기 — 회의록이 굳고 참석자 각자의 내 기록에 「회의」 한 줄 · 끝난 뒤 올리기는 409
//   ⑦ 옛 주소 `/huddle` → 회의실
//   ⑩ 결정 찾기 — 확정한 결정이 낱말로 찾아진다 · 없는 낱말은 0건 · 목록 화면에서 치면 걸러진다
//   ⑧ 좁은 화면(390px)에서 옆으로 안 넘친다
//   ⑨ 콘솔 오류 0 (영상 iframe 이 밖으로 못 나가서 내는 소리는 뺀다 — 검사 브라우저는 프록시가 없다)
//
// **로컬 전용.** 제가 만든 회의(이름이 「[검사]」로 시작)와 그 회의가 남긴 기록 줄만 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("room-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/room";
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
let catBefore = new Map();   // 사람 → 「회의」 카테고리가 원래 있었나
const cleanup = async (ids) => {
  await sql(`DELETE FROM work_log WHERE owner_actor_id = ANY($1) AND body LIKE '%' || $2 || '%'`, [ids, MARK]);
  await sql(`DELETE FROM meeting WHERE title LIKE $1 || '%'`, [MARK]);
  // 검사가 만든 「회의」 카테고리 — 원래 없었고 지금 빈 것만
  for (const id of ids) {
    if (catBefore.get(id)) continue;
    await sql(`DELETE FROM work_log_category c WHERE c.owner_actor_id = $1 AND c.name = '회의'
                 AND NOT EXISTS (SELECT 1 FROM work_log w WHERE w.category_id = c.id)`, [id]);
  }
};

let browser, ids = [];
try {
  const lead = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead || !member) throw new Error("팀장(또는 관리자) 하나 · 팀원 하나가 필요하다");
  ids = [lead.id, member.id];
  for (const id of ids)
    catBefore.set(id, (await sql(`SELECT 1 FROM work_log_category WHERE owner_actor_id = $1 AND name = '회의'`, [id])).length > 0);
  await cleanup(ids);

  const cookie = (u) => `tb_session=${tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" })}`;
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: cookie(u), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  // ── ① 열기 ─────────────────────────────────────────────────────
  // 회의를 여는 것은 **팀원**이다 — 그래야 「연 사람은 끝낼 수 있고, 다른 팀원은 못 한다」를 잰다
  const blank = await api(member, "POST", "/api/meetings", { title: "  " });
  const made = await api(member, "POST", "/api/meetings", { title: `${MARK} 주간 점검` });
  const mid = made.data?.id;
  const m0 = await api(member, "GET", `/api/meetings/${mid}`);
  chk("①-열기", blank.status === 400 && made.status === 200 && mid
      && m0.data?.meeting?.attendees?.some((a) => a.id === member.id && a.present),
      `빈 이름 ${blank.status} · 열기 ${made.status} #${mid} · 참석자 ${m0.data?.meeting?.attendees?.map((a) => a.name).join(",")}`);

  // ── ② 항목 ─────────────────────────────────────────────────────
  const ag = await api(member, "POST", `/api/meetings/${mid}`, { kind: "agenda", body: `${MARK} 안건 하나` });
  const lk = await api(member, "POST", `/api/meetings/${mid}`, { kind: "link", body: "https://example.com/deck" });
  const bad = await api(member, "POST", `/api/meetings/${mid}`, { kind: "link", body: "javascript:alert(1)" });
  const dc = await api(lead, "POST", `/api/meetings/${mid}`, { kind: "decision", body: `${MARK} 업로드 한도 100MB` });
  const ac = await api(member, "POST", `/api/meetings/${mid}`, { kind: "action", body: `${MARK} 덱 나눠 올리기`,
    meta: { assigneeId: member.id, due: "2026-11-02" } });
  const m1 = (await api(member, "GET", `/api/meetings/${mid}`)).data?.meeting;
  const kinds = (m1?.items ?? []).map((i) => i.kind).sort().join(",");
  chk("②-항목이-올라간다", [ag, lk, dc, ac].every((r) => r.status === 200) && bad.status === 400
      && kinds === "action,agenda,decision,link",
      `안건 ${ag.status} · 링크 ${lk.status} · 나쁜 링크 ${bad.status} · 결정 ${dc.status} · 할 일 ${ac.status} · 종류 [${kinds}]`);

  // ── ③ 권한 ─────────────────────────────────────────────────────
  const vote = await api(member, "PATCH", `/api/meetings/${mid}/items/${dc.data.id}`, { op: "vote" });
  // 팀원이 연 회의다 — 연 사람은 확정할 수 있다. 「남」이 확정 못 하는 것은 아래 별도 회의로 잰다
  const decide = await api(member, "PATCH", `/api/meetings/${mid}/items/${dc.data.id}`, { op: "decide" });
  const other = await api(lead, "POST", "/api/meetings", { title: `${MARK} 팀장이 연 회의` });
  const od = await api(lead, "POST", `/api/meetings/${other.data.id}`, { kind: "decision", body: `${MARK} 다른 결정` });
  const decideNo = await api(member, "PATCH", `/api/meetings/${other.data.id}/items/${od.data.id}`, { op: "decide" });
  const removeNo = await api(member, "PATCH", `/api/meetings/${other.data.id}/items/${od.data.id}`, { op: "remove" });
  const endNo = await api(member, "POST", `/api/meetings/${other.data.id}/end`);
  const m2 = (await api(member, "GET", `/api/meetings/${mid}`)).data?.meeting;
  const d2 = m2?.items?.find((i) => i.id === dc.data.id);
  chk("③-권한", vote.status === 200 && decide.status === 200
      && decideNo.status === 403 && removeNo.status === 403 && endNo.status === 403 && !!d2?.meta?.decidedAt,
      `찬성 ${vote.status} · 연 사람 확정 ${decide.status} · ` +
      `남의 회의에서 팀원 확정 ${decideNo.status} · 내리기 ${removeNo.status} · 끝내기 ${endNo.status}`);

  // ── ④ 참석 ─────────────────────────────────────────────────────
  await api(lead, "GET", `/api/meetings/${mid}`);
  const m3 = (await api(member, "GET", `/api/meetings/${mid}`)).data?.meeting;
  const present = (m3?.attendees ?? []).filter((a) => a.present).length;
  chk("④-둘-다-접속", present === 2, `접속 ${present}명 (2 여야)`);

  // ── 화면 ───────────────────────────────────────────────────────
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: lead.id, actorId: lead.id, name: lead.nm, role: lead.role, adminGrant: lead.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = [];
  const noise = (t) => /jit\.si|jitsi|ERR_|Failed to load resource|net::/i.test(t);
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type(); const x = m.text();
    if ((t === "error" || t === "warning") && !noise(x)) errs.push(`[${t}] ${x.slice(0, 160)}`); });
  if (process.env.SHOT) mkdirSync(OUT, { recursive: true });

  await page.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const team = await page.locator(".v3-ctl-team").innerText().catch(() => "");
  chk("④-관제에-회의-중", team.includes("회의 중") && team.includes(`회의실 · ${MARK}`),
      `「지금 팀」에 회의 중 ${team.includes("회의 중") ? "있음" : "없음"}`);

  await page.locator(".v3-rail a", { hasText: "회의실" }).first().click();
  await page.waitForURL(/\/v3\/room$/, { timeout: 9000 });
  await page.locator(".v3-room-tile").first().waitFor({ timeout: 9000 }).catch(() => {});
  await page.waitForTimeout(800);   // 공간 모드의 떠오르는 움직임이 끝난 뒤에 찍는다
  const tiles = await page.locator(".v3-room-tile").count();
  await shot(page, { path: `${OUT}/R1-목록.png`, fullPage: true });
  await page.locator(".v3-room-tile", { hasText: "주간 점검" }).first().click();
  await page.waitForURL(/\/v3\/room\/\d+/, { timeout: 9000 });
  await page.waitForTimeout(600);
  const iframeBefore = await page.locator(".v3-room-stage iframe").count();
  await page.locator(".v3-room-in").fill(`${MARK} 화면에서 올린 안건`);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const listed = await page.locator(".v3-room-items").innerText();
  await page.getByRole("tab", { name: /결정/ }).click();
  const decTab = await page.locator(".v3-room-items").innerText();
  await page.getByRole("button", { name: "영상 켜기" }).click();
  const src = await page.locator(".v3-room-stage iframe").getAttribute("src").catch(() => "");
  await shot(page, { path: `${OUT}/R2-회의.png`, fullPage: true });
  chk("⑤-화면", tiles >= 2 && iframeBefore === 0 && listed.includes("화면에서 올린 안건")
      && decTab.includes("확정") && /^https:\/\/[^/]+\/aiot-robot-[0-9a-f]{20}#/.test(src ?? ""),
      `열린 회의 ${tiles}개 · 누르기 전 영상 ${iframeBefore} · 안건 올라감 ${listed.includes("화면에서 올린 안건")} · ` +
      `결정 탭 확정 ${decTab.includes("확정")} · 영상 주소 ${String(src).split("#")[0]}`);

  // ⑧ 좁은 화면
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await shot(page, { path: `${OUT}/R3-좁은화면.png`, fullPage: true });
  chk("⑧-390px", over <= 0, `넘친 폭 ${over}px`);
  await page.setViewportSize({ width: 1440, height: 950 });

  // ── ⑥ 끝내기 ───────────────────────────────────────────────────
  const endOk = await api(member, "POST", `/api/meetings/${mid}/end`);
  const after = await api(member, "POST", `/api/meetings/${mid}`, { kind: "agenda", body: `${MARK} 늦은 안건` });
  const fin = (await api(member, "GET", `/api/meetings/${mid}`)).data?.meeting;
  const logs = await sql(
    `SELECT w.owner_actor_id id FROM work_log w JOIN work_log_category c ON c.id = w.category_id
      WHERE c.name = '회의' AND w.body LIKE '%' || $1 || '%' AND w.owner_actor_id = ANY($2)`, [MARK, ids]);
  chk("⑥-끝내면-회의록", endOk.status === 200 && after.status === 409 && fin?.status === "ended"
      && fin?.minutes?.decisions?.length === 1 && fin?.minutes?.actions?.length === 1
      && new Set(logs.map((l) => l.id)).size === 2,
      `끝내기 ${endOk.status} · 끝난 뒤 올리기 ${after.status} · 결정 ${fin?.minutes?.decisions?.length} · ` +
      `할 일 ${fin?.minutes?.actions?.length} · 내 기록 줄 ${logs.length}(두 사람)`);
  await page.reload({ waitUntil: "networkidle" });
  const minutes = await page.locator(".v3-room-min").innerText().catch(() => "");
  await shot(page, { path: `${OUT}/R4-회의록.png`, fullPage: true });
  chk("⑥-회의록-화면", minutes.includes("업로드 한도 100MB") && minutes.includes("덱 나눠 올리기"),
      `회의록에 결정 · 할 일 ${minutes.includes("업로드 한도 100MB") && minutes.includes("덱 나눠 올리기") ? "보임" : "안 보임"}`);

  // ── ⑩ 결정 찾기 ─────────────────────────────────────────────────
  const hit = await api(member, "GET", `/api/meetings/decisions?q=${encodeURIComponent("업로드 한도")}`);
  const miss = await api(member, "GET", `/api/meetings/decisions?q=${encodeURIComponent("zzqq없는말")}`);
  const pct = await api(member, "GET", `/api/meetings/decisions?q=${encodeURIComponent("%")}`);
  const found = (hit.data?.decisions ?? []).filter((d) => d.body.includes(MARK));
  chk("⑩-결정-찾기-API", hit.status === 200 && found.length === 1 && found[0].meetingId === mid
      && miss.data?.decisions?.length === 0 && !(pct.data?.decisions ?? []).some((d) => d.body.includes(MARK)),
      `「업로드 한도」 ${found.length}건(이 회의 ${found[0]?.meetingId === mid}) · 없는 말 ${miss.data?.decisions?.length}건 · 「%」 그대로 찾기 ${pct.status}`);
  await page.goto(`${BASE}/v3/room`, { waitUntil: "networkidle" });
  await page.locator(".v3-room-dec").waitFor({ timeout: 9000 });
  const decBefore = await page.locator(".v3-room-dec li").filter({ hasText: "업로드 한도" }).count();
  await page.locator('.v3-room-dec input[type="search"]').fill("zzqq없는말");
  await page.waitForTimeout(1200);
  const decGone = await page.locator(".v3-room-dec li").count();
  await page.locator('.v3-room-dec input[type="search"]').fill("업로드");
  await page.waitForTimeout(1200);
  const decBack = await page.locator(".v3-room-dec li").filter({ hasText: "업로드 한도" }).count();
  await shot(page, { path: `${OUT}/R5-결정찾기.png`, fullPage: true });
  chk("⑩-결정-찾기-화면", decBefore === 1 && decGone === 0 && decBack === 1,
      `처음 ${decBefore}건 · 없는 말 ${decGone}건 · 「업로드」 ${decBack}건`);

  // ── ⑦ 옛 주소 ──────────────────────────────────────────────────
  await page.goto(`${BASE}/huddle`, { waitUntil: "networkidle" });
  chk("⑦-/huddle", new URL(page.url()).pathname === "/v3/room", `/huddle → ${new URL(page.url()).pathname}`);

  chk("⑨-콘솔-오류-0", errs.length === 0, errs.length ? errs.slice(0, 4).join(" | ") : "0건");
} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  if (ids.length) await cleanup(ids).catch((e) => console.log(`정리 실패 ${e.message}`));
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
