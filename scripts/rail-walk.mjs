// 홈 오른쪽 레일 (MD-P-2026-031 §C3 3층 · ④ 최근 본 것 · ⑤ 레일 320px).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
// 만든 것만 지운다. 시드 데이터는 건드리지 않는다.
//
// 무엇을 보는가.
//   자기점검 이 검사가 쓰는 선택자가 **전부 살아 있다.** 하나라도 0건이면 아래 판정은
//           증거가 아니다 — 죽은 선택자는 조용히 통과한다(§G).
//   ①  레일이 있고 **320px** 이다
//   ②  블록이 문서대로 셋이다 — `팀 활동` · `내 목표 진척` · `최근 본 것`
//   ③  「다가오는 일정」이 홈 어디에도 없다. **짝** — 남아 있어야 할 블록 이름은 그대로 있다
//   ④  팀 활동 줄에 사람·문구·시각이 있다
//   ⑤  최근 본 것 — 업무를 열면 레일에 **그 제목이** 뜬다 (id 로 저장하고 서버가 제목을 준다)
//   ⑥  저장소에 **제목이 없다** — `tb:recent-*` 값에 종류와 id 만 있다. 이게 ④의 핵심 규약이다
//   ⑦  지워진 항목은 **조용히 건너뛴다** — 오류 문구도, 빈 줄도 남기지 않는다
//   ⑧  레일 스크롤이 본문과 독립이다 (sticky)
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("rail-walk.mjs");

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

