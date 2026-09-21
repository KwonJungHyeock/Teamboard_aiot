// 같은 상태는 화면마다 같은 낱말 (MD-P-2026-064 §B-12).
//
// ── 왜 ───────────────────────────────────────────────────────────
//
// 063 §B-2 가 조사하다 찾았다. 상태 이름표가 **네 벌**이었고, 그중 한 벌만
// 다른 말을 했다:
//     lib/task-view.ts STATUS_META   todo 「대기」 · review 「리뷰」
//     TaskTable · HandoverView       todo 「대기」 · review 「리뷰」
//     OpenDueView                    todo 「**할 일**」 · review 「**검토**」
// 사본을 만든 값이라 두 곳이 갈린 줄도 몰랐다. 같은 상태가 화면마다 다른
// 낱말로 보이면 읽는 사람이 같은 것인지 매번 다시 판단한다.
//
// ── 무엇을 보는가 ───────────────────────────────────────────────
//
//   ① 세 화면의 **상태 칸 낱말**이 전부 제품의 `STATUS_META` 안에 있다
//   ①짝 세 화면 다 낱말을 하나 이상 읽었다 (빈 화면이면 ①은 공짜로 참이다)
//   ② 갈렸던 낱말(「할 일」·「검토」)이 세 화면 어디에도 없다
//
// 기준값은 **제품에서 가져온다** — `lib/task-view.ts` 를 컴파일해서 부른다.
// 검사기가 이름표를 옮겨 적으면 둘이 갈릴 때 검사기가 틀린 쪽을 정답으로 삼는다.
//
// **로컬 전용** · /handover 는 문서가 없으면 업무를 안 그려서 **하나 만들고 지운다**.
// 나머지 둘은 읽기만 한다.
//
// ⚠ | head 로 파이프하지 말 것.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { ignoredWhy } from "./console-ignore.mjs";

