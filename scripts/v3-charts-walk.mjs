// v3 「집계」 원그래프 실측 (MD-P-2026-056 §B).
//
// **로컬 전용** (지시 32). 만든 것과 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 고리 셋이 **같은 함수에서** 나온다 — 화면 숫자 = `ringOf` 출력
//   ② 기한 없는 건수가 **화면 어딘가에 적혀 있다** (안 세는 것이 보인다)
//   ③ 고리 색이 **셋 다 같다** · 값이 달라도 안 바뀐다 (조건을 먼저 만든다)
//   ④ 막대 색이 **지시서 값 그대로**다
//   ⑤ 조각마다 **숫자가 적혀 있고** 사이에 틈이 있다 · 숫자가 읽힌다(대비 4.5 이상)
//   ⑥ 0건인 구간은 안 그리고 **범례에는 0으로** 남는다
//   ⑦ 막대 합이 기간 전체와 맞는지 **화면이 스스로 말한다**
//   ⑧ 「마지막 갱신」이 **서버 시각**이다 (브라우저 시계가 아니다)
//   ⑨ 표로 보기 — 같은 숫자가 나온다 (그림과 표가 안 갈린다)
//   ⑩ 호버 영역이 **조각보다 크다**
//   ⑪ 달을 옮기면 **셋이 다 따라간다**
//   ⑫ 콘솔 오류 0
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-charts-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".v3c-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-056";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[056고리]";

/** 두 색의 대비비. WCAG 식 그대로 — 눈으로 「읽히겠지」 하지 않는다. */
function contrast(a, b) {
  const lum = (hex) => {
    const v = hex.replace("#", "").match(/../g).map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** `rgb(47, 111, 237)` → `#2f6fed` */
const toHex = (rgb) => {
  const m = rgb.match(/\d+/g);
  return "#" + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, "0")).join("");
};

