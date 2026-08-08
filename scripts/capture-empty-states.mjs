// 빈 상태 전수 캡처 (MD-P-2026-026 §A).
//
// 코드를 읽고 "빈 상태가 뜬다"고 쓰지 않는다. **실제로 비우고, 띄우고, 찍는다** (지시 28).
//
// 규칙 세 가지 — 지난번에 다 한 번씩 틀렸던 것들이다:
//   ① 준비 SQL 은 **커밋**한다. 앱은 자기 커넥션으로 읽으므로 BEGIN 안의 변경은 안 보인다.
//   ② 대기는 고정 sleep 이 아니라 **선택자 대기**로 한다. 클라이언트 렌더와 경주하면 안 된다.
//   ③ 도달하지 못한 곳은 통과로 세지 않는다. `MISS` 로 적고 그대로 보고한다.
//
// 복원 주의: `UPDATE t SET is_active = true` 는 **원래 꺼져 있던 행까지 켠다**.
// 이 저장소의 로컬 데이터는 전부 켜져 있어 실제 피해는 없었지만,
// 소프트 삭제가 섞인 DB 에서는 복원이 아니라 삭제 취소가 된다.
// 그래서 `WHERE is_active` 로 끈 뒤 되돌릴 때도 같은 범위를 되돌린다는 전제를 명시해 둔다 —
// 이 전제가 깨지는 DB 에서는 first-run-walk.mjs 처럼 id 목록을 적어 두고 되돌려야 한다.
//
//   BASE=http://127.0.0.1:3000 node scripts/capture-empty-states.mjs
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("capture-empty-states.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-026";
const HOST = new URL(BASE).hostname;
const DSN = process.env.DATABASE_URL;
const SECRET = process.env.AUTH_SECRET;
if (!DSN || !SECRET) { console.error("DATABASE_URL / AUTH_SECRET 필요"); process.exit(1); }

const pool = new pg.Pool({ connectionString: DSN });
const sql = async (text, params = []) => (await pool.query(text, params)).rows;

function token(user) {
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${payload}.${createHmac("sha256", SECRET).update(payload).digest("base64url")}`;
}

const LEAD = { id: 1, actorId: 1, name: "권정혁", role: "lead", email: "lead@local" };

/**
 * 케이스 정의.
 *   scope  : "full"(EmptyState) | "section"(SectionEmpty) | "skeleton" | "error"
 *   empty  : 비우는 SQL 들 (커밋됨)
 *   restore: 되돌리는 SQL 들 — finally 에서 반드시 실행
 *   expect : 이 선택자가 떠야 통과
 */
const CASES = [
  // ── 전체 빈 상태 ──
  { id: "full-tasks", path: "/tasks", scope: "full",
    empty: ["UPDATE task SET is_active = false WHERE is_active"],
    restore: ["UPDATE task SET is_active = true"] },
  { id: "full-goals", path: "/goals", scope: "full",
    empty: ["UPDATE goal SET is_active = false WHERE is_active"],
    restore: ["UPDATE goal SET is_active = true"] },
  { id: "full-signals", path: "/signals", scope: "full",
    empty: ["UPDATE signal SET is_active = false WHERE is_active"],
    restore: ["UPDATE signal SET is_active = true"] },
  // decision 에는 is_active 가 없다 — 임시 테이블로 옮겼다가 되돌린다 (삭제가 아니다)
  { id: "full-decisions", path: "/signals?tab=decision", scope: "full",
    // TEMP 는 커넥션마다 다르다 (풀에서 매번 다른 커넥션이 나온다) — 일반 테이블로 백업한다
    empty: ["DROP TABLE IF EXISTS _bk_decision",
            "CREATE TABLE _bk_decision AS SELECT * FROM decision",
            "DELETE FROM decision"],
    restore: ["INSERT INTO decision SELECT * FROM _bk_decision ON CONFLICT DO NOTHING",
              "DROP TABLE IF EXISTS _bk_decision"] },
  // /inbox 는 제안 업무 + 에이전트 초안 두 갈래다. 하나만 비우면
  // 빈 상태가 떴다가 두 번째 로드에서 사라진다 — 실제로 그렇게 한 번 틀렸다.
  { id: "full-inbox", path: "/inbox", scope: "full",
    empty: ["UPDATE task SET status = 'todo' WHERE status = 'proposed'",
            "DROP TABLE IF EXISTS _bk_drafts",
            "CREATE TABLE _bk_drafts AS SELECT * FROM drafts",
            "DELETE FROM drafts"],
    restore: ["INSERT INTO drafts SELECT * FROM _bk_drafts ON CONFLICT DO NOTHING",
              "DROP TABLE IF EXISTS _bk_drafts"] },
  { id: "full-notes", path: "/notes", scope: "full",
    empty: ["UPDATE note SET is_active = false WHERE is_active"],
    restore: ["UPDATE note SET is_active = true"] },
  { id: "full-saved", path: "/saved", scope: "full",
    empty: ["DROP TABLE IF EXISTS _bk_saved", "CREATE TABLE _bk_saved AS SELECT * FROM saved_item",
            "DELETE FROM saved_item"],
    restore: ["INSERT INTO saved_item SELECT * FROM _bk_saved ON CONFLICT DO NOTHING",
              "DROP TABLE IF EXISTS _bk_saved"] },
  { id: "full-projects", path: "/projects", scope: "full",
    empty: ["UPDATE project SET is_active = false WHERE is_active"],
    restore: ["UPDATE project SET is_active = true"] },
  { id: "full-activity", path: "/activity", scope: "full",
    empty: ["UPDATE notification SET archived = true WHERE NOT archived"],
    restore: ["UPDATE notification SET archived = false"] },
  { id: "full-handover", path: "/handover", scope: "full",
    empty: ["UPDATE handover SET is_active = false WHERE is_active"],
    restore: ["UPDATE handover SET is_active = true"] },
  // report 에는 is_active 가 없다. 로컬에 0건이므로 비울 것 없이 그대로 빈 상태다.
  { id: "full-reports", path: "/reports", scope: "full", tab: "승인 보고서",
    empty: [], restore: [] },
  { id: "full-huddle", path: "/huddle", scope: "full",
    empty: ["UPDATE signal SET is_active = false WHERE is_active"],
    restore: ["UPDATE signal SET is_active = true"] },

  // ── 섹션 빈 상태 ──
  { id: "sec-home", path: "/", scope: "section",
    empty: ["UPDATE goal SET is_active = false WHERE is_active",
            "UPDATE signal SET is_active = false WHERE is_active",
            "UPDATE task SET is_active = false WHERE is_active"],
    restore: ["UPDATE goal SET is_active = true", "UPDATE signal SET is_active = true",
              "UPDATE task SET is_active = true"] },
  // /areas/{id} 는 MD-P-2026-027 §B2 에서 /tasks?area={id} 로 리다이렉트된다.
  // 영역 화면의 섹션 빈 상태(프로젝트·목표·자료 탭)는 그 화면과 함께 사라졌다.
  // 대신 같은 규격을 쓰는 **업무 영역 필터 결과 0건**을 본다.
  { id: "sec-area-filter", path: null, scope: "full",
    resolve: async () => {
      const r = await sql("SELECT id FROM area WHERE is_active ORDER BY sort_order LIMIT 1");
      return r[0] ? `/areas/${r[0].id}` : null;        // 리다이렉트를 타고 /tasks?area= 로 간다
    },
    empty: ["UPDATE task SET is_active = false WHERE is_active"],
    restore: ["UPDATE task SET is_active = true"] },
  { id: "sec-goals-archive", path: "/goals", scope: "section", click: "보관함",
    empty: [], restore: [] },
  { id: "sec-handover-shared", path: "/handover", scope: "section",
    empty: [], restore: [] },
  { id: "sec-project", path: null, scope: "section",
    empty: ["UPDATE task SET is_active = false WHERE is_active",
            "UPDATE signal SET is_active = false WHERE is_active"],
    restore: ["UPDATE task SET is_active = true", "UPDATE signal SET is_active = true"],
    resolve: async () => {
      const r = await sql("SELECT id FROM project WHERE is_active ORDER BY id LIMIT 1");
      return r[0] ? `/projects/${r[0].id}` : null;
    } },
  { id: "sec-reports-perf", path: "/reports", scope: "section",
    empty: ["UPDATE task SET is_active = false WHERE is_active",
            "UPDATE goal SET is_active = false WHERE is_active"],
    restore: ["UPDATE task SET is_active = true", "UPDATE goal SET is_active = true"] },
  { id: "sec-assistant", path: "/assistant", scope: "section",
    empty: ["DROP TABLE IF EXISTS _bk_job", "CREATE TABLE _bk_job AS SELECT * FROM agent_job",
            "DELETE FROM agent_job"],
    restore: ["INSERT INTO agent_job SELECT * FROM _bk_job ON CONFLICT DO NOTHING",
              "DROP TABLE IF EXISTS _bk_job"] },
  // ── 로딩(§A-4) · 오류(§A-5) ──
  // 데이터가 "아직" / "못" 오는 상태는 DB 로 못 만든다 — 네트워크를 가로챈다.
  { id: "load-tasks", path: "/tasks", scope: "skeleton", route: { url: "**/api/tasks*", mode: "hang" },
    empty: [], restore: [] },
  { id: "load-goals", path: "/goals", scope: "skeleton", route: { url: "**/api/goals*", mode: "hang" },
    empty: [], restore: [] },
  { id: "err-tasks", path: "/tasks", scope: "error", route: { url: "**/api/tasks*", mode: "fail" },
    empty: [], restore: [] },
  { id: "err-goals", path: "/goals", scope: "error", route: { url: "**/api/goals*", mode: "fail" },
    empty: [], restore: [] },

  // /timeline 은 NOTION_TOKEN 이 없으면 page.tsx 가 "/" 로 redirect 한다.
  // 이 컨테이너에는 토큰이 없으므로 **도달할 수 없다** — 통과로 세지 않는다.
  { id: "sec-timeline", path: "/timeline", scope: "section", allowError: true,
    requires: "NOTION_TOKEN", empty: [], restore: [] },
];

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await ctx.addCookies([{ name: "tb_session", value: token(LEAD), domain: HOST, path: "/" }]);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

const results = [];
for (const c of CASES) {
  const before = errors.length;
  let row = { id: c.id, scope: c.scope, status: "MISS", detail: "", shot: "" };
  try {
    for (const s of c.empty) await sql(s);
    const path = c.resolve ? await c.resolve() : c.path;
    if (!path) { row.detail = "경로를 만들지 못함"; results.push(row); continue; }
    row.path = path;

    if (c.route) {
      await page.route(c.route.url, async (r) => {
        if (c.route.mode === "hang") { await new Promise((res) => setTimeout(res, 30000)); await r.abort(); }
        else await r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "테스트용 500" }) });
      });
    }
    await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
    // 탭은 데이터 도착 후에 그려진다. 첫 렌더 직후에 찾으면 아직 없다.
    if (c.scope !== "skeleton") await page.waitForLoadState("networkidle").catch(() => {});
    if (c.requires && !process.env[c.requires]) {
      row.detail = `${c.requires} 없음 — 서버가 "/" 로 리다이렉트한다. 이 컨테이너에서는 도달 불가`;
      results.push(row); console.log(`${row.status.padEnd(4)} ${c.id.padEnd(20)} ${row.detail}`); continue;
    }
    for (const label of [c.tab, c.click].filter(Boolean)) {
      // 탭 라벨 뒤에 건수 배지가 붙는다 ("프로젝트 0") — 완전 일치로는 안 잡힌다
      const t = page.getByRole("tab", { name: label, exact: false })
        .or(page.getByRole("button", { name: label, exact: false })).first();
      if (await t.count()) await t.click().catch(() => {});
      await page.waitForTimeout(300);
    }

    const want = c.scope === "full" ? ".empty-state"
      : c.scope === "section" ? ".sec-empty"
      : c.scope === "error" ? ".err-note" : ".sk";
    const alt = c.allowError ? ".err-note" : null;

    const sel = alt ? `${want}, ${alt}` : want;
    await page.waitForSelector(sel, { timeout: 9000 });
    // 나타났다가 재렌더로 사라지는 경우가 있다 — 가라앉힌 뒤 다시 센다.
    // 여기서 세지 않으면 "waitForSelector 는 통과했는데 개수는 0" 인 빈 단언이 된다 (지시 28).
    // 단, 로딩 케이스는 요청을 일부러 붙잡고 있으므로 networkidle 을 기다리면
    // 그 대기가 끝나는 순간 요청이 끊기고 스켈레톤이 사라진다 — 기다리지 않는다.
    if (c.scope !== "skeleton") await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(500);
    const n = await page.locator(want).count();
    if (n === 0 && !c.allowError) throw new Error(`${want} 이 떴다가 사라졌다 — 재렌더 확인 필요`);
    const nAlt = alt ? await page.locator(alt).count() : 0;
    row.detail = `${want} × ${n}` + (nAlt ? ` · .err-note × ${nAlt}` : "");

    // 규격 실측 — 섹션에는 아이콘도 버튼도 없어야 한다
    if (c.scope === "section" && n > 0) {
      const bad = await page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll(".sec-empty")) {
          const r = el.getBoundingClientRect();
          if (el.querySelector("img, svg")) out.push("아이콘 있음");
          if (el.querySelector("button.btn-primary, .btn-brand, a.btn")) out.push("버튼 있음");
          if (r.height > 56.5) out.push(`높이 ${Math.round(r.height)}px`);
        }
        return out;
      });
      if (bad.length) { row.spec = true; row.detail += ` · 위반: ${[...new Set(bad)].join(", ")}`; }
    }
    if (c.scope === "full" && n > 0) {
      const m = await page.evaluate(() => {
        const el = document.querySelector(".empty-state");
        const img = el.querySelector("img");
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          icon: img ? Math.round(img.getBoundingClientRect().width) : 0,
          padTop: Math.round(parseFloat(cs.paddingTop)),
          h: Math.round(r.height),
          hasTitle: !!el.querySelector(".es-title"),
          hasHint: !!el.querySelector(".es-hint"),
          hasCta: !!el.querySelector(".es-action"),
        };
      });
      row.detail += ` · 아이콘 ${m.icon}px · 위여백 ${m.padTop}px · 제목 ${m.hasTitle ? "○" : "✗"} 설명 ${m.hasHint ? "○" : "✗"} CTA ${m.hasCta ? "○" : "—"}`;
      if (m.icon !== 88) { row.spec = true; row.detail += ` · 위반: 아이콘 ${m.icon}px (규격 88)`; }
      if (m.padTop < 48) { row.spec = true; row.detail += ` · 위반: 위여백 ${m.padTop}px (규격 ≥48)`; }
    }

    // 로딩 규격 실측 — 텍스트·스피너가 없어야 한다 (§A-4).
    //
    // 애니메이션은 **sk-shimmer 하나만** 허용한다. 026 §A-4 는 "shimmer 금지 —
    // 움직임은 후속 모션 규격에서" 였고, 그 후속(027 §H2)이 스켈레톤 한 곳에 허용했다.
    // 그래서 여기서 "애니메이션 0"을 고집하면 검사가 낡은 규칙을 지키게 된다.
    // 대신 **다른 이름의 애니메이션이 섞이면** 잡고, reduce 에서 멈추는지도 함께 본다.
    if (c.scope === "skeleton") {
      const m = await page.evaluate(() => {
        const el = document.querySelector(".sk");
        const vis = [...el.querySelectorAll("*")].filter((x) => !x.classList.contains("sr-only"));
        const names = vis.map((x) => getComputedStyle(x).animationName).filter((n) => n && n !== "none");
        const anim = names.length;
        const other = Array.from(new Set(names.filter((n) => n !== "sk-shimmer")));
        // innerText 는 sr-only 까지 읽는다 — "눈에 보이는 글자"를 재려면 빼고 세야 한다.
        // 대신 sr-only 가 정말 1px 로 숨겨져 있는지는 따로 확인한다 (숨긴 척만 하면 안 된다).
        const clone = el.cloneNode(true);
        clone.querySelectorAll(".sr-only").forEach((x) => x.remove());
        const probe = document.createElement("div");
        probe.style.cssText = "position:fixed;left:-9999px;top:0";
        probe.appendChild(clone); document.body.appendChild(probe);
        const text = clone.innerText.trim();
        probe.remove();
        const sr = el.querySelector(".sr-only");
        const srBox = sr ? sr.getBoundingClientRect() : null;
        return { rows: el.querySelectorAll(".sk-row").length, anim, other, text,
                 srHidden: srBox ? (srBox.width <= 1.5 && srBox.height <= 1.5) : null,
                 h: Math.round(el.getBoundingClientRect().height) };
      });
      // reduce 에서 shimmer 가 정말 멈추는지 — 짝이 되는 확인 (§H2)
      const rctx = await page.context().browser().newContext({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" });
      await rctx.addCookies(await page.context().cookies());
      const rp = await rctx.newPage();
      if (c.route?.mode === "hang") await rp.route(c.route.url, async () => {});   // 같은 요청을 붙잡아야 스켈레톤이 뜬다
      await rp.goto(page.url(), { waitUntil: "domcontentloaded" }).catch(() => {});
      const rAnim = await rp.waitForSelector(".sk", { timeout: 8000 })
        .then(() => rp.evaluate(() => [...document.querySelectorAll(".sk *")]
          .map((x) => getComputedStyle(x).animationName).filter((n) => n && n !== "none").length))
        .catch(() => -1);
      await rctx.close();
      row.detail += ` · 행 ${m.rows}개 · 높이 ${m.h}px · 애니메이션 ${m.anim}(${m.other.length ? m.other.join(",") : "sk-shimmer 뿐"}) · reduce 애니메이션 ${rAnim} · 보이는 글자 "${m.text}" · sr-only 숨김 ${m.srHidden === null ? "없음" : m.srHidden ? "○" : "✗"}`;
      if (m.srHidden === false) { row.spec = true; row.detail += " · 위반: sr-only 가 화면에 보인다"; }
      if (m.text !== "") { row.spec = true; row.detail += " · 위반: 텍스트 있음"; }
      if (m.other.length > 0) { row.spec = true; row.detail += ` · 위반: sk-shimmer 밖 애니메이션 ${m.other.join(",")}`; }
      if (m.anim === 0) { row.spec = true; row.detail += " · 위반: shimmer 가 아예 없다"; }
      if (rAnim > 0) { row.spec = true; row.detail += " · 위반: reduce 에서도 움직인다"; }
    }
    if (c.scope === "error") {
      const m = await page.evaluate(() => {
        const el = document.querySelector(".err-note");
        return { icon: !!el.querySelector("img, svg"), retry: !!el.querySelector(".err-retry"),
                 text: el.innerText.replace(/\s+/g, " ").trim().slice(0, 90) };
      });
      row.detail += ` · 아이콘 ${m.icon ? "있음(위반)" : "없음"} · 다시시도 ${m.retry ? "○" : "✗"} · "${m.text}"`;
      if (m.icon) row.spec = true;
      if (!m.retry) { row.spec = true; row.detail += " · 위반: 다시 시도 없음"; }
      // "못 불러왔다"와 "없다"를 같이 말하면 안 된다 — 실제로 그렇게 떠 있었다.
      const alsoEmpty = await page.locator(".empty-state").count();
      if (alsoEmpty > 0) { row.spec = true; row.detail += ` · 위반: 빈 상태도 같이 떠 있음 (${alsoEmpty}개)`; }
    }

    row.shot = `${OUT}/${c.id}.png`;
    await page.screenshot({ path: row.shot, fullPage: false });
    row.status = row.spec ? "SPEC" : "OK";
  } catch (e) {
    row.detail = String(e.message ?? e).split("\n")[0].slice(0, 140);
  } finally {
    for (const s of c.restore) await sql(s).catch((e) => console.error("restore 실패", s, e.message));
    if (c.route) await page.unroute(c.route.url).catch(() => {});
  }
  const newErr = errors.slice(before);
  if (newErr.length) row.detail += ` · JS오류 ${newErr.length}건: ${newErr[0].slice(0, 80)}`;
  results.push(row);
  console.log(`${row.status.padEnd(4)} ${c.id.padEnd(20)} ${row.detail}`);
}

await browser.close();
await pool.end();

const ok = results.filter((r) => r.status === "OK").length;
console.log(`\n합계 ${results.length} · 통과 ${ok} · 규격위반 ${results.filter((r) => r.status === "SPEC").length} · 도달실패 ${results.filter((r) => r.status === "MISS").length}`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 2));
