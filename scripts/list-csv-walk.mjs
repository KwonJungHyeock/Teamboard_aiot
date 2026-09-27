// 업무 목록 거르개 + CSV 실측 (MD-P-2026-066 §C).
//
//   node scripts/list-csv-walk.mjs
//
// 무엇을 확인하는가 — 지시서의 검사 넷과 그 조건들:
//   §C-15  거르개 줄의 **차례가 고정**이다
//   §C-18  머리에 두 숫자 — 「n건 · 내 것 n건」
//   §C-26  「내 항목」 결과 == 「담당 ▾ 나」 결과. **id 집합으로 비교한다** —
//          건수로 비교하면 우연히 같아 틀린 것이 통과한다
//   §C-27  화면의 id 집합 == CSV 의 id 집합
//   §C-28  팀원이 받은 CSV 에 팀원이 화면에서 못 보는 것 0건 (+ 짝 단언)
//   §C-22  CSV 는 `<a href>` — **누르기 전에는 안 만들어진다**
//   §C-23  BOM · §C-24 수식 주입 막기
//   §C-29  빈 화면 두 문장이 갈린다
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";
import { testUser } from "./test-user.mjs";

requireLocalDb("list-csv-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const HOST = new URL(BASE).hostname;
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[066검사]";
/** 엑셀이 **수식으로 읽는** 제목. 앞에 따옴표가 붙어야 한다 (§C-24). */
const INJECT = `=cmd|' /C calc'!A0 ${MARK}`;

const ADMIN = await testUser("admin");
const MEMBER = await testUser("member");

/** 그 사람 쿠키로 CSV 를 받아 **바이트째로** 돌려준다 — BOM 을 눈으로 세려면 바이트가 필요하다. */
async function csv(user, qs) {
  const r = await fetch(`${BASE}/api/tasks/csv${qs ? `?${qs}` : ""}`, {
    headers: { cookie: `tb_session=${tok(user)}` },
  });
  const buf = Buffer.from(await r.arrayBuffer());
  const text = buf.toString("utf8");
  // 머리줄을 뺀 본문에서 첫 칸(번호)만 긁는다. 따옴표로 싸인 칸이 있어도
  // 번호 칸은 늘 맨 앞이고 숫자다.
  const lines = text.replace(/^﻿/, "").split("\r\n").filter((l) => l.trim() !== "");
  const ids = lines.slice(1).map((l) => Number(l.split(",")[0])).filter(Number.isInteger);
  return { status: r.status, buf, text, lines, ids, dispo: r.headers.get("content-disposition") ?? "" };
}

let browser, swBefore = null, made = [], beforeCount = null;
try {
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  /*
   * ── 조건 ────────────────────────────────────────────────────────
   * ① 관리자의 **개인 업무** 하나 — §C-28 이 이걸로 뜻을 갖는다.
   *   팀원이 못 보는 것이 애초에 없으면 「0건」은 아무것도 안 잰 값이다(§G 053).
   * ② 제목이 **수식으로 시작하는** 업무 하나 — §C-24.
   * ③ 관리자 담당 업무 하나 — 「내 것 n건」이 0이면 §C-18·§C-26 이 빈 비교가 된다.
   */
  const area = (await sql(`SELECT id FROM area WHERE is_active = true ORDER BY sort_order, id LIMIT 1`))[0].id;
  const mk = async (title, opts = {}) => (await sql(
    `INSERT INTO task (title, status, due_date, area_id, visibility, work_type, created_by, assignee_id)
     VALUES ($1, $2, $3::date, $4, $5, 'team', $6, $7) RETURNING id`,
    [title, opts.status ?? "doing", opts.due ?? today, area,
     opts.visibility ?? "team", opts.by ?? ADMIN.id, opts.to ?? ADMIN.id]))[0].id;

  const secretId = await mk(`${MARK} 관리자 개인 업무`, { visibility: "private" });
  const injectId = await mk(INJECT);
  const mineId = await mk(`${MARK} 내 담당 업무`);
  made = [secretId, injectId, mineId];
  console.log(`   (조건) 개인 #${secretId} · 수식제목 #${injectId} · 내담당 #${mineId} — 영역 ${area}`);

  chk("0짝-팀원이-못-보는-것이-있다",
      (await sql(`SELECT count(*)::int n FROM task WHERE id = $1 AND visibility = 'private'`, [secretId]))[0].n === 1,
      `관리자 개인 업무 #${secretId} — 이게 없으면 §C-28 의 「0건」은 아무것도 안 잰 값이다`);

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
  await ctx.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(ADMIN) }]);
  const page = await ctx.newPage();

  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const t = m.type();
    if (t !== "error" && t !== "warning") return;
    const line = `[${t}] ` + m.text().slice(0, 160);
    if (ignoredWhy(line)) return;
    errs.push(line); });

  /*
   * §C-22 — **누르지 않았는데 만들어지는가.** 미리 불러오는 링크로 만들면
   * 화면을 열기만 해도 전 건이 CSV 로 만들어진다. 요청을 세어서 확인한다.
   */
  let csvHits = 0;
  page.on("request", (r) => { if (r.url().includes("/api/tasks/csv")) csvHits += 1; });

  /** 화면에 보이는 업무 id 집합. 행의 링크에서 읽는다 — 화면이 그린 값 그대로. */
  const screenIds = async (qs) => {
    await page.goto(`${BASE}/v3/tasks${qs ? `?${qs}` : ""}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const hrefs = await page.locator('.v3-card a[href^="/v3/tasks/"]').evaluateAll(
      (els) => els.map((e) => e.getAttribute("href")));
    return new Set(hrefs.map((h) => Number(String(h).split("/").pop())).filter(Number.isInteger));
  };

  // ── ① 거르개 줄의 차례 (§C-15) ─────────────────────────────────
  await screenIds("done=1");
  const order = await page.locator(".v3-fbar > *").evaluateAll((els) => els.map((e) => {
    if (e.classList.contains("v3-chip")) return "내항목";
    if (e.classList.contains("v3-tabs")) return "상태탭:" + Array.from(e.children).map((c) => c.textContent.trim()).join("|");
    if (e.classList.contains("v3-menu")) return "메뉴:" + (e.querySelector(".v3-mbtn")?.textContent ?? "").trim().replace(/▾$/, "");
    if (e.tagName === "INPUT") return "찾기";
    if (e.tagName === "A") return "CSV";
    return "칸";
  }));
  const meaningful = order.filter((o) => o !== "칸");
  const want = ["내항목", "상태탭:전체|진행|검토|완료", "메뉴:영역", "메뉴:담당", "메뉴:기한", "찾기", "CSV"];
  chk("①-거르개-줄-차례-고정", JSON.stringify(meaningful) === JSON.stringify(want),
      `${meaningful.join(" · ")}`);

  // ── ② 머리에 두 숫자 (§C-18) ──────────────────────────────────
  const lede = (await page.locator(".v3-lede").first().textContent()) ?? "";
  const m = /^(\d+)건 · 내 것 (\d+)건/.exec(lede.trim());
  // 「내 것」은 **DB 에서 센 값**과 맞춘다 — 화면이 자기가 그린 것을 그렸는지가 아니라
  // 맞는 값을 그렸는지를 묻는다.
  const dbMine = (await sql(
    `SELECT count(*)::int n FROM task t
      WHERE t.is_active AND t.status <> 'proposed' AND t.assignee_id = $1
        AND (t.visibility = 'team' OR t.created_by = $1)`, [ADMIN.id]))[0].n;
  chk("②-머리에-두-숫자", m !== null && Number(m[2]) === dbMine,
      `"${lede.trim().slice(0, 48)}" · 내 것 ${m ? m[2] : "(못 읽음)"} / DB ${dbMine}`);

  // ── ③ 「내 항목」 == 「담당 ▾ 나」 — **id 집합으로** (§C-26) ────
  const byMine = await screenIds("mine=1&done=1");
  const byWho = await screenIds(`who=${ADMIN.id}&done=1`);
  const same = byMine.size === byWho.size && [...byMine].every((id) => byWho.has(id));
  chk("③-내항목-==-담당나", same && byMine.size > 0,
      `내 항목 ${byMine.size}건 [${[...byMine].slice(0, 6).join(",")}…] · 담당 ${byWho.size}건` +
      ` — 같은 id 집합${byMine.size === 0 ? " (그런데 0건이라 뜻이 없다)" : ""}`);

  // ── ④ 화면 id 집합 == CSV id 집합 (§C-27) ──────────────────────
  // `done=1` 을 함께 건다. 완료 묶음이 접혀 있으면 **화면에 안 보이므로**,
  // 접힌 채 비교하면 「보이는 것과 같다」가 아니라 「접힌 것과 다르다」를 잰다.
  const qs4 = "mine=1&done=1";
  const shown4 = await screenIds(qs4);
  const csv4 = await csv(ADMIN, "mine=1");
  const csvSet = new Set(csv4.ids);
  const eq4 = shown4.size === csvSet.size && [...shown4].every((id) => csvSet.has(id));
  chk("④-화면-==-CSV", eq4 && shown4.size > 0,
      `화면 ${shown4.size}건 · CSV ${csvSet.size}건` +
      (eq4 ? " — 같은 id 집합" : ` — 다르다: 화면만 [${[...shown4].filter((i) => !csvSet.has(i)).join(",")}]` +
        ` · CSV만 [${[...csvSet].filter((i) => !shown4.has(i)).join(",")}]`));

  // ── ⑤ 팀원 CSV 에 남의 개인 업무가 없다 (§C-28) + 짝 ───────────
  const csvMember = await csv(MEMBER, "");
  const csvAdmin = await csv(ADMIN, "");
  /*
   * **먼저 파일이 파일인지 묻는다.** 이 줄이 없으면 경로가 500 을 내도 아래
   * 「개인 업무 0건」이 초록으로 지나간다 — 빈 파일에는 아무것도 안 들어 있으니까.
   * 깨뜨려 보다가 바로 이 구멍에 걸렸다(§G 053: 아무것도 안 잰 값).
   */
  chk("⑤조건-두-파일이-멀쩡하다",
      csvMember.status === 200 && csvAdmin.status === 200
      && csvMember.ids.length > 0 && csvAdmin.ids.length > 0,
      `팀원 ${csvMember.status} ${csvMember.ids.length}행 · 관리자 ${csvAdmin.status} ${csvAdmin.ids.length}행`);
  chk("⑤-팀원-CSV-에-개인-업무-0건", !csvMember.ids.includes(secretId),
      `팀원(${MEMBER.name}) CSV ${csvMember.ids.length}행 · 개인 업무 #${secretId} ${csvMember.ids.includes(secretId) ? "**들어 있다**" : "없다"}`);
  chk("⑤짝-관리자-CSV-에는-있다", csvAdmin.ids.includes(secretId),
      `관리자 CSV ${csvAdmin.ids.length}행 · #${secretId} ${csvAdmin.ids.includes(secretId) ? "있다" : "**없다 — 위 줄이 뜻을 잃는다**"}`);
  // 팀원이 **화면에서** 못 보는 것이 파일에도 없다 — 집합으로 한 번 더.
  const memberScreen = await (async () => {
    const c2 = await browser.newContext({ viewport: { width: 1440, height: 1600 } });
    await c2.addCookies([{ name: "tb_session", domain: HOST, path: "/", value: tok(MEMBER) }]);
    const p2 = await c2.newPage();
    await p2.goto(`${BASE}/v3/tasks?done=1`, { waitUntil: "networkidle" });
    await p2.waitForTimeout(700);
    const hrefs = await p2.locator('.v3-card a[href^="/v3/tasks/"]').evaluateAll(
      (els) => els.map((e) => e.getAttribute("href")));
    await c2.close();
    return new Set(hrefs.map((h) => Number(String(h).split("/").pop())).filter(Number.isInteger));
  })();
  const leaked = csvMember.ids.filter((id) => !memberScreen.has(id));
  chk("⑤-2-파일에만-있는-것-0건", leaked.length === 0,
      `팀원 화면 ${memberScreen.size}건 · 파일 ${csvMember.ids.length}행 · 파일에만 [${leaked.join(",")}]`);

  // ── ⑥ BOM (§C-23) ────────────────────────────────────────────
  const bom = csvAdmin.buf.subarray(0, 3);
  const head = csvAdmin.lines[0] ?? "";
  chk("⑥-BOM-과-한글-머리줄",
      bom[0] === 0xEF && bom[1] === 0xBB && bom[2] === 0xBF && head.includes("제목") && head.includes("담당"),
      `첫 세 바이트 ${[...bom].map((b) => b.toString(16).toUpperCase()).join(" ")} · 머리줄 "${head}"`);

  // ── ⑦ 수식 주입 막기 (§C-24) + 짝 ─────────────────────────────
  const injLine = csvAdmin.lines.find((l) => l.startsWith(`${injectId},`)) ?? "";
  const normLine = csvAdmin.lines.find((l) => l.startsWith(`${mineId},`)) ?? "";
  chk("⑦-수식은-따옴표로-묶인다", injLine.includes(`"'=cmd`),
      `#${injectId} → ${injLine.slice(0, 64)}`);
  chk("⑦짝-평범한-제목은-안-건드린다", normLine.includes(`${MARK} 내 담당 업무`) && !normLine.includes("'["),
      `#${mineId} → ${normLine.slice(0, 64)}`);

  // ── ⑧ 누르기 전에는 안 만들어진다 (§C-22) ──────────────────────
  const btn = page.locator("a.v3-csv").first();
  const tag = await btn.evaluate((e) => e.tagName);
  chk("⑧-CSV-는-평범한-링크", tag === "A" && csvHits === 0,
      `<${tag.toLowerCase()} href> · 화면을 여섯 번 열기까지 /api/tasks/csv 요청 ${csvHits}건 (0이어야 한다)`);

  // ── ⑨ 빈 화면 두 문장 (§C-29) ─────────────────────────────────
  await screenIds("q=존재하지않는제목zzzz");
  const emptyTitle = (await page.locator(".v3-empty b").first().textContent()) ?? "";
  const emptyWhy = (await page.locator(".v3-empty p").first().textContent()) ?? "";
  chk("⑨-걸러서-0-과-원래-0-이-다르다",
      emptyTitle.includes("조건에 맞는") && emptyWhy.includes("걸린 조건") && !emptyTitle.trim().startsWith("업무가 없어요"),
      `"${emptyTitle.trim()}" / "${emptyWhy.trim().slice(0, 56)}"`);

  chk("콘솔오류·경고", errs.length === 0,
      `${errs.length}건${errs.length ? " — " + errs[0].slice(0, 110) : ""}`);
} catch (e) {
  fail += 1;
  console.error("\n넘어졌다 —", e.stack ?? e.message);
} finally {
  if (browser) await browser.close();
  for (const id of made) await pool.query(`DELETE FROM task WHERE id = $1`, [id]).catch(() => {});
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const ok = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})${ok ? "" : " **다르다**"}`);
    if (!ok) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  if (fail > 0) process.exitCode = 1;
}