let browser, swBefore = null, beforeCount = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "v3", "stats.ts"), path.join(REPO, "lib", "v3", "tasks.ts"),
     path.join(REPO, "lib", "v3", "today.ts"), path.join(REPO, "lib", "v3", "category.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  const { rangesFor, ringOf, distribution, DIST_SEGMENTS, daysLeft, ringDash } =
    req(path.join(TMP, "v3", "stats.js"));

  // 짝조건 — **0으로 안 나눈다.** 분모가 0인 달을 100% 로 읽으면 아무 일도 없는
  // 달이 「다 했다」로 보인다. 할 일이 없는 것과 다 한 것은 다르다.
  const empty = ringOf([], rangesFor("2026-07")[2], "2026-07-15");
  chk("0-짝조건-0으로-안-나눈다",
      empty.pct === 0 && empty.total === 0 && empty.done === 0
      && daysLeft("2026-08-01", "2026-07-31") === 0
      && Math.round(ringDash(50, 10).dash) === Math.round(Math.PI * 10),
      `빈 달 → ${empty.pct}% (${empty.done}/${empty.total}) · 지난 기간의 남은 날 ` +
      `${daysLeft("2026-08-01", "2026-07-31")}일 · 50%는 둘레의 절반`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };
  beforeCount = (await sql(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`]))[0].n;

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order, id LIMIT 1`))[0].id;
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  const ym = today.slice(0, 7);

  /*
   * ── 조건을 먼저 만든다 ──────────────────────────────────────────
   *
   * ③ 이 뜻을 가지려면 **완료율이 서로 다른 기간**이 있어야 한다. 값이 다 같으면
   * 「색이 안 바뀐다」가 아무것도 안 잰다(§G 053).
   * 그래서 이 달에는 완료를 많이, 같은 분기의 **다른 달**에는 적게 넣는다.
   */
  const mk = async (title, status, due) => (await sql(
    `INSERT INTO task (title, description, area_id, assignee_id, created_by, status, due_date,
                       priority, origin, work_type, visibility, goal_source, is_active)
     VALUES ($1, '', $2, $3, $3, $4, $5::date, 'mid', 'human', 'team', 'team', 'manual', true)
     RETURNING id`, [title, areaId, me.id, status, due]))[0].id;

  for (let i = 0; i < 4; i += 1) await mk(`${MARK} 이달완료 ${i}`, "done", `${ym}-10`);
  await mk(`${MARK} 이달진행`, "doing", `${ym}-11`);
  await mk(`${MARK} 이달대기`, "todo", `${ym}-13`);
  // 「검토 중」은 **일부러 안 넣는다.** ⑥(0건은 범례에만)이 뜻을 가지려면
  // 0건인 구간이 실제로 있어야 한다 — 넷 다 채우면 늘 통과한다(§G 053).
  // 같은 분기의 다른 달 — 연간·분기 비율을 이 달과 **다르게** 만든다.
  const [y, m] = ym.split("-").map(Number);
  const sib = m % 3 === 1 ? m + 1 : m - 1;          // 같은 분기 안의 다른 달
  const sibYm = `${y}-${String(sib).padStart(2, "0")}`;
  for (let i = 0; i < 5; i += 1) await mk(`${MARK} 옆달대기 ${i}`, "todo", `${sibYm}-05`);

  const noDueN = (await sql(
    `SELECT count(*)::int n FROM task WHERE is_active AND status <> 'proposed' AND due_date IS NULL`))[0].n;
  const reviewN = (await sql(
    `SELECT count(*)::int n FROM task WHERE is_active AND status = 'review'
       AND to_char(due_date, 'YYYY-MM') = $1`, [ym]))[0].n;
  chk("0-조건을-먼저-만들었다", reviewN === 0,
      `이 달(${ym}) 완료4·진행1·대기1 · 옆달(${sibYm}) 대기5 · 기한 없음 ${noDueN}건` +
      ` · 검토 중 ${reviewN}건(0이라야 ⑥ 이 뜻을 가진다) — 기간마다 비율이 달라야 ③도 뜻을 가진다`);

  await setSwitch(true);
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1400 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                 adminGrant: me.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));

  await page.goto(`${BASE}/v3/stats`, { waitUntil: "networkidle" });
  await page.locator(".v3-ring").first().waitFor({ timeout: 9000 });

  // ── ① 고리 셋 = `ringOf` 출력 ─────────────────────────────────
  const apiTasks = await page.evaluate(async () => (await (await fetch("/api/tasks")).json()).tasks);
  const want = rangesFor(ym).map((r) => ringOf(apiTasks, r, today));
  // SVG `<text>` 에는 `innerText` 가 없다 — `allInnerTexts()` 는 undefined 를 돌려준다.
  // 처음에 그걸로 읽다가 죽었다. 글자를 읽을 때는 `textContent` 다.
  const pcts = (await page.locator(".v3-ring-p").allTextContents()).map((t) => t.trim());
  const nums = (await page.locator(".v3-ring-n").allTextContents()).map((t) => t.replace(/\s+/g, ""));
  const caps = (await page.locator(".v3-ring figcaption span").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  chk("①-고리-셋이-같은-함수에서",
      pcts.join("|") === want.map((r) => `${r.pct}%`).join("|")
      && nums.join("|") === want.map((r) => `${r.done}/${r.total}건`).join("|")
      && caps.join("|") === want.map((r) => `남은 것 ${r.left}건 · ${r.daysLeft}일`).join("|"),
      `화면 [${pcts.join(", ")}] [${nums.join(", ")}] · ringOf [${want.map((r) => `${r.pct}%`).join(", ")}]` +
      ` [${want.map((r) => `${r.done}/${r.total}건`).join(", ")}]`);

  // ── ② 기한 없는 건수가 화면에 ─────────────────────────────────
  const body = (await page.locator(".v3-main").innerText()).replace(/\s+/g, " ");
  chk("②-기한-없는-건수가-보인다",
      noDueN === 0 || body.includes(`기한 없는 ${noDueN}건`),
      noDueN === 0 ? "기한 없는 업무가 0건이라 적을 것이 없다"
        : `화면에 "기한 없는 ${noDueN}건" ${body.includes(`기한 없는 ${noDueN}건`) ? "있음" : "**없음**"}` +
          ` — 안 세는 것이 보여야 한다`);

  // ── ③ 고리 색이 셋 다 같다 (값은 서로 다르다) ─────────────────
  const strokes = await page.locator(".v3-ring svg circle:nth-child(2)")
    .evaluateAll((els) => els.map((e) => e.getAttribute("stroke")));
  const distinct = new Set(want.map((r) => r.pct)).size;
  chk("③-고리-색이-셋-다-같다",
      strokes.length === 3 && new Set(strokes).size === 1 && strokes[0] === "#2F6FED"
      && distinct > 1,
      `획 색 [${Array.from(new Set(strokes)).join(", ")}] · 값은 ${distinct}가지로 서로 다름` +
      ` (${want.map((r) => r.pct + "%").join(" / ")}) — 값이 달라도 색이 같다`);

  // ── ④⑤ 막대 색과 숫자 ────────────────────────────────────────
  const segs = page.locator(".v3-bar2-s");
  const segN = await segs.count();
  const shown = await segs.evaluateAll((els) => els.map((e) => ({
    bg: getComputedStyle(e).backgroundColor,
    ink: getComputedStyle(e).color,
    text: (e.textContent ?? "").trim(),
    gap: getComputedStyle(e.parentElement).gap,
  })));
  const wantColors = DIST_SEGMENTS.map((s) => s.color.toLowerCase());
  chk("④-막대-색이-지시서-값-그대로",
      shown.every((s) => wantColors.includes(toHex(s.bg))),
      `그려진 바탕 [${shown.map((s) => toHex(s.bg)).join(", ")}] · 지시서 [${wantColors.join(", ")}]`);

  const worst = shown.map((s) => contrast(toHex(s.bg), toHex(s.ink)));
  chk("⑤-조각마다-숫자-·-읽힌다",
      shown.every((s) => /^\d+$/.test(s.text)) && shown[0].gap === "2px"
      && worst.every((c) => c >= 4.5),
      `조각 ${segN}개 숫자 [${shown.map((s) => s.text).join(", ")}] · 틈 ${shown[0]?.gap}` +
      ` · 대비 [${worst.map((c) => c.toFixed(1)).join(", ")}] (4.5 이상이라야 읽힌다)`);

  // ── ⑥ 0건은 안 그리고 범례에는 0으로 ──────────────────────────
  const monthDist = distribution(apiTasks, rangesFor(ym)[2]);
  const zero = monthDist.segments.filter((s) => s.n === 0);
  const legend = (await page.locator(".v3-legend li").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  chk("⑥-0건은-범례에만",
      segN === monthDist.segments.filter((s) => s.n > 0).length
      && legend.length === 4
      && zero.every((s) => legend.some((l) => l === `${s.label} 0`)),
      `그린 조각 ${segN}개 · 0건 구간 ${zero.length}개 [${zero.map((s) => s.label).join(", ")}]` +
      ` · 범례 [${legend.join(" | ")}]`);

  // ── ⑦ 막대 합을 화면이 스스로 말한다 ─────────────────────────
  const recon = (await page.locator(".v3-recon").last().innerText()).replace(/\s+/g, " ");
  chk("⑦-막대-합을-화면이-말한다",
      recon.startsWith("막대 합이 맞습니다") && recon.includes(String(monthDist.total)),
      `"${recon.slice(0, 100)}"`);

  // ── ⑧ 「마지막 갱신」이 서버 시각 ──────────────────────────────
  const srv = await page.evaluate(async () => (await fetch("/api/tasks")).headers.get("date"));
  const srvClock = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(Date.parse(srv)));
  const stamp = (body.match(/마지막 갱신 (\d{2}:\d{2})/) ?? [])[1] ?? "";
  chk("⑧-마지막-갱신이-서버-시각", stamp !== "" && stamp === srvClock,
      `화면 "${stamp}" · 응답 Date 머리글의 KST "${srvClock}"`);

  // ── ⑩ 호버 영역이 조각보다 크다 ───────────────────────────────
  const hit = await segs.first().evaluate((e) => {
    const a = e.getBoundingClientRect();
    const after = getComputedStyle(e, "::after");
    return { h: a.height, top: after.top, bottom: after.bottom };
  });
  chk("⑩-호버-영역이-조각보다-크다",
      hit.top === "-8px" && hit.bottom === "-8px",
      `조각 높이 ${hit.h}px · 잡히는 영역이 위아래로 ${hit.top}/${hit.bottom} 만큼 넓다` +
      ` — 폭은 안 늘린다(비율이 거짓말하면 안 된다)`);
  await page.screenshot({ path: `${OUT}/B-원그래프.png`, fullPage: true });

  // ── ⑨ 표로 보기 — 같은 숫자 ──────────────────────────────────
  await page.locator(".v3-chartbtn").click();
  await page.locator(".v3-tbl-2").waitFor({ timeout: 9000 });
  // 표가 둘이다. `.v3-charts .v3-tbl` 은 **둘 다** 잡는다 — 기간 표만 본다.
  const tblPct = (await page.locator(".v3-charts .v3-tbl:not(.v3-tbl-2) tbody td.n")
    .allInnerTexts()).map((t) => t.trim());
  const wantCells = want.flatMap((r) => [String(r.done), String(r.total), `${r.pct}%`, String(r.left), `${r.daysLeft}일`]);
  const tbl2 = (await page.locator(".v3-tbl-2 tbody td.n").allInnerTexts()).map((t) => t.trim());
  chk("⑨-표가-그림과-같은-숫자",
      tblPct.join("|") === wantCells.join("|")
      && tbl2.slice(0, 4).join("|") === monthDist.segments.map((s) => String(s.n)).join("|"),
      `기간 표 [${tblPct.join(", ")}] · 상태 표 [${tbl2.join(", ")}]`);
  await page.screenshot({ path: `${OUT}/B-표로보기.png`, fullPage: true });
  await page.locator(".v3-chartbtn").click();

  // ── ⑪ 달을 옮기면 셋이 다 따라간다 ────────────────────────────
  const before3 = (await page.locator(".v3-ring figcaption b").allInnerTexts()).map((t) => t.trim());
  await page.locator(".v3-calbar button").filter({ hasText: "지난달" }).click();
  await page.waitForTimeout(900);
  const after3 = (await page.locator(".v3-ring figcaption b").allInnerTexts()).map((t) => t.trim());
  chk("⑪-달을-옮기면-셋이-따라간다",
      after3.length === 3 && after3[2] !== before3[2]
      && after3.join("|") === rangesFor(new URL(page.url()).searchParams.get("m")).map((r) => r.label).join("|"),
      `[${before3.join(" · ")}] → [${after3.join(" · ")}] · 주소 ?m=${new URL(page.url()).searchParams.get("m")}`);

  chk("⑫-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  await ctx.close();

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await pool.query(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1)`, [`${MARK}%`]).catch(() => {});
  await pool.query(`DELETE FROM task WHERE title LIKE $1`, [`${MARK}%`]).catch((e) => console.error("업무 정리 실패", e.message));
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    const nowVal = now === undefined ? null : now.value;
    const left = (await pool.query(`SELECT count(*)::int n FROM task WHERE title LIKE $1`, [`${MARK}%`])).rows[0].n;
    const same = JSON.stringify(nowVal) === JSON.stringify(swBefore) && left === beforeCount;
    console.log(`\n뒷정리 확인 — 스위치 ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})` +
                ` · ${MARK} 업무 ${left}건 (시작 전 ${beforeCount})${same ? "" : " **다르다**"}`);
    if (!same) process.exitCode = 1;
  } catch (e) {
    console.error("뒷정리 실패 —", e.message);
    process.exitCode = 1;
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
