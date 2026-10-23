// 관제 — 숫자가 맞고, 남의 비공개 업무는 안 새고, 아침 알림은 한 번만 간다.
//
//   node scripts/control-walk.mjs            재기만 한다
//   SHOT=1 node scripts/control-walk.mjs     캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① 레일 「업무」 맨 위에 「관제」 · 누르면 열린다(열두 번째)
//   ② 「기한 지남」 타일 = DB 에서 센 값(보는 사람에게 보이는 안 끝난 업무 중 due < 오늘)
//   ③ 남의 **비공개** 지남 업무는 제목도 숫자도 안 보인다 · 주인에게는 보인다
//   ④ 손 안 댄 지 3일 넘은 진행 업무가 「소식 없음」으로 뜬다
//   ⑤ 사람별 줄 = 활성 사람(보기 전용 제외) 전부
//   ⑥ 팀장은 「목표 세우기」로 이번 달 팀 목표를 세운다 · 팀원에게는 버튼이 없다
//   ⑦ 아침 알림: 인증 없이 401 · 팀장 실행 200 · 담당자에게 지남·소식 없음 · 팀장 요약 · 두 번 돌려도 한 번
//   ⑧ 좁은 화면(390px) 옆으로 안 넘침 · 공간 모드에서도 열린다
//   ⑨ 콘솔 오류 0
//
// **로컬 전용.** 제가 만든 업무 · 목표 · 알림(제목·키에 「검사관제」)만 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("control-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/control";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "검사관제";
let digestBefore = new Set();
const cleanup = async () => {
  const ids = (await sql(`SELECT id FROM task WHERE title LIKE '%' || $1 || '%'`, [MARK])).map((r) => r.id);
  if (ids.length) {
    await sql(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id = ANY($1)`, [ids]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1)`, [ids]);
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1)`, [ids]);
    await sql(`DELETE FROM task WHERE id = ANY($1)`, [ids]);
  }
  const gids = (await sql(`SELECT id FROM goal WHERE title LIKE '%' || $1 || '%'`, [MARK])).map((r) => r.id);
  if (gids.length) {
    await sql(`DELETE FROM goal_task WHERE goal_id = ANY($1)`, [gids]).catch(() => {});
    await sql(`DELETE FROM goal_snapshot WHERE goal_id = ANY($1)`, [gids]).catch(() => {});
    await sql(`UPDATE goal SET parent_id = NULL WHERE parent_id = ANY($1)`, [gids]);
    await sql(`DELETE FROM goal WHERE id = ANY($1)`, [gids]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE '%' || $1 || '%'`, [MARK]);
  // 아침 요약은 이 검사가 만든 것만 지운다(있던 날의 요약은 둔다)
  await sql(`DELETE FROM notification WHERE dedupe_key LIKE 'watch-digest:%' AND NOT (user_id = ANY($1))
               AND created_at > now() - interval '1 hour' AND snippet LIKE '%오늘 관제%'`, [[...digestBefore]]);
};

