// 가오픈까지 — v3 기준 재고 조사 (MD-P-2026-065 §E).
//
// ── 무엇을 하는가 ───────────────────────────────────────────────
//
// **고치지 않는다. 세기만 한다.** 옛 화면이 가진 것과 v3 가 가진 것을 나란히 놓고
// 셋으로 가른다 — 된다 · 반만 된다 · 없다.
//
// 「가오픈에 필요한가」는 **여기서 판단하지 않는다**(§E-16). 무엇이 어떤 상태인지만
// 적는다. 판단을 붙이면 재고 조사가 아니라 제안서가 된다.
//
// ── 어떻게 가르는가 ────────────────────────────────────────────
//
//   된다      v3 에 그 화면이 있고, 옛 화면이 하던 **동작**이 거기서도 된다
//   반만 된다  화면은 있는데 빠진 동작이 있다 (무엇이 빠졌는지 한 줄)
//   없다      v3 에 화면이 없다
//
// 「동작」은 소스가 아니라 **화면에서** 센다 — 버튼·링크·입력칸을 세어 이름을 적는다.
// 코드에 있는데 화면에 안 나오는 것은 사람에게 없는 것이다.
//
// **로컬 전용** · 읽기만 한다. 스위치는 시작 전으로 되돌린다.
//
// ⚠ | head 로 파이프하지 말 것.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-gap-survey.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const KEY = "ui_v3_enabled";

/**
 * 옛 화면이 사람에게 내주는 자리 — 사이드바 메뉴에서 그대로 가져왔다.
 * 「무엇이 있었나」를 내 기억이 아니라 **제품의 메뉴**에서 가져온다.
 */
const LEGACY = [
  { path: "/",           what: "대문 — 가오픈 카운트다운 · 팀 타임라인 · 지연/이번 주/막힘 · 진행 중인 일 · 목표 · 결정 대기" },
  { path: "/tasks",      what: "업무 목록 — 표·보드·타임라인 렌즈 · 거르기 · 정렬 · 인라인 추가 · 일괄 지정 · 상세 패널" },
  { path: "/goals",      what: "목표 나무 — 연/분기/월 · 진척 롤업 · 목표-업무 연결" },
  { path: "/projects",   what: "프로젝트 목록" },
  { path: "/projects/1", what: "프로젝트 작업실 — 업무 표 · 리소스 링크 · 상태" },
  { path: "/calendar",   what: "캘린더 — 월/주 · 기간 막대" },
  { path: "/signals",    what: "시그널 — 결정/검토/메모/위험 · 정체 표시" },
  { path: "/inbox",      what: "승인 인박스 — 에이전트 제안 승인·반려" },
  { path: "/activity",   what: "활동 로그" },
  { path: "/huddle",     what: "허들룸 — 리뷰 세션" },
  { path: "/reports",    what: "보고 — 성과 리포트(전원) · 승인 보고서(팀장)" },
  { path: "/handover",   what: "인수인계 문서 — 만들기·공유·PDF" },
  { path: "/members",    what: "구성원 관리 — 역할·관리자 권한·비활성 (관리자)" },
  { path: "/settings",   what: "설정 — 플랫폼·노션 범위 (팀장)" },
  { path: "/saved",      what: "저장한 보기" },
  { path: "/notes",      what: "메모" },
  { path: "/profile",    what: "내 프로필" },
  { path: "/status",     what: "시스템 상태" },
  { path: "/areas/1",    what: "영역 화면" },
  { path: "/open-due",   what: "가오픈 기준 기한 집계 (팀장)" },
  { path: "/admin/agent-usage", what: "에이전트 흔적 (관리자 · 철거 예정)" },
];

/** v3 가 지금 가진 화면. 레일에 적힌 것 + 스위치가 아는 주소. */
const V3 = ["/v3", "/v3/tasks", "/v3/team", "/v3/new", "/v3/calendar", "/v3/stats"];

