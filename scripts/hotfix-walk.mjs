// MD-P-2026-031 오픈 전 핫픽스 검증 — H-1 이름 중복 · H-2 기한 표시 · H-3 개발 과정 안내.
//
// **쓰기가 있다. 로컬 DSN 이 아니면 즉시 종료한다** (지시 32). 우회 플래그 없다.
// H-2 는 "지연은 빨갛다"만 재면 통과한다 — 그런데 임박(D-DAY~D-7)이 데이터에 하나도
// 없으면 그 등급이 아예 안 밟힌다. 그래서 **없는 등급은 만들어서 재고 되돌린다.**
// 부재 단언에는 짝이 되는 존재 단언을 붙인다.
//
//   AUTH_SECRET=... DATABASE_URL=postgres://…@127.0.0.1/… node scripts/hotfix-walk.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET;
const DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DSN)) {
  console.error("이 검사는 데이터를 바꾼다. **로컬 DSN 에서만 돈다.** 중단한다.");
  process.exit(1);
}

const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const CORAL = "rgb(196, 43, 48)";   // --coral-text
const AMBER = "rgb(138, 90, 8)";    // --amber-text

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  console.log(`${ok ? "  ok " : "FAIL"} ${name.padEnd(28)} ${detail}`);
  ok ? pass++ : fail++;
};

const pool = new pg.Pool({ connectionString: DSN });
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
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));

/** 기한 칸의 (텍스트 → 색·굵기) 표. 세 화면이 같은 모양으로 낸다. */
const readDue = (sel) => page.evaluate((s) => {
  const out = {};
  for (const el of document.querySelectorAll(s)) {
    const t = el.textContent.trim();
    if (!t || t === "—") continue;
    const cs = getComputedStyle(el);
    const cell = el.closest("td") ?? el;
    out[t] = { cls: `${el.className} ${cell === el ? "" : cell.className}`.trim(), color: cs.color, weight: cs.fontWeight };
  }
  return out;
}, sel);

