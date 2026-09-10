// 에이전트 철거 — 배치마다 같은 것을 잰다 (MD-P-2026-038 §B-2 · 041 §B).
//
// **로컬 전용** (지시 32). 쓰기 없음 — 열어 보고 소스를 읽을 뿐이다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 부사수로 가는 길이 **하나도 없다** — 링크 · 사이드바 · 명령 팔레트 · 떠 있는 버튼
//   ② `/assistant` 로 직접 가면 없는 화면이다
//   ③ **죽은 fetch 가 없다** — 코드가 부르는 API 경로에 라우트 파일이 실제로 있다
//   ④ 홈 · 캘린더 · 시그널 · 타임라인 · 승인 대기가 에이전트 없이 **그려진다**
//   ⑤ 막힌 사람이 가는 곳이 **실제로 열린다** — 갈 곳 없는 리다이렉트가 없다
//   ⑥ `/admin/agent-usage` 는 **남아 있다** — 표와 데이터가 남으니 세는 창은 있어야 한다
//
// ── 왜 이 모양인가 ───────────────────────────────────────────────
//
// ③이 이 검사의 핵심이다. 화면에서 버튼을 떼는 것과 그 버튼이 부르던 라우트를
// 지우는 것은 다른 배치라, 사이에 **부르는 코드는 남았는데 받는 쪽이 없는 상태**가
// 생길 수 있다. 그건 눌러 보기 전엔 안 보인다. 그래서 소스를 읽어서 미리 잡는다.
//
// ⑤는 이번 철거가 만든 **새로운 함정**이다. 네 화면이 권한 없는 사람을
// `/assistant` 로 밀어내고 있었는데 그 화면이 사라졌다. 「막았다」만 재고
// 「밀려난 곳이 열리는가」를 안 재면 404 로 보내는 걸 못 본다.
//
// ⑥은 짝이다. **없앤 것만 세면 「다 지웠다」와 「너무 지웠다」가 안 갈린다.**
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("agent-removal-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(26)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(26)} ${n}`); } };

/* ── ③ 죽은 fetch — 소스만 읽는다. 브라우저가 없어도 돈다 ────────── */
const SRC_ROOTS = ["app", "components", "lib"];
const SRC_EXT = new Set([".ts", ".tsx"]);
function walkSrc(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".next") continue;
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walkSrc(p, out);
    else if (SRC_EXT.has(path.extname(p))) out.push(p);
  }
  return out;
}
/**
 * 한 줄에서 `/api/...` 하나를 읽어 낸다. 템플릿의 `${...}` 는 **중괄호를 세어서**
 * 통째로 건너뛰고 한 칸(`\0`)으로 접는다.
 *
 * 처음엔 정규식 한 줄로 잡았다가 `` `/api/projects${areaQs ? `?a=${x}` : ""}` `` 에서
 * `${` 를 못 넘어가 `/api/projects${areaQs` 를 경로로 읽었고, 멀쩡한 라우트를
 * 죽은 fetch 로 신고했다. 중첩된 템플릿까지 있어서 정규식으로 될 일이 아니었다.
 */
const HOLE = "\u0000";                       // `${...}` 가 있던 자리
function readPath(line, start) {
  let out = "", i = start + "/api".length;    // "/api" 다음부터
  while (i < line.length) {
    const c = line[i];
    if (c === "$" && line[i + 1] === "{") {
      i += 1;                                 // `$` 를 먼저 지나야 중괄호를 센다
      let depth = 0;
      do {
        if (line[i] === "{") depth++;
        else if (line[i] === "}") depth--;
        i++;
      } while (i < line.length && depth > 0);
      out += HOLE;
      continue;
    }
    // 경로에 쓰일 수 있는 글자만 잇는다. 그 밖(따옴표 · 공백 · 한글 · 괄호)에서 끊는다.
    if (!/[A-Za-z0-9_\-./[\]]/.test(c)) break;
    out += c;
    i++;
  }
  return out.length ? `/api${out}` : null;
}

