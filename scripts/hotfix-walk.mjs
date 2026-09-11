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

/** 보는 사람. 쿠키와 **같은 사람**이라야 「내 담당」 기본 거르개 안에 조건을 만들 수 있다. */
const VIEWER = 1;

/**
 * 담당 거르개를 「전체」로 돌린다.
 *
 * 예전에는 `selectOption(..., "")` 였다. 그 값이 `"all"` 로 바뀌면서 선택이
 * **30초 타임아웃**이 났는데, `.catch(() => {})` 가 그걸 삼켜서 「안 눌렸다」가
 * 「안 걸렸다」로 넘어갔다 (§G 051 · 실패를 삼키지 않는다).
 *
 * 그래서 값을 박지 않고 **「전체」라고 적힌 선택지를 찾아** 고르고,
 * 못 고르면 **소리 내어 적는다.**
 */
async function clearAssignee(page) {
  const sel = page.locator('select[aria-label="담당"]');
  if (!(await sel.count())) { console.error("   ! 담당 거르개가 없다 — 화면이 바뀌었는가"); return false; }
  const all = await sel.locator("option").evaluateAll((els) => {
    const m = els.find((o) => /전체/.test(o.textContent ?? ""));
    return m ? m.value : null;
  });
  if (all === null) { console.error("   ! 담당 거르개에 「전체」 선택지가 없다"); return false; }
  try {
    await sel.selectOption(all, { timeout: 5000 });
    return true;
  } catch (e) {
    console.error("   ! 담당을 「전체」로 못 돌렸다 —", String(e.message).slice(0, 60));
    return false;
  }
}

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
    // audit:absent — 없는 것이 정상. H-3 이 지운 안내가 안 돌아오는지 본다.
    notice: !!document.querySelector(".lmn"),
    banner: document.querySelector(".ulbanner")?.textContent.trim() ?? null,
  }));
  chk("H-3 개발 과정 안내 없음", goals.notice === false, `.lmn ${goals.notice ? "있음" : "없음"}`);
  // 부재 단언 옆의 존재 단언 — 화면 자체가 안 그려진 것과 구분한다.
  chk("H-3 미연결 줄은 남음", !!goals.banner && /연결하면 진척에 집계/.test(goals.banner) && !/없어졌습니다/.test(goals.banner),
    `"${goals.banner ?? "(없음)"}"`);

  /* ── H-2 기한 표시 ──────────────────────────────────────────────
   *
   * 지금 데이터에 없는 등급은 만들어서 잰다. 끝나면 되돌린다.
   *
   * ── 053 에서 고친 것 두 가지 ──────────────────────────────────
   *
   * ① **보는 사람의 업무로 만든다.** 예전에는 `ORDER BY id LIMIT 2` 로 아무
   *    업무나 집었는데, 그 둘이 남의 담당이면 「내 담당」이 기본인 목록과
   *    홈 「다가오는 일정」에 아예 안 뜬다. 색이 틀린 것이 아니라 **대상을 못 본
   *    것**인데, 실패 문구는 「임박 건이 화면에 없다」로 같아서 구별이 안 됐다.
   * ② **「보통」도 만든다.** D-8 이상은 데이터에 있으려니 하고 안 만들었다.
   *    실데이터의 기한이 전부 지나면서 그 등급이 사라졌다 (§G 035).
   */
  const rows = (await pool.query(
    `SELECT id, due_date FROM task
      WHERE is_active AND parent_task_id IS NULL AND status <> 'done'
        AND assignee_id = $1
      ORDER BY id LIMIT 3`, [VIEWER]
  )).rows;
  if (rows.length < 3) {
    console.error(`보는 사람(actor ${VIEWER}) 담당 업무가 ${rows.length}건이다 — 3건이 있어야 세 등급을 만든다.`);
    process.exit(1);
  }
  touched.push(...rows);
  await pool.query(`UPDATE task SET due_date = CURRENT_DATE + 3 WHERE id = $1`, [rows[0].id]);   // 임박
  await pool.query(`UPDATE task SET due_date = CURRENT_DATE - 5 WHERE id = $1`, [rows[1].id]);   // 지연
  await pool.query(`UPDATE task SET due_date = CURRENT_DATE + 30 WHERE id = $1`, [rows[2].id]);  // 보통
  console.log(`   (조건) 임박 #${rows[0].id} · 지연 #${rows[1].id} · 보통 #${rows[2].id}` +
              ` — 전부 actor ${VIEWER} 담당이라 기본 거르개 안에 있다`);

  // **필터를 먼저 연다.** /tasks 는 기본이 "내 영역 + 내 담당"이라, 우리가 손댄 업무가
  // 그 필터 밖이면 등급이 화면에 아예 안 나타난다. 그러면 "임박이 없다"가 되는데
  // 그건 색이 틀린 것이 아니라 **검사가 대상을 못 본 것**이다. 둘을 구별해야 한다.
  await page.goto(`${BASE}/tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "전체 영역" }).click()
    .catch((e) => console.error("   ! 「전체 영역」을 못 눌렀다 —", String(e.message).slice(0, 60)));
  await clearAssignee(page);
  await page.waitForTimeout(1400);
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

  /* ── 홈 「다가오는 일정」 검사는 **지웠다** (053 §B-30) ──────────
   *
   * 그 블록은 MD-P-2026-032 §D4 에서 화면에서 내려갔다. 소스가 개인 캘린더
   * 하나뿐이라 대부분 빈 카드가 됐기 때문이다. `components/HomeView.tsx` 의
   * §D4 주석이 「코드·CSS·검사 세 곳에서 동시에 지웠다」고 적고 있는데,
   * **여기 둘이 안 지워져 있었다.**
   *
   * 그래서 「홈 · 임박」은 없는 블록을 찾다 떨어졌고, 짝인 「홈 · 지연은 안 온다」는
   * 블록이 통째로 없으니 **늘 통과하는 죽은 단언**이었다. 하나는 거짓 실패,
   * 하나는 거짓 성공 — 둘 다 아무것도 안 재고 있었다.
   *
   * 「다가오는 일정」은 032 의 허들룸 재설계에서 개념이 선 뒤에 다시 만든다.
   * 그때 이 검사도 함께 세운다 — 지금 남겨 두면 그때 이 낡은 모양에 맞추게 된다.
   */

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
