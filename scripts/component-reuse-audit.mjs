// §C4 재사용 증명 (MD-P-2026-031).
//
// > **홈 · 업무 목록 · 프로젝트 상세 · 영역 상세 넷이 같은 컴포넌트를 쓴다.**
// > 홈에만 만들고 나머지를 옛 목록으로 두면 이 작업은 실패다.
//
// 이 검사는 **두 층에서** 그것을 본다. 한 층만 보면 둘 다 속는다.
//
//   ① 코드 — 네 화면의 파일이 `components/TaskTable` 을 import 한다.
//      import 만 보면 **부르지 않는 import** 도 통과한다. 그래서 ②를 붙인다.
//   ② 화면 — 네 주소를 실제로 열어 `TaskTable` 이 그린 표(`.tt-table`)를 센다.
//      화면만 보면 **표처럼 생긴 다른 것**도 통과한다. 그래서 ①을 붙인다.
//      둘이 서로의 짝이다.
//   ③ 두 벌 금지 — `<table` 을 직접 쓰는 컴포넌트가 늘지 않았는지 센다.
//      새 목록이 생기면 여기서 먼저 걸린다.
//
// 읽기 전용이다. 아무것도 만들지 않고 지우지 않는다.
// **로컬 전용** (지시 32).
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("component-reuse-audit.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(18)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(18)} ${n}`); };

/** 네 자리. **화면 이름 · 그 화면을 그리는 파일 · 주소**를 한 줄에 묶어 둔다. */
const FOUR = [
  { name: "홈",           file: "components/HomeView.tsx",         path: "/" },
  { name: "업무 목록",     file: "components/TasksView.tsx",        path: "/tasks" },
  { name: "프로젝트 상세", file: "components/ProjectWorkspace.tsx", path: null },   // 주소는 아래에서 정한다
  { name: "영역 상세",     file: "components/AreaDetail",           path: null },   // 〃
];

let browser;
try {
  // ── ① 코드: import 경로 ────────────────────────────────────────
  //
  // 「영역 상세」는 전용 컴포넌트를 만들지 않고 `TasksView` 를 고정 모드로 연다.
  // 그래서 이 자리의 증명은 **페이지가 TasksView 를 import 하는가** 로 본다 —
  // 새 목록을 안 만든 것 자체가 §C4 가 원하는 결과다.
  const readsTaskTable = (f) => /from\s+["']\.\/TaskTable["']|from\s+["']@\/components\/TaskTable["']/.test(readFileSync(f, "utf8"));
  const codeFindings = [];
  for (const f of ["components/HomeView.tsx", "components/TasksView.tsx", "components/ProjectWorkspace.tsx"]) {
    codeFindings.push({ f, has: readsTaskTable(f) });
  }
  const areaPage = readFileSync("app/areas/[key]/page.tsx", "utf8");
  const areaUsesTasksView = /from\s+["']@\/components\/TasksView["']/.test(areaPage) && /lockedArea=/.test(areaPage);
  const missing = codeFindings.filter((c) => !c.has).map((c) => c.f);
  if (missing.length) bad("①import", `TaskTable 을 안 읽는 파일: ${missing.join(", ")}`);
  else if (!areaUsesTasksView) bad("①import", "영역 상세가 `TasksView` 를 고정 모드로 열지 않는다 — 목록이 두 벌이 됐을 수 있다");
  else ok("①import", `${codeFindings.map((c) => c.f.replace("components/", "")).join(" · ")} → TaskTable · 영역 상세 → TasksView(lockedArea)`);

  // ── ② 화면: 네 주소에서 실제로 그려지는가 ──────────────────────
  const lead = (await pool.query(
    `SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
      WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 1`)).rows[0];
  if (!lead) throw new Error("사람 계정이 없다 — 시드부터 하라");
  const proj = (await pool.query(`SELECT id, name FROM project WHERE is_active ORDER BY id LIMIT 1`)).rows[0];
  const area = (await pool.query(
    `SELECT id, name FROM area WHERE is_active AND kind='workspace' ORDER BY sort_order, id LIMIT 1`)).rows[0];
  if (!proj || !area) throw new Error("프로젝트·영역 시드가 없다 — 넷 중 둘을 열 수 없다");
  // 프로젝트 상세는 **탭이 있는 작업 공간**이고 기본 탭이 「개요」다. 업무 표는 「업무」 탭에 있다.
  // (홈의 탭과 다르다 — 홈 탭은 같은 목록을 두 번 보여줬고, 여기는 다른 것들이다.)
  // 기본 주소로만 재면 「프로젝트 상세에는 표가 없다」는 틀린 FAIL 이 난다. 실제로 그렇게 났다.
  FOUR[2].path = `/projects/${proj.id}?tab=tasks`;
  FOUR[3].path = `/areas/${area.id}`;

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e).slice(0, 160)));

  const seen = [];
  for (const f of FOUR) {
    await page.goto(BASE + f.path, { waitUntil: "networkidle" });
    const frn = page.locator(".frn-skip");
    if (await frn.count()) { await frn.first().click(); await page.locator(".frn-bg").waitFor({ state: "detached", timeout: 5000 }); }
    // 표가 뜰 때까지 기다린다. 없으면 없는 것으로 적는다 — 고정 시간으로 넘기지 않는다.
    await page.waitForSelector(".tt-table", { timeout: 8000 }).catch(() => {});
    const n = await page.locator(".tt-table").count();
    // 다른 표가 아니라 **그 컴포넌트**인지: colgroup + 머리글 「업무」로 확인한다.
    const isTaskTable = n > 0 && await page.locator(".tt-table colgroup").count() > 0
      && (await page.locator(".tt-table thead th").allTextContents()).includes("업무");
    seen.push({ ...f, n, isTaskTable });
  }
  const dead = seen.filter((x) => !x.isTaskTable);
  dead.length === 0
    ? ok("②화면", seen.map((x) => `${x.name}(${x.path}) 표 ${x.n}`).join(" · "))
    : bad("②화면", `TaskTable 이 안 그려지는 화면: ${dead.map((x) => `${x.name}(${x.path}) 표 ${x.n}`).join(" · ")}`);

  // ── ③ 두 벌 금지 ──────────────────────────────────────────────
  //
  // `<table` 을 직접 쓰는 컴포넌트 목록을 **이름으로** 고정해 둔다.
  // 새 이름이 늘면 「목록을 또 만들었다」는 뜻이고, 그때 이 줄이 먼저 걸린다.
  //
  // **이유를 함께 적는다.** 이름만 나열한 허용 목록은 왜 허용됐는지를 잃어버리고,
  // 그러면 다음 사람이 「이미 넷이나 있으니 하나 더」로 읽는다.
  const ALLOWED_TABLES = {
    "TaskTable.tsx":     "넷이 함께 쓰는 그 표",
    "MemberManager.tsx": "팀원 관리 표 — 업무 목록이 아니다",
    "PerfReport.tsx":    "성과 보고 인쇄물 — 화면 목록이 아니다",
    "ReportView.tsx":    "목표 보고 표(행이 목표다) — 업무 목록이 아니다",
    // ⚠ 이것 하나는 **진짜 두 번째 업무 표**다. 머리글이 「업무명 · 기간」이다.
    //   `/tasks` 의 타임라인 렌즈이고, `TaskTable` 에 기한 막대가 생긴 지금은 겹친다.
    //   지금 합치지 않는다 — 렌즈 통합은 §D 판단이다. **겹친다는 사실을 여기 적어 둔다.**
    "TimelineView.tsx":  "⚠ 타임라인 렌즈 — TaskTable 에 막대가 생긴 뒤로 겹친다(§D 통합 후보)",
  };
  const withTable = readdirSync("components")
    .filter((f) => f.endsWith(".tsx"))
    .filter((f) => /<table[\s>]/.test(readFileSync(`components/${f}`, "utf8")));
  const allowed = Object.keys(ALLOWED_TABLES);
  const extra = withTable.filter((f) => !allowed.includes(f));
  // 허용 목록도 낡는다. 「이제 안 걸리는 항목」을 조용히 두면 목록이 사실과 멀어진다.
  const goneFromList = allowed.filter((f) => !withTable.includes(f));
  if (extra.length) bad("③두벌금지", `허용 목록에 없는 표: ${extra.join(", ")} — 목록을 또 만들었는지 보라`);
  else if (goneFromList.length)
    bad("③두벌금지", `허용 목록에 있는데 이제 <table> 을 안 쓰는 파일: ${goneFromList.join(", ")} — 목록에서 지울 것`);
  else {
    ok("③두벌금지", `<table> 을 직접 쓰는 컴포넌트 ${withTable.length}개 — 전부 허용 목록`);
    for (const f of withTable) console.log(`     ${f.padEnd(20)} ${ALLOWED_TABLES[f]}`);
  }

  jsErrors.length === 0 ? ok("JS오류", "0건") : bad("JS오류", `${jsErrors.length}건 — ${jsErrors[0]}`);
} catch (e) {
  console.log(String(e && e.stack ? e.stack : e));
  bad("예외", String(e && e.message ? e.message.split("\n")[0] : e));
} finally {
  if (browser) { try { await browser.close(); } catch (e) { console.log(`   브라우저 종료 실패: ${e}`); } }
  try { await pool.end(); } catch { /* 종료 경로 */ }
  const f = rows.filter((r) => r.pass === false).length;
  const p = rows.filter((r) => r.pass === true).length;
  console.log(`\n결과 ${p}/${p + f} 통과`);
  if (rows.length === 0) { console.error("측정된 줄이 0건이다 — 서버가 떠 있는지 확인하라"); process.exit(2); }
  process.exit(f ? 1 : 0);
}
