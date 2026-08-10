// MD-P-2026-031 §C1 · §C2 — 판단 타일과 기한 막대 목록 실측.
//
// **쓰기가 있다. 로컬 DSN 이 아니면 즉시 종료한다** (지시 32). 우회 플래그 없다.
//
// 이 검사가 지키는 것 넷.
//   ① **관측 도구부터 확인한다** — 콘솔 오류가 하나라도 있으면 측정 자체를 실패로 끝낸다.
//      dev 서버 청크가 404 인 상태로 잰 값은 값이 아니다. 실제로 한 번 헛짚었다.
//   ② **타일과 목록은 같은 함수에서 나온다** — 타일의 「지연 N」과 목록에서 코랄로 찍힌
//      행 수가 같아야 한다. 다르면 판정이 두 곳으로 갈린 것이다.
//   ③ **없는 상태는 만들어서 잰다** — 「내가 막는 것」도 잘린 막대도 지금 데이터에 없다.
//      만들고 재고 되돌린다. 안 밟은 분기는 통과가 아니라 미검사다.
//   ④ **stub 비율 ≤ 20%** — 넘으면 눈금 범위가 틀린 것이다.
//
//   AUTH_SECRET=... DATABASE_URL=postgres://…@127.0.0.1/… node scripts/deadline-walk.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-031/C";
const S = process.env.AUTH_SECRET;
const DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DSN)) {
  console.error("이 검사는 데이터를 바꾼다. **로컬 DSN 에서만 돈다.** 중단한다.");
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  console.log(`${ok ? "  ok " : "FAIL"} ${name.padEnd(30)} ${detail}`);
  ok ? pass++ : fail++;
};

const pool = new pg.Pool({ connectionString: DSN });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{
  name: "tb_session",
  value: tok({ id: 1, actorId: 1, name: "권정혁", role: "lead", email: "l@l" }),
  domain: new URL(BASE).hostname, path: "/",
}]);
const page = await ctx.newPage();

// ── ① 관측 도구 ──────────────────────────────────────────────────
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
// 페이지를 떠나며 취소된 요청은 오류가 아니다 — 그것까지 세면 검사가 늘 실패한다.
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "";
  if (/ABORTED/i.test(why)) return;
  consoleErrors.push(`요청 실패 ${r.url().slice(-50)} (${why})`);
});

const made = [];      // 만든 업무 id — finally 에서 지운다
const touched = [];   // 값을 바꾼 업무 — finally 에서 되돌린다

const mkTask = async (title, extra = {}) => {
  const cols = { area_id: 1, status: "todo", priority: "mid", work_type: "team",
    origin: "human", created_by: 1, assignee_id: 1, visibility: "team", is_active: true, ...extra };
  const keys = Object.keys(cols);
  const row = (await q(
    `INSERT INTO task (title, ${keys.join(", ")}) VALUES ($1, ${keys.map((_, i) => `$${i + 2}`).join(", ")}) RETURNING id`,
    [title, ...keys.map((k) => cols[k])]
  ))[0];
  made.push(row.id);
  return row.id;
};

const tiles = () => page.evaluate(() => Object.fromEntries(
  Array.from(document.querySelectorAll(".jt")).map((x) => [
    x.querySelector(".jt-l").textContent,
    { n: Number(x.querySelector(".jt-n").textContent), why: x.querySelector(".jt-why").textContent,
      zero: x.className.includes("zero"), href: x.getAttribute("href") },
  ])));

const bars = () => page.evaluate(() => ({
  bar: document.querySelectorAll(".tt-bar").length,
  stub: document.querySelectorAll(".tt-stub").length,
  nodate: document.querySelectorAll(".tt-nodate").length,
  clipS: document.querySelectorAll(".tt-bar.clip-s").length,
  clipE: document.querySelectorAll(".tt-bar.clip-e").length,
  ticks: Array.from(document.querySelectorAll(".tt-tick")).map((x) => x.textContent).join(" "),
}));

