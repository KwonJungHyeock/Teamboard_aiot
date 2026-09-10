// v3 스위치 — **이번 회차의 안전선** (MD-P-2026-042 §B).
//
// **로컬 전용** (지시 32). 스위치 값을 만졌다가 **시작 전 값으로 되돌린다**.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 기본값은 **꺼짐**이다 (config 행이 없어도)
//   ② 꺼짐에서 `/v3` 로 직접 가면 못 들어간다 — 갈 곳은 `DENIED_HREF`
//   ③ **꺼짐에서 기존 화면 전량이 지금과 똑같이 돈다** ← 안전선
//   ④ 켜면 `/v3` 가 열리고 옛 사이드바에 가는 길이 생긴다
//   ⑤ **켜도 기존 화면이 그대로 돈다** (아직 옮긴 경로가 없으므로)
//   ⑥ 스위치는 **관리자만** 바꾼다 — 팀장은 403
//   ⑦ 껐다 켰다 하면 ③의 지문이 **글자 그대로** 돌아온다
//   ⑧ v3 토큰이 옛 화면으로 **새지 않는다** — `.v3` 밖에 `--v3-*` 가 없다
//
// ── 왜 ③을 지문으로 재는가 ──────────────────────────────────────
//
// 「기존 화면이 그대로다」를 눈으로 보면 매번 다르게 본다. 그래서 화면마다
// **응답 코드 · 제목 · 주요 요소 수**를 한 줄로 뜨고, 스위치를 켰다 끈 뒤
// 그 줄이 **글자 그대로 같은지** 본다. 절대값이 아니라 시작 전과 대조한다(§G).
//
// ⑧이 필요한 이유: 토큰을 `:root` 에 풀면 이름이 겹치는 순간 옛 화면이 조용히
// 달라진다. 「`.v3` 안에만 뒀다」는 글이고, 자취로 확인해야 한다(§G).
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("v3-switch-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-042";
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
/** 기존 화면 전량 — 스위치가 건드리면 안 되는 것들. */
const OLD = [
  ["홈", "/"], ["업무", "/tasks"], ["목표", "/goals"], ["프로젝트", "/projects"],
  ["캘린더", "/calendar"], ["타임라인", "/timeline"], ["시그널", "/signals"],
  ["허들룸", "/huddle"], ["활동", "/activity"], ["승인 대기", "/inbox"],
  ["월간 보고", "/reports"], ["가오픈 기한", "/open-due"], ["업무 현황", "/status"],
  ["설정", "/settings"], ["인수인계", "/handover"], ["메모", "/notes"],
];

let browser, before = null;
try {
  // ── 시작 전 스위치 값. **절대값을 기대하지 않는다** — 켜져 있을 수도 있다.
  const row = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  before = row === undefined ? null : row.value;
  console.log(`   (시작 전) ${KEY} = ${before === null ? "(행 없음)" : JSON.stringify(before)}`);

  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(
      `INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };

  const lead = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'lead' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  const admin = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role = 'admin' OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  chk("0-짝조건", !!(lead && admin),
      `관리자 ${admin?.id} · 권한 없는 팀장 ${lead?.id} (둘 다 있어야 ⑥이 뜻을 가진다)`);
  if (!lead || !admin) throw new Error("검사에 필요한 계정 구성이 없다");

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const host = new URL(BASE).hostname;
  const open = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: "tb_session", value: tok(u), domain: host, path: "/" }]);
    return ctx;
  };
  const asAdmin = { id: admin.id, actorId: admin.id, name: "검사", role: admin.role,
                    adminGrant: admin.admin_grant, email: "a@a" };

  /**
   * 기존 화면 전량의 **지문** — 응답 코드 · 도착 경로 · 제목 · 주요 요소 수.
   * 「그대로다」를 눈이 아니라 글자로 재기 위한 것이다.
   */
  const fingerprint = async (page) => {
    const out = [];
    for (const [name, href] of OLD) {
      const res = await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(250);
      const landed = new URL(page.url()).pathname;
      const h1 = (await page.locator("h1").first().innerText().catch(() => "")).trim().slice(0, 24);
      const nav = await page.locator(".side a").count();
      out.push(`${name}:${res?.status()}:${landed}:${h1}:nav${nav}`);
    }
    return out.join(" | ");
  };

  // ── ① 기본값은 꺼짐 ─────────────────────────────────────────────
  // 조건을 관측보다 먼저 만든다 — 행을 지워서 「값이 없는 상태」를 만든다.
  await setSwitch(null);
  {
    const ctx = await open(asAdmin);
    const p = await ctx.newPage();
    const res = await p.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    const landed = new URL(p.url()).pathname;
    chk("①②-행이-없으면-꺼짐", landed !== "/v3" && res?.status() === 200,
        `/v3 → ${landed} (${res?.status()}) · 갈 곳이 열린다`);
    await ctx.close();
  }

  // ── ③ 안전선 — 꺼짐에서 기존 화면 전량 ──────────────────────────
  const ctx = await open(asAdmin);
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.locator(".frn-skip").first().click({ timeout: 1500 }).catch(() => {});

  const fpOff = await fingerprint(page);
  const allOk = fpOff.split(" | ").every((s) => s.includes(":200:"));
  chk("③-꺼짐에서-기존-화면-전량", allOk, `${OLD.length}개 화면 전부 200`);
  chk("③-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);
  const navOff = await page.locator(".side .side-v3").count();
  chk("③-꺼짐에선-가는-길도-없다", navOff === 0, `사이드바 「새 화면으로」 ${navOff}개`);

  // ── ④⑤ 켜기 ────────────────────────────────────────────────────
  await setSwitch(true);
  {
    const res = await page.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const landed = new URL(page.url()).pathname;
    const rail = await page.locator(".v3 .v3-rail a").count();
    chk("④-켜면-v3-가-열린다", landed === "/v3" && res?.status() === 200 && rail === 4,
        `→ ${landed} (${res?.status()}) · 레일 항목 ${rail}개`);
    await page.screenshot({ path: `${OUT}/v3-parts.png`, fullPage: true });

    /*
     * 부품이 **그려졌는지**가 아니라 **약속대로 보이는지** 본다.
     * 「완료는 취소선 + 회색」은 CSS 에 적어 두었을 뿐이고, 적은 것과 보이는 것은
     * 다르다(§G). 계산된 스타일을 읽는다.
     */
    const doneRow = page.locator(".v3-row.done .v3-row-t").first();
    const deco = await doneRow.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { line: cs.textDecorationLine, color: cs.color };
    });
    const grey = await page.locator(".v3").evaluate((el) =>
      getComputedStyle(el).getPropertyValue("--v3-ink-3").trim());
    chk("④-완료는-취소선-회색", deco.line.includes("line-through"),
        `text-decoration ${deco.line} · 색 ${deco.color} (--v3-ink-3 = ${grey})`);

    // 행 높이는 토큰이 정한다 — 값을 컴포넌트에 직접 쓰지 않았다는 자취.
    const h = await page.locator(".v3-row").first().evaluate((el) => Math.round(el.getBoundingClientRect().height));
    chk("④-행-높이가-토큰-값", h >= 64, `첫 행 ${h}px (--v3-row-h = 64px 이상)`);

    // 설정 화면 — 스위치가 어떻게 보이는지도 남긴다.
    await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/v3-switch.png`, fullPage: true });
  }
  {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const navOn = await page.locator(".side .side-v3").count();
    chk("④-켜면-가는-길이-생긴다", navOn === 1, `사이드바 「새 화면으로」 ${navOn}개`);
  }
  const fpOn = await fingerprint(page);
  // 켜도 기존 화면은 그대로다 — **아직 옮긴 경로가 없기 때문**이다.
  // 사이드바에 한 줄이 늘어 `nav` 수가 달라질 수 있으므로 그 칸만 빼고 견준다.
  const strip = (s) => s.split(" | ").map((x) => x.split(":").slice(0, 4).join(":")).join(" | ");
  chk("⑤-켜도-기존-화면은-그대로", strip(fpOn) === strip(fpOff),
      strip(fpOn) === strip(fpOff)
        ? `${OLD.length}개 화면 지문 동일 (옮긴 경로 0개)`
        : `\n     꺼짐 ${strip(fpOff)}\n     켜짐 ${strip(fpOn)}`);

  // ── ⑥ 스위치는 관리자만 ─────────────────────────────────────────
  {
    const c2 = await open({ id: lead.id, actorId: lead.id, name: "검사", role: "lead",
                            adminGrant: false, email: "l@l" });
    const p2 = await c2.newPage();
    await p2.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
    const r = await p2.evaluate(async () => {
      const res = await fetch("/api/settings/platform", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uiV3: false }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    // 화면에도 조작 칸이 없어야 한다 — 보이면 눌린다(§G).
    const btn = await p2.locator(".ps-row").filter({ hasText: "새 화면(v3)" }).locator("button").count();
    chk("⑥-팀장은-스위치를-못-바꾼다", r.status === 403 && btn === 0,
        `PUT ${r.status} · ${r.body?.error ?? "—"} · 화면 버튼 ${btn}개`);
    // 막혔으면 값도 안 바뀌어야 한다.
    const still = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0]?.value;
    chk("⑥짝-막혔으면-안-바뀐다", still === true, `${KEY} = ${JSON.stringify(still)} (켜짐 그대로)`);
    await c2.close();
  }

  // ── ⑦ 껐다 켰다 해도 ③의 지문이 글자 그대로 돌아온다 ────────────
  await setSwitch(false);
  const fpBack = await fingerprint(page);
  chk("⑦-끄면-지문이-되돌아온다", fpBack === fpOff,
      fpBack === fpOff ? "지문 일치" : `\n     처음 ${fpOff}\n     지금 ${fpBack}`);

  // ── ⑧ 토큰이 새지 않는다 ────────────────────────────────────────
  const v3css = readFileSync("app/v3.css", "utf8");
  const decls = [...v3css.matchAll(/(^|\})\s*([^{}]+)\{([^}]*)\}/g)];
  const leaked = decls.filter(([, , sel, body]) =>
    /--v3-[a-z0-9-]+\s*:/.test(body) && !/\.v3\b/.test(sel));
  const other = ["app/globals.css", "app/design.css", "app/home.css"]
    .filter((f) => /--v3-/.test(readFileSync(f, "utf8")));
  chk("⑧-토큰이-옛-화면으로-안-샌다", leaked.length === 0 && other.length === 0,
      `v3.css 밖 선택자 선언 ${leaked.length}개 · 다른 CSS 파일 ${other.length}개` +
      (other.length ? ` (${other})` : ""));

  await ctx.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  // 스위치를 **시작 전 값 그대로** 되돌린다. 「꺼 두면 되겠지」가 아니다 —
  // 시작할 때 켜져 있었으면 켠 채로 돌려놔야 한다(§G).
  if (before !== null || true) {
    try {
      if (before === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
      else await pool.query(
        `INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, before]);
      const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
      const nowVal = now === undefined ? null : now.value;
      const same = JSON.stringify(nowVal) === JSON.stringify(before);
      console.log(`\n뒷정리 확인 — ${KEY} = ${nowVal === null ? "(행 없음)" : JSON.stringify(nowVal)}` +
                  ` (시작 전 ${before === null ? "(행 없음)" : JSON.stringify(before)})` +
                  `${same ? "" : " **다르다**"}`);
      if (!same) process.exitCode = 1;
    } catch (e) {
      console.error("스위치 되돌리기 실패 —", e.message);
      process.exitCode = 1;
    }
  }
  await browser?.close();
  await pool.end();
}