/** 코드가 부르는 `/api/...` 경로 전부. */
function calledApiPaths() {
  const found = new Map();               // 경로 → [파일:행]
  for (const f of SRC_ROOTS.flatMap((r) => walkSrc(r))) {
    if (f.startsWith(`app${path.sep}api${path.sep}`)) continue;   // 라우트 자신은 부르는 쪽이 아니다
    // 주석은 뺀다 — 설명문 속의 `/api/meta/selectors에서 …` 는 부르는 것이 아니다.
    const src = readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
    src.split("\n").forEach((line, i) => {
      let at = -1;
      while ((at = line.indexOf("/api/", at + 1)) >= 0) {
        const p = readPath(line, at);
        if (p) found.set(p, [...(found.get(p) ?? []), `${f}:${i + 1}`]);
      }
    });
  }
  return found;
}
/**
 * `app/api/<seg>/route.ts` 가 있는가. 동적 구간 `[x]` 를 감안해 내려간다.
 *
 * 끝에 보간이 붙은 경우(`/api/projects${...}`)는 **글자만으로는 못 가른다** —
 * `${id}` 처럼 경로 구간일 수도, `${qs ? "?a=1" : ""}` 처럼 쿼리일 수도 있다.
 * 처음엔 무조건 구간으로 읽어서 멀쩡한 `/api/projects` 를 죽은 fetch 로 신고했다.
 * 그래서 **둘 다 본다** — 어느 쪽으로든 라우트가 있으면 죽지 않은 것이다.
 */