let browser, swBefore = null;
try {
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  digestBefore = new Set((await sql(`SELECT user_id FROM notification WHERE dedupe_key = $1`, [`watch-digest:${today}`])).map((r) => r.user_id));
  await cleanup();

  const ppl = await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND ac.type = 'human' ORDER BY (a.role IN ('admin','lead')) DESC, a.actor_id`);
  const lead = ppl.find((p) => p.role === "admin" || p.role === "lead");
  const members = ppl.filter((p) => p.role === "member");
  if (!lead || members.length < 2) throw new Error("팀장 1 · 팀원 2 가 필요하다");
  const [m1, m2] = members;
  const area = (await sql(`SELECT id FROM area WHERE is_active ORDER BY id LIMIT 1`))[0].id;
  const ins = async (title, o) => (await sql(
    `INSERT INTO task (title, area_id, created_by, assignee_id, status, due_date, visibility)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [title, area, o.by, o.to, o.status, o.due, o.vis ?? "team"]))[0].id;
  const lateId = await ins(`${MARK} 지난 업무`, { by: lead.id, to: m1.id, status: "doing", due: "2026-01-02" });
  const privId = await ins(`${MARK} 비공개 지난 업무`, { by: m2.id, to: m2.id, status: "todo", due: "2026-01-02", vis: "private" });
  const quietId = await ins(`${MARK} 조용한 업무`, { by: lead.id, to: m1.id, status: "doing", due: null });
  await sql(`UPDATE task SET updated_at = now() - interval '5 days' WHERE id = $1`, [quietId]);
  const quietAge = (await sql(`SELECT (now() - updated_at) > interval '3 days' AS old FROM task WHERE id = $1`, [quietId]))[0].old;

  const cookie = (u) => tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" });
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const errs = [];
  const open = async (u, viewport = { width: 1440, height: 900 }, extra = []) => {
    const c = await browser.newContext({ viewport });
    const host = new URL(BASE).hostname;
    await c.addCookies([{ name: "tb_session", domain: host, path: "/", value: cookie(u) }, ...extra.map((x) => ({ ...x, domain: host, path: "/" }))]);
    const p = await c.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    return p;
  };
  if (process.env.SHOT === "1") mkdirSync(OUT, { recursive: true });

  // ① 레일
  const w = await open(lead);
  await w.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  const rail = await w.evaluate(`(() => { const g = [...document.querySelectorAll(".v3-railg")].find((x) => x.querySelector(".v3-railg-t")?.textContent.trim() === "업무");
    return g ? [...g.querySelectorAll("a")].map((a) => a.textContent.trim()) : []; })()`);
  await w.locator('.v3-rail a[href="/v3/control"]').click();
  await w.waitForURL(/\/v3\/control$/, { timeout: 9000 }).catch(() => {});
  await w.locator(".v3-ctl").waitFor({ timeout: 9000 });
  chk("①-레일-업무-맨-위", rail[0] === "관제" && w.url().endsWith("/v3/control"), `업무 묶음 [${rail.join(" · ")}] · 주소 ${w.url()}`);

  // ② 지남 숫자
  const want = Number((await sql(
    `SELECT count(*) n FROM task t WHERE t.is_active AND t.status IN ('todo','doing','review') AND t.due_date < $2::date
        AND (t.visibility = 'team' OR t.created_by = $1)`, [lead.id, today]))[0].n);
  const tiles = await w.evaluate(`[...document.querySelectorAll(".v3-stat")].map((s) => [s.querySelector(".v3-stat-l")?.textContent, s.querySelector(".v3-stat-n")?.textContent])`);
  const lateTile = Number((tiles.find((t) => t[0] === "기한 지남") ?? [])[1]);
  chk("②-지남-타일이-DB와-같다", lateTile === want, `화면 ${lateTile} · DB ${want}`);

  // ③ 비공개
  const leadSees = await w.locator(".v3-ctl", { hasText: `${MARK} 비공개` }).count();
  const ow = await open(m2);
  await ow.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  const ownerSees = await ow.locator(".v3-ctl-sig", { hasText: `${MARK} 비공개` }).count();
  chk("③-남의-비공개는-안-샌다", leadSees === 0 && ownerSees === 1, `팀장 화면에 보임 ${leadSees} · 주인 화면에 보임 ${ownerSees}`);

  // ④ 소식 없음 — 목록은 오래된 것부터 몇 줄만 보이므로, 타일 숫자와 사람 줄로 본다
  const wantQuiet = Number((await sql(
    `SELECT count(*) n FROM task t WHERE t.is_active AND t.status IN ('doing','review')
        AND t.updated_at < now() - interval '3 days' AND (t.visibility = 'team' OR t.created_by = $1)`, [lead.id]))[0].n);
  const quietTile = Number((tiles.find((t) => /소식 없음/.test(t[0] ?? "")) ?? [])[1]);
  const m1Row = await w.locator(".v3-ctl-p", { hasText: m1.nm }).first().innerText().catch(() => "");
  chk("④-소식-없음", quietAge && quietTile === wantQuiet && /소식 없음/.test(m1Row),
      `손 안 댄 지 5일로 둠 ${quietAge} · 타일 ${quietTile} / DB ${wantQuiet} · ${m1.nm} 줄에 표시 ${/소식 없음/.test(m1Row)}`);

  // ⑤ 사람
  const humans = Number((await sql(`SELECT count(*) n FROM actor a LEFT JOIN account ac ON ac.actor_id = a.id
      WHERE a.type = 'human' AND a.is_active AND coalesce(ac.role,'member') <> 'viewer'`))[0].n);
  const rows = await w.locator(".v3-ctl-p").count();
  chk("⑤-사람-줄", rows === humans, `화면 ${rows}줄 · DB ${humans}명`);

  // ⑥ 목표 세우기
  await w.locator(".v3-ctl-add").click();
  await w.getByRole("button", { name: "월", exact: true }).click();
  await w.locator(".v3-ctl-in").fill(`${MARK} 이번 달 목표`);
  await w.locator(".v3-ctl-form .v3-btn.primary").click();
  const g = w.locator(".v3-ctl-goal", { hasText: `${MARK} 이번 달 목표` });
  await g.waitFor({ timeout: 9000 }).catch(() => {});
  const made = (await g.count()) === 1;
  const row = (await sql(`SELECT period_type, period_start::text ps, scope FROM goal WHERE title = $1`, [`${MARK} 이번 달 목표`]))[0];
  const memberBtn = await ow.locator(".v3-ctl-add").count();
  await shot(w, { path: `${OUT}/wide.png`, fullPage: true });
  chk("⑥-목표-세우기", made && row?.period_type === "month" && row?.ps === `${today.slice(0, 7)}-01` && row?.scope === "team" && memberBtn === 0,
      `화면에 뜸 ${made} · DB ${row?.scope}/${row?.period_type}/${row?.ps} · 팀원 화면 버튼 ${memberBtn}개`);

  // ⑦ 아침 알림
  const anon = await fetch(`${BASE}/api/cron/team-watch`);
  const mPost = await fetch(`${BASE}/api/cron/team-watch`, { method: "POST", headers: { cookie: `tb_session=${cookie(m1)}` } });
  const r1 = await fetch(`${BASE}/api/cron/team-watch`, { method: "POST", headers: { cookie: `tb_session=${cookie(lead)}` } });
  const j1 = await r1.json().catch(() => ({}));
  const r2 = await fetch(`${BASE}/api/cron/team-watch`, { method: "POST", headers: { cookie: `tb_session=${cookie(lead)}` } });
  const j2 = await r2.json().catch(() => ({}));
  const n = await sql(`SELECT user_id, dedupe_key FROM notification WHERE (ref_type = 'task' AND ref_id = ANY($1)) OR dedupe_key = $2`,
    [[lateId, quietId, privId], `watch-digest:${today}`]);
  const has = (u, k) => n.some((x) => x.user_id === u && x.dedupe_key.startsWith(k));
  const leadsN = Number((await sql(`SELECT count(*) n FROM account ac JOIN actor a ON a.id = ac.actor_id WHERE ac.role IN ('admin','lead') AND a.is_active`))[0].n);
  const digests = n.filter((x) => x.dedupe_key === `watch-digest:${today}`).length;
  const leadPriv = n.some((x) => x.user_id !== m2.id && x.dedupe_key === `deadline:${privId}:overdue`);
  chk("⑦-아침-알림", anon.status === 401 && mPost.status === 403 && r1.status === 200
      && has(m1.id, `deadline:${lateId}:overdue`) && has(m1.id, `watch-quiet:${quietId}:`) && has(m2.id, `deadline:${privId}:overdue`)
      && !leadPriv && digests === leadsN && j2.sent === 0,
      `익명 ${anon.status} · 팀원 실행 ${mPost.status} · 팀장 실행 ${r1.status}(보냄 ${j1.sent}) · 두 번째 보냄 ${j2.sent} · ` +
      `담당자 지남 ${has(m1.id, `deadline:${lateId}`)} · 소식 없음 ${has(m1.id, `watch-quiet:${quietId}`)} · ` +
      `비공개는 주인에게만 ${has(m2.id, `deadline:${privId}`) && !leadPriv} · 팀장 요약 ${digests}/${leadsN}`);

  // ⑧ 좁은 화면 · 공간 모드
  const ph = await open(lead, { width: 390, height: 844 }, [{ name: "v3_look", value: "space" }]);
  await ph.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  await ph.waitForTimeout(700);
  const m = await ph.evaluate(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    space: document.querySelector(".v3")?.classList.contains("v3-space") ?? false, title: document.querySelector(".v3-topbar-t")?.textContent })`);
  await shot(ph, { path: `${OUT}/phone-space.png` });
  const sp = await open(lead, { width: 1440, height: 900 }, [{ name: "v3_look", value: "space" }]);
  await sp.goto(`${BASE}/v3/control`, { waitUntil: "networkidle" });
  await sp.waitForTimeout(900);
  await shot(sp, { path: `${OUT}/wide-space.png` });
  chk("⑧-좁은-화면·공간-모드", m.sw <= m.cw && m.space && m.title === "관제", `문서 폭 ${m.sw}/${m.cw} · 공간 모드 ${m.space} · 위 바 "${m.title}"`);

  chk("⑨-콘솔-오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0].slice(0, 140)}` : ""}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 ${e.stack ?? e}`);
} finally {
  await browser?.close();
  await cleanup().catch((e) => console.log(`정리 실패 ${e.message}`));
  if (swBefore === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
  else await sql(`UPDATE config SET value = $2 WHERE key = $1`, [KEY, JSON.stringify(swBefore)]);
  await pool.end();
  console.log(`\n${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
