// 권한으로 막히는 API 를 화면이 **조건 없이** 부르는 자리 (MD-P-2026-062 §B-7).
//
// ── 왜 이 검사가 필요한가 ────────────────────────────────────────
//
// /reports 를 팀원이 열 때마다 `GET /api/reports` 가 403 으로 되돌아왔다.
// 화면은 `res.ok` 가 아니면 조용히 넘어가서 **보이는 고장이 없었고**, 그래서
// 오래 남았다. 콘솔의 403 은 「화면이 자기가 할 수 없는 일을 했다」는 표시다.
//
// 같은 모양이 또 있는지 **소스에서** 센다. 화면을 흔들어 찾으면 그 순간 그
// 상태에 있던 것만 잡힌다 — 버튼 뒤에 숨은 호출은 안 잡힌다.
//
// ── 무엇을 막는 것으로 보는가 ───────────────────────────────────
//
// 권한이 없으면 **거절하는** 것만 센다(403/401). 권한에 따라 결과를 **좁히는**
// 것은 안 센다 — 팀원이 불러도 맞는 응답이 오므로 부르는 것이 잘못이 아니다.
//   막는 것   `requireLead()` · `requireAdmin()` · `if (!hasLead(...)) … 403`
//   좁히는 것 `scope === "all" && hasLead(...)` 같은 자리
//
// ── 이 검사가 **못 보는 것** ────────────────────────────────────
//
// 「그 파일·그 페이지·그 프롭 어딘가에 문이 있는가」까지만 본다.
// **문이 있는데 그 문 뒤로 호출이 안 들어간** 경우는 못 본다 —
// 062 §B 가 고친 자리가 정확히 그 모양이었다. `ReportsView` 는 `isLead` 를
// 알고 있었고 탭도 그것으로 감췄는데, 목록 부르기만 문 밖에 있었다.
// 그쪽은 소스가 아니라 **화면을 열어서** 잡는다 — `member-perm-walk` ①.
// 이 파일은 §B-7 의 「훑어서 개수를 낸다」를 맡는다.
//
// 읽기만 한다. 화면도 DB 도 안 건드린다.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const VERBS = ["GET", "POST", "PATCH", "PUT", "DELETE"];
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const files = execFileSync("git", ["ls-files", "app", "components"], { encoding: "utf-8" })
  .split("\n").filter(Boolean);

/* ── ① 막는 (경로, 메서드) 를 모은다 ───────────────────────────── */

/** `app/api/reports/[id]/approve/route.ts` → `/api/reports/:p/approve` */
const routePath = (f) => "/" + f.replace(/^app\//, "").replace(/\/route\.ts$/, "")
  .split("/").map((s) => (s.startsWith("[") ? ":p" : s)).join("/");

/** 이 핸들러가 권한 없는 사람을 **거절**하는가. */
const blocks = (body) =>
  /require(Lead|Admin)\s*\(/.test(body) ||
  /if\s*\(\s*!\s*hasLead\s*\([^)]*\)\s*\)/.test(body);

const guarded = [];          // { path, verb }
for (const f of files) {
  if (!/^app\/api\/.*\/route\.ts$/.test(f)) continue;
  const src = readFileSync(f, "utf-8");
  // 핸들러별로 자른다. 파일 전체로 보면 POST 의 `requireLead` 가 GET 까지
  // 막는 것처럼 읽힌다 — 실제로 /api/projects 가 그 모양이다.
  const marks = [];
  for (const v of VERBS) {
    const i = src.search(new RegExp(`export\\s+async\\s+function\\s+${v}\\s*\\(`));
    if (i >= 0) marks.push({ v, i });
  }
  marks.sort((a, b) => a.i - b.i);
  marks.forEach((m, k) => {
    const body = src.slice(m.i, k + 1 < marks.length ? marks[k + 1].i : src.length);
    if (blocks(body)) guarded.push({ path: routePath(f), verb: m.v });
  });
}
const guardedKey = new Set(guarded.map((g) => `${g.verb} ${g.path}`));

/* ── ② 화면이 그 주소를 부르는 자리를 모은다 ───────────────────── */

/** `/api/reports/${id}/approve` → `/api/reports/:p/approve` (비교할 수 있게) */
const normalize = (u) => u.replace(/\$\{[^}]*\}/g, ":p").replace(/\?.*$/, "").replace(/\/+$/, "");

/*
 * ── 「역할을 따진다」를 **두 곳**에서 본다 ───────────────────────
 *
 * 처음엔 부르는 파일만 보고 11자리를 「역할을 안 따진다」로 셌다가 틀렸다.
 * `PlatformSettings` 는 제 안에 역할 검사가 없지만, 그것을 그리는
 * `app/settings/page.tsx` 가 맨 위에서 `if (!hasLead(user.role)) redirect(...)`
 * 를 한다 — **문이 화면 쪽에 있고 방 안에는 없다.** 방만 보고 「열려 있다」고
 * 적으면 없는 고장을 센다(§G 057).
 *
 * 그래서 부르는 파일과 **그 파일을 들여오는 page** 를 같이 본다. 한 단계면
 * 이 리포는 다 덮인다 — 두 단계 넘어 그려지는 자리가 생기면 여기를 늘린다.
 */