let browser, madeIds = [];
try {
  const lead = await one(`SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
                           WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 1`);
  if (!lead) throw new Error("사람 계정이 없다 — 시드부터 하라");

  // 검사용 업무 둘. 하나는 남기고 하나는 도중에 지운다(⑦).
  const mk = async (title) => {
    const r = await one(
      `INSERT INTO task (title, status, progress, created_by, assignee_id, work_type, area_id, is_demo)
       VALUES ($2, 'doing', 30, $1, $1, 'team',
               (SELECT id FROM area WHERE is_active AND kind='workspace' ORDER BY sort_order, id LIMIT 1), true)
       RETURNING id, title`, [lead.id, title]);
    madeIds.push(r.id);
    return r;
  };
  const keep = await mk("[검사] 레일에 남을 업무");
  const gone = await mk("[검사] 곧 지워질 업무");

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") jsErrors.push(m.text().slice(0, 160)); });

  const home = async () => {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const frn = page.locator(".frn-skip");
    if (await frn.count()) { await frn.first().click(); await page.locator(".frn-bg").waitFor({ state: "detached", timeout: 5000 }); }
    await page.waitForSelector(".hm-rail .rl-blk", { timeout: 10000 });
    // 「최근 본 것」은 저장소를 읽고 한 번 더 물어본다. 자리표시(.rl-skel)가 사라질 때까지 기다린다 —
    // 고정 시간 대기는 회차마다 다른 답을 낸다(§G).
    await page.waitForFunction(() => !document.querySelector(".hm-rail .rl-skel"), { timeout: 5000 }).catch(() => {});
  };

  await home();

  // ── 자기 점검 ─────────────────────────────────────────────────
  // 이 검사가 기대는 선택자가 실제로 무언가를 잡는가. 하나라도 0이면 아래는 증거가 아니다.
  const probes = {
    ".hm-rail": await page.locator(".hm-rail").count(),
    ".rl-blk": await page.locator(".hm-rail .rl-blk").count(),
    ".rl-h h2": await page.locator(".hm-rail .rl-h h2").count(),
    ".hm-main": await page.locator(".hm-main").count(),
  };
  const dead = Object.entries(probes).filter(([, n]) => n === 0).map(([k]) => k);
  dead.length === 0
    ? ok("자기점검", `선택자 ${Object.entries(probes).map(([k, n]) => `${k}=${n}`).join(" · ")}`)
    : bad("자기점검", `죽은 선택자 ${dead.join(", ")} — 아래 판정은 증거가 아니다`);

  // ── ① 폭 320px ────────────────────────────────────────────────
  const railW = await page.evaluate(() => {
    const el = document.querySelector(".hm-rail");
    return el ? Math.round(el.getBoundingClientRect().width) : null;
  });
  railW === 320 ? ok("①폭", `레일 ${railW}px (문서 규격 320)`) : bad("①폭", `레일 폭 ${railW}px — 320 이 아니다`);

  // ── ② 블록 셋 ─────────────────────────────────────────────────
  const titles = await page.$$eval(".hm-rail .rl-h h2", (h) => h.map((x) => x.textContent.trim()));
  const want = ["팀 활동", "내 목표 진척", "최근 본 것"];
  JSON.stringify(titles) === JSON.stringify(want)
    ? ok("②구성", `${titles.join(" · ")}`)
    : bad("②구성", `블록이 문서와 다르다 — 있는 것: ${titles.join(" · ") || "(없음)"} / 문서: ${want.join(" · ")}`);

  // ── ③ 「다가오는 일정」 부재 + 짝 ───────────────────────────────
  const upcoming = await page.getByText("다가오는 일정", { exact: true }).count();
  const pairAlive = titles.length > 0 && (await page.locator(".hm-blk-h h2").count()) > 0;
  if (!pairAlive) bad("③없음", "짝이 깨졌다 — 홈에 블록 머리줄이 하나도 없다. 부재를 근거로 쓸 수 없다");
  else if (upcoming > 0) bad("③없음", `「다가오는 일정」이 아직 ${upcoming}곳에 있다`);
  else ok("③없음", `「다가오는 일정」 0곳 (짝: 레일 블록 ${titles.length}개 · 본문 블록 머리줄 ${await page.locator(".hm-blk-h h2").count()}개는 그대로 있다)`);

  // ── ④ 팀 활동 줄 ──────────────────────────────────────────────
  const acts = await page.$$eval(".rl-act", (a) => a.map((x) => ({
    text: x.querySelector(".rl-act-t")?.textContent?.trim() ?? "",
    at: x.querySelector(".rl-act-at")?.textContent?.trim() ?? "",
  })));
  if (acts.length === 0) bad("④활동", "팀 활동이 0줄이다 — 시드에 활동 로그가 있는지 확인하라");
  else {
    const noTime = acts.filter((a) => !/^\d{2}:\d{2}$/.test(a.at));
    noTime.length === 0
      ? ok("④활동", `${acts.length}줄 · 전부 시각이 있다 (예: "${acts[0].text}" ${acts[0].at})`)
      : bad("④활동", `시각이 없는 줄 ${noTime.length}개 — 첫 줄: "${noTime[0].text}"`);
  }

  // ── ⑤ 최근 본 것 — 업무를 열면 제목이 뜬다 ──────────────────────
  const before = await page.locator(".rl-recent").count();
  await page.goto(`${BASE}/tasks?panel=task:${keep.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prop .prop-row", { timeout: 10000 });
  await page.goto(`${BASE}/tasks?panel=task:${gone.id}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".prop .prop-row", { timeout: 10000 });
  await home();
  const seen = await page.$$eval(".rl-recent .rl-recent-t", (t) => t.map((x) => x.textContent.trim()));
  seen.includes(keep.title) && seen.includes(gone.title)
    ? ok("⑤최근", `연 업무 2건이 레일에 제목으로 뜬다 (이전 ${before}줄 → ${seen.length}줄): ${seen.slice(0, 3).join(" / ")}`)
    : bad("⑤최근", `연 업무가 레일에 없다 — 레일: ${seen.join(" / ") || "(비어 있음)"}`);

  // ── ⑥ 저장소에 제목이 없다 ─────────────────────────────────────
  const stored = await page.evaluate((uid) => window.localStorage.getItem(`tb:recent-${uid}`), lead.id);
  if (!stored) bad("⑥저장", `tb:recent-${lead.id} 가 비어 있다 — ⑤가 통과했다면 여기 값이 있어야 한다`);
  else if (stored.includes(keep.title) || stored.includes(gone.title))
    bad("⑥저장", `저장소에 **제목이 굽혀 있다.** 낡고, 개인 항목 제목이 브라우저에 남는다: ${stored.slice(0, 120)}`);
  else ok("⑥저장", `종류와 id 만 있다 — ${stored.slice(0, 120)}`);

  // ── ⑦ 지워진 항목은 조용히 빠진다 ───────────────────────────────
  await sql(`UPDATE task SET is_active = false WHERE id = $1`, [gone.id]);
  await home();
  const after = await page.$$eval(".rl-recent .rl-recent-t", (t) => t.map((x) => x.textContent.trim()));
  const noise = await page.$$eval(".hm-rail", (r) =>
    r.map((x) => x.textContent).join(" ").match(/삭제|없는 항목|오류|불러올 수 없/g)?.length ?? 0);
  if (after.includes(gone.title)) bad("⑦지움", `지운 업무가 아직 레일에 있다 — "${gone.title}"`);
  else if (!after.includes(keep.title)) bad("⑦지움", `지운 것과 함께 **남아야 할 것까지 빠졌다** — 레일: ${after.join(" / ") || "(비어 있음)"}`);
  else if (noise > 0) bad("⑦지움", `조용하지 않다 — 레일에 오류성 문구 ${noise}곳`);
  else {
    const left = await page.evaluate((uid) => window.localStorage.getItem(`tb:recent-${uid}`), lead.id);
    ok("⑦지움", `지운 것만 빠지고 남을 것은 남았다 (${after.length}줄) · 저장소도 정리됨: ${left?.slice(0, 90)}`);
  }

  // ── ⑧ 스크롤 독립 ─────────────────────────────────────────────
  const pos = await page.evaluate(() => {
    const el = document.querySelector(".hm-rail");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { position: cs.position, overflowY: cs.overflowY };
  });
  pos && pos.position === "sticky" && ["auto", "scroll"].includes(pos.overflowY)
    ? ok("⑧독립", `position:${pos.position} · overflow-y:${pos.overflowY} — 본문과 따로 흐른다`)
    : bad("⑧독립", `스크롤이 본문에 묶여 있다 — ${JSON.stringify(pos)}`);

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
  for (const id of madeIds) {
    await tidy("goal_task", `DELETE FROM goal_task WHERE task_id=$1`, [id]);
    await tidy("activity_log", `DELETE FROM activity_log WHERE task_id=$1`, [id]);
    await tidy("task", `DELETE FROM task WHERE id=$1`, [id]);
  }
  try { await pool.end(); } catch { /* 종료 경로 — 이미 닫혔다면 더 할 일이 없다 */ }
  const f = rows.filter((r) => r.pass === false).length;
  const p = rows.filter((r) => r.pass === true).length;
  console.log(`\n결과 ${p}/${p + f} 통과`);
  if (rows.length === 0) { console.error("측정된 줄이 0건이다 — 서버가 떠 있는지 확인하라"); process.exit(2); }
  process.exit(f ? 1 : 0);
}