const touched = [];
try {
  // ── H-1 구성원 이름 ───────────────────────────────────────────────
  await page.goto(`${BASE}/members`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const mem = await page.evaluate(() => {
    const head = Array.from(document.querySelectorAll("table thead th")).map((t) => t.textContent.trim());
    const rows = Array.from(document.querySelectorAll("table tbody tr")).map((tr) =>
      Array.from(tr.querySelectorAll("td")).slice(0, 3).map((td) => td.textContent.trim()));
    return { head, rows };
  });
  const nameCells = mem.rows.map((r) => r[0]);
  // 같은 사람 이름이 한 칸 안에서 두 번 나오면 안 된다. "권정혁 · 정혁 에이전트 정혁의 에이전트" 가 그랬다.
  const dup = nameCells.filter((c) => {
    const base = c.replace(/비번변경 대기/g, "").trim();
    return /(.{2,})\s.*\1/.test(base);
  });
  chk("H-1 이름 칸 중복 없음", dup.length === 0 && nameCells.length > 0,
    `${nameCells.length}행 · 중복 ${dup.length}건${dup.length ? " — " + dup[0] : ""} · 첫 행 "${nameCells[0] ?? "(없음)"}"`);
  chk("H-1 에이전트는 자기 열", mem.head[2] === "에이전트" && mem.rows.every((r) => r[2] && r[2].length > 0),
    `머리글 [${mem.head.join(" · ")}] · 첫 행 에이전트 "${mem.rows[0]?.[2] ?? "(없음)"}"`);

  // ── H-3 목표 화면 ────────────────────────────────────────────────
  await page.goto(`${BASE}/goals`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const goals = await page.evaluate(() => ({
    notice: !!document.querySelector(".lmn"),
    banner: document.querySelector(".ulbanner")?.textContent.trim() ?? null,
  }));
  chk("H-3 개발 과정 안내 없음", goals.notice === false, `.lmn ${goals.notice ? "있음" : "없음"}`);
  // 부재 단언 옆의 존재 단언 — 화면 자체가 안 그려진 것과 구분한다.
  chk("H-3 미연결 줄은 남음", !!goals.banner && /연결하면 진척에 집계/.test(goals.banner) && !/없어졌습니다/.test(goals.banner),
    `"${goals.banner ?? "(없음)"}"`);

  // ── H-2 기한 표시 ────────────────────────────────────────────────
  // 지금 데이터에 없는 등급은 만들어서 잰다. 끝나면 되돌린다.
  const rows = (await pool.query(
    `SELECT id, due_date FROM task
      WHERE is_active AND parent_task_id IS NULL AND status <> 'done'
      ORDER BY id LIMIT 2`
  )).rows;
  if (rows.length < 2) { console.error("업무가 2건 미만이다 — 검사할 수 없다."); process.exit(1); }
  touched.push(...rows);
  await pool.query(`UPDATE task SET due_date = CURRENT_DATE + 3 WHERE id = $1`, [rows[0].id]);
  await pool.query(`UPDATE task SET due_date = CURRENT_DATE - 5 WHERE id = $1`, [rows[1].id]);

  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const sheet = await readDue(".due .tt-dday");
  const late = Object.entries(sheet).find(([t]) => /^D\+\d+$/.test(t));
  const soon = Object.entries(sheet).find(([t]) => t === "D-DAY" || (/^D-(\d+)$/.test(t) && Number(RegExp.$1) <= 7));
  const norm = Object.entries(sheet).find(([t]) => /^D-(\d+)$/.test(t) && Number(RegExp.$1) > 7);
  chk("H-2 목록 · 지연", !!late && late[1].color === CORAL && late[1].weight === "700",
    late ? `${late[0]} → ${late[1].color} / ${late[1].weight}` : "지연 건이 화면에 없다");
  chk("H-2 목록 · 임박", !!soon && soon[1].color === AMBER && soon[1].weight === "700",
    soon ? `${soon[0]} → ${soon[1].color} / ${soon[1].weight}` : "임박 건이 화면에 없다");
  chk("H-2 목록 · 보통은 그대로", !!norm && norm[1].color !== CORAL && norm[1].color !== AMBER,
    norm ? `${norm[0]} → ${norm[1].color} / ${norm[1].weight}` : "보통 건이 화면에 없다");

  // 보드 — 같은 함수를 쓰는지 화면에서 확인한다. 코드가 같아도 클래스가 안 붙으면 소용없다.
  await page.click(".pg-tab >> nth=1");
  await page.waitForTimeout(1300);
  const board = await readDue(".tb-dday");
  const bLate = Object.entries(board).find(([t]) => /^D\+\d+$/.test(t));
  const bSoon = Object.entries(board).find(([t]) => t === "D-DAY" || (/^D-(\d+)$/.test(t) && Number(RegExp.$1) <= 7));
  chk("H-2 보드 · 지연", !!bLate && bLate[1].color === CORAL && bLate[1].weight === "700",
    bLate ? `${bLate[0]} → ${bLate[1].color} / ${bLate[1].weight}` : "지연 건이 보드에 없다");
  chk("H-2 보드 · 임박", !!bSoon && bSoon[1].color === AMBER && bSoon[1].weight === "700",
    bSoon ? `${bSoon[0]} → ${bSoon[1].color} / ${bSoon[1].weight}` : "임박 건이 보드에 없다");

  // 홈 「다가오는 일정」 — 미래만 담는 목록이라 지연은 올 수 없다. 임박만 확인한다.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const home = await readDue(".hm-dd");
  const hSoon = Object.entries(home).find(([, v]) => v.cls.includes("over"));
  const hLate = Object.entries(home).find(([t]) => /^D\+\d+$/.test(t));
  chk("H-2 홈 · 임박", !!hSoon && hSoon[1].color === AMBER,
    hSoon ? `${hSoon[0]} → ${hSoon[1].color}` : "임박 건이 홈에 없다");
  chk("H-2 홈 · 지연은 안 온다", !hLate,
    hLate ? `${hLate[0]} 이 떴다 — 미래만 담는 목록이라는 전제가 깨졌다` : "미래만 담는 목록이 맞다");

  chk("JS 오류 없음", jsErrors.length === 0, `${jsErrors.length}건${jsErrors[0] ? " — " + jsErrors[0].slice(0, 80) : ""}`);
} finally {
  await browser.close();
  for (const r of touched) {
    await pool.query(`UPDATE task SET due_date = $2 WHERE id = $1`, [r.id, r.due_date]);
  }
  if (touched.length) console.log(`\n정리 — 기한 ${touched.length}건 원래 값으로 되돌림`);
  await pool.end();
}

console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