function routeExists(apiPath) {
  if (apiPath.endsWith(HOLE)) {
    return resolve(apiPath) || resolve(apiPath.slice(0, -1).replace(/\/$/, ""));
  }
  return resolve(apiPath);
}
function resolve(apiPath) {
  const segs = apiPath.replace(/^\/api\//, "").split("/").filter(Boolean);
  if (!segs.length) return false;
  let dir = path.join("app", "api");
  for (const seg of segs) {
    if (!existsSync(dir)) return false;
    const entries = readdirSync(dir);
    let next = null;
    if (seg.includes(HOLE)) {
      next = entries.find((e) => e.startsWith("[") && e.endsWith("]"));
    } else if (entries.includes(seg)) {
      next = seg;
    } else {
      next = entries.find((e) => e.startsWith("[") && e.endsWith("]"));
    }
    if (!next) return false;
    dir = path.join(dir, next);
  }
  return existsSync(path.join(dir, "route.ts")) || existsSync(path.join(dir, "route.tsx"));
}

let browser;
try {
  // ── ③ 먼저 — 브라우저 없이 되는 검사다 ──────────────────────────
  const called = calledApiPaths();
  const dead = [...called.entries()].filter(([p]) => !routeExists(p));
  const show = (p) => p.split(HOLE).join("${…}");
  chk("③-죽은-fetch-없다", dead.length === 0,
      dead.length === 0
        ? `코드가 부르는 API 경로 ${called.size}개 · 받는 쪽 없는 것 0`
        : dead.map(([p, at]) => `\n     ${show(p)} ← ${at.join(", ")}`).join(""));

  // 짝 — 이 검사가 살아 있는가. 없는 경로를 하나 넣어 보고 **정말 잡는지** 본다.
  // 「0건」이 「깨끗하다」인지 「아무것도 안 보고 있다」인지 이걸로 갈린다(§G).
  chk("③짝-검사가-살아있다",
      routeExists("/api/tasks") && !routeExists("/api/이런건없다"),
      "있는 경로는 통과 · 없는 경로는 잡힘");

  // ⑥ 짝 — 남겨야 할 것이 남았는가
  chk("⑥-집계-화면은-남아있다",
      existsSync("app/admin/agent-usage/page.tsx") && existsSync("app/api/admin/agent-usage/route.ts"),
      "/admin/agent-usage 화면·API 존재 (표와 데이터가 남으니 세는 창은 있어야 한다)");

  // ── 화면 ────────────────────────────────────────────────────────
  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a
       JOIN actor ac ON ac.id = a.actor_id WHERE ac.is_active ORDER BY a.actor_id LIMIT 1`))[0];
  const noGrantLead = (await sql(
    `SELECT a.actor_id id FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'lead' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const host = new URL(BASE).hostname;
  const open = async (u) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await ctx.addCookies([{ name: "tb_session", value: tok(u), domain: host, path: "/" }]);
    return ctx;
  };
  const ctx = await open({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                           adminGrant: me.admin_grant, email: "x@x" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));

  // ④ 화면들이 그려지는가. **에이전트가 있던 자리를 지나는 화면들**을 고른다.
  const SCREENS = [["홈", "/"], ["캘린더", "/calendar"], ["타임라인", "/timeline"],
                   ["시그널", "/signals"], ["승인 대기", "/inbox"], ["활동", "/activity"]];
  const drawn = [];
  for (const [name, href] of SCREENS) {
    const res = await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.locator(".frn-skip").first().click({ timeout: 1200 }).catch(() => {});
    const hasMain = await page.locator("main").count() > 0;
    drawn.push(`${name} ${res?.status()}${hasMain ? "" : "(main 없음)"}`);
    if (res?.status() !== 200 || !hasMain) chk(`④-${name}`, false, `${res?.status()} · main ${hasMain}`);
  }
  chk("④-에이전트-없이-그려진다", drawn.every((d) => d.includes("200") && !d.includes("main 없음")),
      drawn.join(" · "));
  chk("④-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0]}` : ""}`);

  // ① 부사수로 가는 길. 화면을 다 열어 본 뒤, 마지막 화면에서 전역 요소를 본다.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const links = await page.locator('a[href="/assistant"], a[href^="/assistant/"]').count();
  const fab = await page.locator(".agf, .agf-foot, [class*='agent-fab']").count();
  // 사이드바 「관리」를 펼쳐서 본다 — 접혀 있으면 없는 것처럼 보인다(값이 있는 것과 읽히는 것은 다르다).
  await page.locator(".grp").last().evaluate((el) => el.setAttribute("open", "")).catch(() => {});
  const navText = await page.locator(".side").innerText().catch(() => "");
  chk("①-부사수로-가는-링크-0", links === 0 && fab === 0 && !navText.includes("내 에이전트"),
      `링크 ${links} · 떠 있는 버튼 ${fab} · 사이드바에 "내 에이전트" ${navText.includes("내 에이전트") ? "있음" : "없음"}`);

  // 명령 팔레트 — 눌러서 연다. 검색 결과에 부사수가 없어야 한다.
  await page.keyboard.press("Meta+k").catch(() => {});
  await page.keyboard.press("Control+k").catch(() => {});
  await page.waitForTimeout(400);
  const palette = page.locator(".cmdk, [class*='cmd']").first();
  let paletteHits = -1;
  if (await palette.count()) {
    const input = palette.locator("input").first();
    if (await input.count()) {
      await input.fill("에이전트");
      await page.waitForTimeout(300);
      const txt = await palette.innerText();
      paletteHits = (txt.match(/에이전트/g) ?? []).filter(() => true).length;
      // 입력한 낱말 자체가 한 번 잡힌다. 항목으로 잡힌 것만 센다.
      paletteHits = await palette.locator('a[href="/assistant"], [data-href="/assistant"]').count();
    }
    await page.keyboard.press("Escape");
  }
  chk("①-명령-팔레트에-없다", paletteHits <= 0,
      paletteHits < 0 ? "팔레트를 못 열었다 — 소스 검사로 대신한다" : `"에이전트" 검색 → 부사수 항목 ${paletteHits}개`);
  // 팔레트를 못 열어도 이 짝은 늘 참이라야 한다.
  const cmdSrc = readFileSync("components/CommandPalette.tsx", "utf8");
  chk("①짝-팔레트-소스에도-없다", !cmdSrc.includes("/assistant"),
      cmdSrc.includes("/assistant") ? "**CommandPalette 에 /assistant 가 남아 있다**" : "0건");

  // ② 직접 가면 없는 화면
  const direct = await page.goto(`${BASE}/assistant`, { waitUntil: "domcontentloaded" });
  chk("②-직접-가면-없다", direct?.status() === 404, `GET /assistant → ${direct?.status()}`);

  // ⑤ 막힌 사람이 **갈 곳이 있는가**. 목적지가 사라진 리다이렉트를 잡는 자리다.
  if (noGrantLead) {
    const c2 = await open({ id: noGrantLead.id, actorId: noGrantLead.id, name: "검사",
                            role: "lead", adminGrant: false, email: "y@y" });
    const p2 = await c2.newPage();
    const r2 = await p2.goto(`${BASE}/members`, { waitUntil: "networkidle" });
    const landed = new URL(p2.url()).pathname;
    chk("⑤-밀려난-곳이-열린다", r2?.status() === 200 && landed !== "/members",
        `권한 없는 팀장이 /members → ${landed} (${r2?.status()})`);
    await c2.close();
  } else {
    chk("⑤-밀려난-곳이-열린다", false, "**권한 없는 팀장 계정이 없어 못 쟀다**");
  }

  await ctx.close();
  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail ? 1 : 0;
} catch (e) {
  console.error("검사 중 예외:", String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await pool.end();
}