let browser, swBefore = null;
try {
  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name n FROM account a
       JOIN actor ac ON ac.id = a.actor_id
      WHERE a.role = 'admin' ORDER BY a.actor_id LIMIT 1`))[0];
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: me.n, role: me.role, adminGrant: me.admin_grant, email: "x@x" }) }]);

  /** 그 화면이 사람에게 내주는 동작 — 이름이 있는 것만 센다. */
  const survey = async (path) => {
    const page = await ctx.newPage();
    const res = await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => null);
    await page.waitForTimeout(700);
    await page.locator(".frn-skip").first().click({ timeout: 1200 }).catch(() => {});
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const txt = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 24);
      const vis = (el) => { const b = el.getBoundingClientRect(); return b.width > 2 && b.height > 2; };
      const main = document.querySelector("main, .v3-main, .ws, .pg-body") ?? document.body;
      const acts = [...main.querySelectorAll("button, a[href], select, input:not([type=hidden])")]
        .filter(vis).map(txt).filter(Boolean);
      return {
        chars: (main.innerText || "").trim().length,
        heads: [...main.querySelectorAll("h1, h2, h3")].filter(vis).map(txt).filter(Boolean),
        acts: [...new Set(acts)],
        tables: main.querySelectorAll("table").length,
        inputs: [...main.querySelectorAll("input, select, textarea")].filter(vis).length,
      };
    }).catch(() => null);
    const status = res?.status() ?? 0;
    await page.close();
    return { path, status, ...(r ?? { chars: 0, heads: [], acts: [], tables: 0, inputs: 0 }) };
  };

  // ── 옛 화면 (스위치 꺼짐) ───────────────────────────────────
  await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
  console.log("══ 옛 화면 (스위치 꺼짐) ═══════════════════════════════════");
  const legacy = [];
  for (const l of LEGACY) {
    const r = await survey(l.path);
    legacy.push({ ...l, ...r });
    console.log(`${l.path.padEnd(22)} HTTP ${r.status} · 글자 ${String(r.chars).padStart(5)} ·` +
                ` 표 ${r.tables} · 입력칸 ${String(r.inputs).padStart(2)} · 동작 ${String(r.acts.length).padStart(3)}`);
  }

  // ── v3 (스위치 켜짐) ───────────────────────────────────────
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);
  console.log("\n══ v3 (스위치 켜짐) ═══════════════════════════════════════");
  const v3 = [];
  for (const p of V3) {
    const r = await survey(p);
    v3.push(r);
    console.log(`${p.padEnd(22)} HTTP ${r.status} · 글자 ${String(r.chars).padStart(5)} ·` +
                ` 표 ${r.tables} · 입력칸 ${String(r.inputs).padStart(2)} · 동작 ${String(r.acts.length).padStart(3)}`);
    console.log(`${"".padEnd(22)}   머리글 [${r.heads.join(" · ") || "(없음)"}]`);
    console.log(`${"".padEnd(22)}   동작 [${r.acts.slice(0, 18).join(" · ")}${r.acts.length > 18 ? " …" : ""}]`);
  }

  // ── v3 레일이 사람에게 내주는 길 ────────────────────────────
  {
    const page = await ctx.newPage();
    await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const rail = await page.locator(".v3-rail a").allInnerTexts();
    const hrefs = await page.locator(".v3-rail a").evaluateAll((els) => els.map((e) => new URL(e.href).pathname));
    console.log(`\nv3 레일 — ${rail.map((t, i) => `${t.replace(/\s+/g, " ").trim()}(${hrefs[i]})`).join(" · ")}`);
    await page.close();
  }
} finally {
  if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
  else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2)
                         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
  const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
  console.log(`\n뒷정리 — 스위치 ${now ? JSON.stringify(now.value) : "(행 없음)"}` +
              ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})`);
  await browser?.close();
  await pool.end();
}