requireLocalDb("status-word-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".sw-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(24)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(24)} ${n}`); } };

/** 063 이 찾은 갈린 낱말. 이 둘이 다시 나오면 사본이 또 생긴 것이다. */
const SPLIT_WORDS = ["할 일", "검토"];

/** 화면마다 상태가 **어디에** 그려지는가. 본문 전체를 훑으면 산문까지 센다. */
const SCREENS = [
  { path: "/open-due", cell: ".od-t tbody tr td:nth-child(5)" },
  { path: "/tasks",    cell: "td.col-st" },
  /*
   * /handover 는 **문서가 하나 있어야** 업무가 그려진다. 빈 화면에서 재면
   * 「낱말 0가지」가 나오고, 그러면 ①은 공짜로 참이 된다.
   * 그래서 조건을 만든다 — 「＋ 새 인수인계」를 눌러 문서를 만들고 나서 읽는다.
   * 만든 문서는 뒷정리에서 지운다.
   */
  { path: "/handover", cell: ".ho-task-m, .ho-task-pick em", setup: true },
];

let browser, madeHandover = false;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "task-view.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const { STATUS_META } = createRequire(path.join(TMP, "noop.cjs"))(path.join(TMP, "task-view.js"));
  const CANON = Object.values(STATUS_META).map((m) => m.label);
  console.log(`제품의 이름표 — ${Object.entries(STATUS_META).map(([k, v]) => `${k}:${v.label}`).join(" · ")}\n`);

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name n FROM account a
       JOIN actor ac ON ac.id = a.actor_id
      WHERE (a.role IN ('admin','lead') OR a.admin_grant) AND ac.is_active
      ORDER BY a.actor_id LIMIT 1`))[0];

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: me.id, actorId: me.id, name: me.n, role: me.role, adminGrant: me.admin_grant, email: "x@x" }) }]);
  const errs = [];

  const seen = [];        // { path, words: Set, bodyHits: [] }
  for (const s of SCREENS) {
    const page = await ctx.newPage();
    page.on("console", (m) => { const k = m.type();
      if (k !== "error" && k !== "warning") return;
      const line = `[${k}] ${m.text().slice(0, 160)}`;
      if (!ignoredWhy(line)) errs.push(line); });
    await page.goto(`${BASE}${s.path}`, { waitUntil: "networkidle" });
    await page.locator(".frn-skip").first().click({ timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(900);
    if (s.setup) {
      await page.getByRole("button", { name: "＋ 새 인수인계" }).first().click({ timeout: 6000 });
      await page.waitForSelector(".ho-task-pick, .ho-task-m", { timeout: 10000 })
        // 빈 catch 는 없는 실패를 만든다(§G 051) — 못 만들었으면 적고 넘어간다.
        .catch(() => console.log("   (인수인계 문서를 못 만들었다 — 아래 ①짝이 잡는다)"));
      await page.waitForTimeout(600);
      madeHandover = true;
    }
    /*
     * 상태 칸의 글자만 읽는다. `td.col-st` 안에는 셀렉트가 들어 있을 수 있어서
     * 고른 값(`select` 의 선택된 option)까지 같이 본다 — 보이는 낱말이 거기 있다.
     */
    const words = await page.$$eval(s.cell, (els) => els.flatMap((el) => {
      const sel = el.querySelector("select");
      const t = (sel ? sel.options[sel.selectedIndex]?.textContent : el.textContent) ?? "";
      // 「대기 · 기한 2026-09-30 · 플랫폼」처럼 붙어 나오는 자리가 있다. 첫 토막만 본다.
      return [t.split("·")[0].trim()].filter(Boolean);
    }));
    const body = await page.locator("body").innerText().catch(() => "");
    seen.push({ path: s.path, words: [...new Set(words)],
                bodyHits: SPLIT_WORDS.filter((w) => body.includes(w)) });
    await page.close();
  }

  for (const s of seen) console.log(`  ${s.path.padEnd(12)} 상태 칸 낱말 [${s.words.join(" · ")}]`);

  const stray = seen.flatMap((s) => s.words.filter((w) => !CANON.includes(w)).map((w) => `${s.path} "${w}"`));
  chk("①-낱말이-제품-이름표-안에", stray.length === 0,
      stray.length === 0 ? `세 화면의 상태 낱말이 전부 STATUS_META 안에 있다`
        : `밖에 있는 것 ${stray.length}건 — [${stray.join(" · ")}]`);
  /*
   * 빈 화면이면 ①은 공짜로 참이다. **세 화면 다** 하나 이상 읽었는지 묻는다 —
   * 「합쳐서 하나」로 물으면 두 화면이 비어도 통과한다.
   */
  chk("①짝-세-화면-다-읽었다", seen.every((s) => s.words.length > 0),
      seen.map((s) => `${s.path} ${s.words.length}가지`).join(" · "));
  const split = seen.flatMap((s) => s.bodyHits.map((w) => `${s.path} "${w}"`));
  chk("②-갈렸던-낱말이-없다", split.length === 0,
      split.length === 0 ? `「${SPLIT_WORDS.join("」·「")}」 세 화면 본문에 0번`
        : `${split.length}건 — [${split.join(" · ")}]`);
  chk("③-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` [${errs[0]}]` : ""}`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  // 만든 문서를 지운다. 제목은 제품이 정한 것(`새 인수인계 문서`)이라 그 이름으로 고른다.
  if (madeHandover) {
    const ids = (await pool.query(`SELECT id FROM handover WHERE title = $1`, ["새 인수인계 문서"])).rows.map((r) => r.id);
    if (ids.length) {
      await pool.query(`DELETE FROM handover_task WHERE handover_id = ANY($1::int[])`, [ids]).catch(() => {});
      await pool.query(`DELETE FROM handover WHERE id = ANY($1::int[])`, [ids]);
    }
    const left = (await pool.query(`SELECT count(*)::int n FROM handover`)).rows[0].n;
    console.log(`뒷정리 — 인수인계 ${ids.length}건 지움 · 남은 것 ${left}건 (0이어야 한다)`);
  }
  rmSync(TMP, { recursive: true, force: true });
  await browser?.close();
  await pool.end();
}