/*
 * 문의 **모양이 여럿**이다. 처음엔 역할 이름(`hasLead` 따위)만 찾다가 둘을
 * 「문이 없다」로 잘못 셌다 — 둘 다 문이 있었고 모양이 달랐을 뿐이다(§G 048).
 *   · 역할로            `hasLead(user.role)` · `isAdmin(user)`
 *   · 프롭으로          `canCreate` — ProjectCombo 는 이것이 거짓이면
 *                       「만들기」 줄 자체를 안 그린다(§B-4 를 이미 지킨다)
 *   · 서버가 셈해 준 값  `canEdit` · `readOnly` — ProjectWorkspace 가 쓴다.
 *                       역할을 화면이 다시 풀지 않아 오히려 낫다.
 */
const GATE = /hasLead\s*\(|isAdmin\s*\(|isLead|adminGrant|showsAdminGrantBadge|canCreate|canEdit|readOnly/;
const pageGate = new Map();          // 컴포넌트 파일 → 그것을 그리는 page 가 막는가
for (const f of files) {
  if (!/^app\/.*\/page\.tsx$/.test(f) && f !== "app/page.tsx") continue;
  const src = readFileSync(f, "utf-8");
  const gated = /redirect\s*\(\s*deniedHref/.test(src) || GATE.test(src);
  if (!gated) continue;
  for (const m of src.matchAll(/from\s+["']@\/components\/([\w/]+)["']/g))
    for (const ext of [".tsx", ".ts"]) pageGate.set(`components/${m[1]}${ext}`, f);
}

const FETCH = /fetch\(\s*([`"'])([^`"']*)\1\s*(?:,\s*\{([\s\S]{0,220}?)\})?/g;
const calls = [];            // { file, line, path, verb, gatedFile, gateAt }
for (const f of files) {
  if (!/\.(tsx|ts)$/.test(f) || f.startsWith("app/api/")) continue;
  const src = readFileSync(f, "utf-8");
  if (!src.includes('"use client"') && !src.includes("'use client'")) continue;
  const gateAt = GATE.test(src) ? f : (pageGate.get(f) ?? null);
  const gatedFile = gateAt !== null;
  for (const m of src.matchAll(FETCH)) {
    const url = m[2];
    if (!url.startsWith("/api/")) continue;
    const opts = m[3] ?? "";
    const verb = (opts.match(/method\s*:\s*["'](\w+)["']/)?.[1] ?? "GET").toUpperCase();
    const line = src.slice(0, m.index).split("\n").length;
    calls.push({ file: f, line, path: normalize(url), verb, gatedFile, gateAt });
  }
}

/* ── ③ 겹치는 것 ──────────────────────────────────────────────── */

const hits = calls.filter((c) => guardedKey.has(`${c.verb} ${c.path}`));
const noGate = hits.filter((c) => !c.gatedFile);

console.log(`막는 (경로, 메서드) ${guarded.length}쌍 · 화면의 /api 호출 ${calls.length}자리` +
            ` · 그중 막히는 곳을 부르는 자리 ${hits.length}`);
console.log(`\n── 막히는 곳을 부르는 자리 ──`);
for (const c of hits.sort((a, b) => a.file.localeCompare(b.file)))
  console.log(`  ${c.gatedFile ? `막는 자리 있음 (${c.gateAt})`.padEnd(46) : "막는 자리 없음".padEnd(46)}` +
              `${c.verb.padEnd(6)} ${c.path.padEnd(34)} ${c.file}:${c.line}`);

/*
 * ── 존재 단언 ────────────────────────────────────────────────
 * 빈 배열이면 「깨끗하다」가 아니라 **못 읽은 것**이다(§G 061 §E). 세 자리 다
 * 최소 개수를 묻는다. 숫자는 손으로 적은 기준이 아니라 지금 리포에서 나온
 * 값보다 낮게 잡는다 — 자리가 늘어도 안 깨지고, 0 이 되면 깨진다.
 */
chk("①-막는-자리를-찾았다", guarded.length >= 10,
    `${guarded.length}쌍 — [${[...guardedKey].slice(0, 4).join(" · ")} …]`);
chk("②-화면의-호출을-찾았다", calls.length >= 50, `${calls.length}자리`);
chk("③-겹치는-자리를-찾았다", hits.length >= 1,
    `${hits.length}자리 (0이면 ①②가 서로 다른 것을 보고 있다)`);

/*
 * ── ④ 역할을 아예 안 따지는 파일에서 막히는 곳을 부르는 자리 ──
 *
 * **이것이 이번에 고친 그 모양이다.** 0 이라야 한다. 0 이 아니면 고치라는
 * 뜻이 아니라 **사람이 읽어 볼 목록**이다 — 버튼 뒤에 있어 화면이 이미
 * 감추고 있을 수도 있다. §B-7 은 개수만 낸다.
 */
chk("④-역할을-안-따지는-파일에서-부른다", noGate.length === 0,
    noGate.length === 0 ? "0자리"
      : `${noGate.length}자리 — [${noGate.map((c) => `${c.verb} ${c.path} ${c.file}:${c.line}`).join(" · ")}]`);

console.log(`\n${pass}/${pass + fail} 통과`);
process.exitCode = fail === 0 ? 0 : 1;