try {
  // ── §C1 타일 ────────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const t0 = await tiles();
  chk("C1-타일 4개", Object.keys(t0).length === 4,
    Object.entries(t0).map(([k, v]) => `${k} ${v.n}`).join(" · "));
  chk("C1-0건도 남는다", Object.values(t0).some((v) => v.n === 0 && v.zero),
    // 0건 타일이 하나도 없으면 이 단언은 아무것도 안 잰 것이다 — 그 경우를 구분해 적는다.
    Object.values(t0).some((v) => v.n === 0)
      ? `0건 타일이 회색으로 남아 있다` : "지금 데이터에 0건 타일이 없어 못 쟀다");
  chk("C1-사유 한 줄", Object.values(t0).every((v) => v.why && v.why.length > 0),
    `예: "${t0["지연"]?.why ?? "(없음)"}"`);

  // ② 타일의 「지연」 = 목록에서 코랄로 찍힌 행 수
  //
  // **상시 섹션을 먼저 펼친다.** 타일은 열린 업무 전체를 세고 목록은 기본이 메인만이라,
  // 접힌 채로 재면 늘 타일이 더 크게 나온다. 그건 판정이 갈린 것이 아니라
  // **검사가 화면의 일부만 본 것**이다(§G). 조건을 열고 잰다.
  await page.click(".hm-routine .fold").catch(() => {});
  await page.waitForTimeout(900);
  const listLate = await page.evaluate(() => {
    const coral = "rgb(196, 43, 48)";
    return Array.from(document.querySelectorAll("tbody .due .tt-dday"))
      .filter((el) => getComputedStyle(el).color === coral).length;
  });
  chk("C1-타일과 목록이 같은 수", t0["지연"].n === listLate,
    `타일 ${t0["지연"].n} · 목록 코랄 ${listLate} (dueUrgency 한 함수에서 나와야 같다)`);

  // ③ 「내가 막는 것」 — 지금 0건이면 만들어서 잰다
  const before = t0["내가 막는 것"].n;
  const cause = await mkTask("ZZ-내가막는원인");
  const waiter = await mkTask("ZZ-기다리는쪽", { assignee_id: 3, blocked: true, blocked_by: cause });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const t1 = await tiles();
  chk("C1-내가 막는 것 (만들어서 잼)", t1["내가 막는 것"].n === before + 1 && !t1["내가 막는 것"].zero,
    `전 ${before} → 후 ${t1["내가 막는 것"].n} · 사유 "${t1["내가 막는 것"].why}"`);
  await page.screenshot({ path: `${OUT}/C1-타일.png`, clip: { x: 180, y: 120, width: 1250, height: 300 } });

  // 타일을 눌러 그 조건이 걸린 목록으로 가고, **주소에 남는가**
  await page.goto(`${BASE}${t1["내가 막는 것"].href}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const blockingList = await page.evaluate(() => ({
    url: location.search,
    rows: Array.from(document.querySelectorAll("tbody tr:not(.tt-grp) td:nth-child(2)")).map((x) => x.textContent.trim()),
  }));
  chk("C1-타일 클릭 = 그 조건의 목록", blockingList.url.includes("blocking=1")
    && blockingList.rows.some((r) => r.includes("ZZ-내가막는원인")),
    `주소 "${blockingList.url}" · 첫 행 "${blockingList.rows[0] ?? "(없음)"}"`);

  // ── §C2 stub 비율 ───────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const qtr = await bars();
  const qtrPct = qtr.bar + qtr.stub ? (qtr.stub / (qtr.bar + qtr.stub)) * 100 : 0;
  chk("C2-stub 비율 ≤20% (이번 분기)", qtrPct <= 20,
    `막대 ${qtr.bar} · 구간 밖 ${qtr.stub} · 기한 없음 ${qtr.nodate} → ${qtrPct.toFixed(1)}% · 눈금 ${qtr.ticks}`);

  await page.click("text=전체 기간");
  await page.waitForTimeout(1600);
  const all = await bars();
  const allPct = all.bar + all.stub ? (all.stub / (all.bar + all.stub)) * 100 : 0;
  chk("C2-stub 비율 ≤20% (전체 기간)", allPct <= 20 && (await page.evaluate(() => location.search)).includes("span=all"),
    `막대 ${all.bar} · 구간 밖 ${all.stub} → ${allPct.toFixed(1)}% · 눈금 ${all.ticks}`);

  // ── §D6 잘린 막대 — 없으니 만들어서 잰다 ─────────────────────────
  // 이번 분기(7/01~) 앞에서 시작해 분기 안에서 끝나는 업무를 하나 만든다.
  const clipped = await mkTask("ZZ-분기밖에서시작", {});
  await q(`UPDATE task SET start_date = date_trunc('quarter', CURRENT_DATE)::date - 20,
             due_date = date_trunc('quarter', CURRENT_DATE)::date + 20 WHERE id = $1`, [clipped]);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2200);
  const clip = await page.evaluate(() => {
    const el = Array.from(document.querySelectorAll("tbody tr")).find((tr) => tr.textContent.includes("ZZ-분기밖에서시작"));
    const bar = el?.querySelector(".tt-bar");
    if (!bar) return null;
    const cs = getComputedStyle(bar);
    return { cls: bar.className, tl: cs.borderTopLeftRadius, tr: cs.borderTopRightRadius };
  });
  chk("D6-잘린 쪽은 각지고 반대쪽은 둥글다",
    !!clip && clip.cls.includes("clip-s") && parseFloat(clip.tl) === 0 && parseFloat(clip.tr) > 0,
    clip ? `class="${clip.cls}" 왼쪽 ${clip.tl} · 오른쪽 ${clip.tr}` : "그 업무의 막대를 못 찾았다");

  // ── §G 중간 상태도 상태다 — 첫 렌더와 확정 렌더의 순서가 같은가 ──
  const order = [];
  const p2 = await ctx.newPage();
  p2.on("console", () => {});
  await p2.goto(`${BASE}/tasks?sort=manual`, { waitUntil: "domcontentloaded" });
  for (let i = 0; i < 12; i++) {
    const rows = await p2.$$eval("tbody tr:not(.tt-grp) td:nth-child(2)", (els) => els.slice(0, 3).map((e) => e.textContent.trim()));
    if (rows.length) order.push(rows.join("|"));
    await p2.waitForTimeout(300);
  }
  const distinct = Array.from(new Set(order));
  chk("G-첫 렌더 = 확정 렌더", distinct.length <= 1,
    distinct.length <= 1 ? `표본 ${order.length}회 모두 같은 순서` : `순서가 ${distinct.length}가지로 바뀌었다 — ${distinct.join("  //  ")}`);
  await p2.close();

  chk("콘솔 오류 0건", consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 2).join(" / ") : "관측 도구가 성했다");
} finally {
  await browser.close();
  if (made.length) await q(`DELETE FROM task WHERE id = ANY($1::int[])`, [made]);
  for (const t of touched) await q(`UPDATE task SET due_date = $2 WHERE id = $1`, [t.id, t.due_date]);
  console.log(`\n정리 — 만든 업무 ${made.length}건 삭제`);
  await pool.end();
}

console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
