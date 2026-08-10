// MD-P-2026-031 §C 회신 4 — `useListQuery()` 실측.
//
// **쓰기가 없다.** 주소와 localStorage 만 만진다. 그래서 DSN 을 안 받는다.
//
// 이 검사가 지키는 것 넷.
//   ① **요청은 한 번이다** — 초기값을 다 읽기 전에 목록을 부르면 기본값으로 한 번 받고
//      다시 받는다. 그 사이에 **틀린 순서가 화면에 보인다.** 「중간 상태도 상태다」가
//      두 번 다 여기서 났다. 세는 것은 화면이 아니라 **나간 요청의 수**다.
//   ② **기본값은 주소에 안 쓴다** — 바뀐 것만 남는다.
//   ③ **잘못된 값은 400 이 아니라 기본값 + 주소 정정** — 옛 값은 매핑하되,
//      기능이 없어진 값은 **한 번은 말한다.** 조용히 바뀌면 고장으로 읽힌다.
//   ④ **주소가 저장값보다 세다** — 공유 링크가 이긴다.
//
//   AUTH_SECRET=... node scripts/listquery-walk.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }

const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  console.log(`${ok ? "  ok " : "FAIL"} ${name.padEnd(32)} ${detail}`);
  ok ? pass++ : fail++;
};

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

// ── 관측 도구부터 확인한다 ──────────────────────────────────────
const consoleErrors = [];
page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 120)));
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
page.on("requestfailed", (r) => {
  const why = r.failure()?.errorText ?? "";
  if (/ABORTED/i.test(why)) return;
  consoleErrors.push(`요청 실패 ${r.url().slice(-50)} (${why})`);
});

// 목록 요청만 센다 — `/api/tasks?…` 이고 `/api/tasks/123` 은 아니다.
let listReqs = [];
page.on("request", (r) => {
  const u = new URL(r.url());
  if (u.pathname === "/api/tasks") listReqs.push(u.search);
});

/**
 * 목록이 그려질 때까지 기다린다. 그동안 나간 요청을 돌려준다.
 *
 * **첫 요청이 나갈 때까지 기다린 뒤, 거기서 다시 800ms 를 더 센다.**
 * 고정 시간만 기다리면 늦게 나간 첫 요청을 "0회" 로 읽는다 — 그건 통과가 아니라 미측정이다.
 * 두 번째 요청은 늘 첫 요청 **직후**에 붙어 나오므로(초기값이 늦게 정해져서 다시 부르는 것)
 * 이 800ms 안에 걸린다.
 */
async function openTasks(qs) {
  // **이전 화면의 요청이 끝난 뒤에 통을 비운다.**
  // 안 그러면 앞 페이지가 띄운 `/api/tasks` 가 통을 비운 다음에 도착해서
  // 이번 진입의 요청으로 잡힌다 — 실측에서 6회 중 2회 그렇게 "2회"가 나왔다.
  // 제품이 두 번 부른 것이 아니라 **검사가 남의 것을 센 것**이다.
  await page.waitForLoadState("networkidle").catch(() => {});
  listReqs = [];
  await page.goto(`${BASE}/tasks${qs}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('select[aria-label="정렬 기준"]', { timeout: 15000 });
  for (let i = 0; i < 100 && listReqs.length === 0; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(800);
  return listReqs.slice();
}

const addr = () => page.evaluate(() => location.search);
const assigneeSel = () => page.$eval('select[aria-label="담당"]', (e) => e.value);
const areaAllOn = () => page.$$eval(".pg-filters .pg-chip", (ns) =>
  ns.some((n) => n.textContent.trim() === "전체 영역" && n.classList.contains("on")));
const sortSel = () => page.$eval('select[aria-label="정렬 기준"]', (e) => e.value);
const groupSel = () => page.$eval('select[aria-label="묶는 기준"]', (e) => e.value);
const doneOn = () => page.$$eval(".pg-filters .pg-chip", (ns) =>
  ns.some((n) => n.textContent.trim() === "완료 포함" && n.classList.contains("on")));
const goneCount = () => page.$$eval(".sortgone", (n) => n.length);
const clearStore = () => page.evaluate(() => localStorage.clear());

try {
  // ── ① 요청은 한 번이다 ────────────────────────────────────────
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  await clearStore();
  let reqs = await openTasks("?sort=priority");
  chk("G-요청은 한 번", reqs.length === 1 && /sort=priority/.test(reqs[0] ?? ""),
    `요청 ${reqs.length}회 · ${reqs.map((s) => s || "(빈 쿼리)").join(" | ")}`);

  // 기본 정렬이면 서버에도 안 보낸다 — 서버 기본값과 같은 값을 굳이 실어 보내지 않는다.
  await clearStore();
  reqs = await openTasks("?sort=due");
  chk("G-기본 정렬은 안 보낸다", reqs.length === 1 && !/sort=/.test(reqs[0] ?? ""),
    `요청 ${reqs.length}회 · ${reqs[0] ?? "(없음)"}`);

  // ── ①-b 영역·담당 기본값은 서버가 준다 (§C 회신 5 · ⓑ) ────────
  //
  // 예전에는 `/api/meta/selectors` 응답을 기다려 영역을 정했고, 그 기다림을 세는
  // 게이트(`areaDefaulted`)가 있었다. 게이트가 사라졌으니 **요청은 여전히 한 번**이고
  // 그 한 번에 이미 내 영역이 실려 있어야 한다.
  await clearStore();
  reqs = await openTasks("");
  const a0 = await addr();
  const as0 = await assigneeSel();
  chk("D-영역·담당 기본값을 서버가 준다",
    reqs.length === 1 && /area=\d/.test(reqs[0] ?? "") && !/assignee=/.test(a0) && as0 === "1",
    `요청 ${reqs.length}회 · ${reqs[0]} · 주소 "${a0}" · 담당 ${as0} (기본값이라 주소에 안 쓴다)`);

  // 홈 판단 타일 진입 — **팀 전체 범위**로 연다. 이 판단도 서버가 한다.
  reqs = await openTasks("?due=overdue&assignee=all");
  const wideArea = await areaAllOn(), wideAs = await assigneeSel();
  chk("D-넓게 여는 진입은 전체 영역·전체 담당",
    reqs.length === 1 && !/area=/.test(reqs[0] ?? "") && !/assignee=/.test(reqs[0] ?? "")
      && wideArea && wideAs === "all",
    `요청 ${reqs.length}회 · ${reqs[0]} · 전체 영역 ${wideArea} · 담당 ${wideAs}`);

  await clearStore();
  await openTasks("?assignee=zzz");
  const asBad = await assigneeSel(), aBad = await addr();
  chk("D-모르는 담당은 기본값 + 주소 정정", asBad === "1" && !/assignee=/.test(aBad),
    `담당 ${asBad} · 주소 "${aBad}"`);

  // ── ② 기본값은 주소에 안 쓴다 ─────────────────────────────────
  await clearStore();
  await openTasks("?sort=due&group=none&done=0");
  let a = await addr();
  chk("U-기본값은 주소에 안 쓴다", !/(^|[?&])(sort|group|done)=/.test(a), `주소 "${a}"`);

  await clearStore();
  await openTasks("?sort=priority&group=project&done=1");
  a = await addr();
  const s1 = await sortSel(), g1 = await groupSel(), d1 = await doneOn();
  chk("U-바뀐 것만 남는다",
    /sort=priority/.test(a) && /group=project/.test(a) && /done=1/.test(a) && s1 === "priority" && g1 === "project" && d1,
    `주소 "${a}" · 정렬 ${s1} · 묶기 ${g1} · 완료 포함 ${d1}`);

  // ── ③ 옛 값 · 없어진 값 · 모르는 값 ───────────────────────────
  await clearStore();
  await openTasks("?sort=recent");
  const s2 = await sortSel(), n2 = await goneCount();
  const st2 = await page.evaluate(() => localStorage.getItem("tb:tasks-sort"));
  chk("A-recent 는 조용히 created", s2 === "created" && n2 === 0 && st2 === "created",
    `정렬 ${s2} · 안내 ${n2}개 · 저장값 ${st2} (이름만 바뀐 같은 기능이다)`);

  await clearStore();
  await openTasks("?sort=progress");
  const s3 = await sortSel(), n3 = await goneCount();
  const t3 = n3 ? await page.$eval(".sortgone", (e) => e.textContent.replace(/\s+/g, " ").trim()) : "";
  chk("A-progress 는 한 번 말한다", s3 === "due" && n3 === 1,
    `정렬 ${s3} · 안내 ${n3}개 — "${t3}"`);

  await page.click('.sortgone button[aria-label="안내 닫기"]');
  const n4 = await goneCount();
  await openTasks("");   // 파라미터 없이 다시 — 저장값은 이미 due 로 옮겨졌다
  const n5 = await goneCount(), s5 = await sortSel();
  chk("A-닫으면 다시 안 뜬다", n4 === 0 && n5 === 0 && s5 === "due",
    `닫은 뒤 ${n4}개 · 다시 들어와서 ${n5}개 · 정렬 ${s5}`);

  await clearStore();
  await openTasks("?sort=zzz&group=zzz");
  const s6 = await sortSel(), g6 = await groupSel(), a6 = await addr();
  chk("V-모르는 값은 기본값 + 주소 정정", s6 === "due" && g6 === "none" && !/(sort|group)=/.test(a6),
    `정렬 ${s6} · 묶기 ${g6} · 주소 "${a6}" (400 이 아니다)`);

  // ── ④ 주소가 저장값보다 세다 ──────────────────────────────────
  await clearStore();
  await page.evaluate(() => localStorage.setItem("tb:tasks-sort", "priority"));
  await openTasks("?sort=created");
  const s7 = await sortSel();
  chk("S-주소가 저장값보다 세다", s7 === "created",
    `저장값 priority · 주소 created → 화면 ${s7} (공유 링크가 이긴다)`);

  await openTasks("");   // 주소가 없으면 지난 선택
  const s8 = await sortSel();
  chk("S-주소가 없으면 지난 선택", s8 === "created", `저장값 ${s8}`);

  // ── history 를 쌓지 않는다 ────────────────────────────────────
  const h0 = await page.evaluate(() => history.length);
  await page.selectOption('select[aria-label="정렬 기준"]', "priority");
  await page.selectOption('select[aria-label="묶는 기준"]', "due");
  await page.click('.pg-filters .pg-chip:text-is("완료 포함")');
  await page.waitForTimeout(400);
  const h1 = await page.evaluate(() => history.length);
  chk("U-history 를 안 쌓는다", h1 === h0, `세 번 바꿔서 ${h0} → ${h1} (replaceState)`);

  // ── 홈도 같은 훅을 쓴다 ──────────────────────────────────────
  await page.goto(`${BASE}/?span=all`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".judge", { timeout: 15000 });
  await page.waitForTimeout(400);
  const ha = await addr();
  const on = await page.$$eval(".pg-filters .pg-chip", (ns) =>
    ns.filter((n) => n.classList.contains("on")).map((n) => n.textContent.trim()));
  chk("H-홈 span 도 같은 훅", /span=all/.test(ha) && on.includes("전체 기간"),
    `주소 "${ha}" · 켜진 칩 ${on.join(" · ")}`);

  await page.goto(`${BASE}/?span=zzz`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".judge", { timeout: 15000 });
  await page.waitForTimeout(400);
  const hb = await addr();
  const on2 = await page.$$eval(".pg-filters .pg-chip", (ns) =>
    ns.filter((n) => n.classList.contains("on")).map((n) => n.textContent.trim()));
  chk("H-홈도 기본값 + 주소 정정", !/span=/.test(hb) && on2.includes("이번 분기"),
    `주소 "${hb || "(없음)"}" · 켜진 칩 ${on2.join(" · ")}`);

  /**
   * **서버가 그린 HTML 자체를 본다.**
   * 브라우저로 재면 "언제 재느냐"에 답이 달린다 — 처음엔 400ms 뒤에 재서 통과했다가
   * 세 번째 회차에서 실패했다. 하이드레이션이 늦으면 기본값 화면이 그만큼 오래 보인다.
   * `?span` 은 저장값이 없어 **서버가 답을 안다.** 그러면 첫 바이트부터 맞아야 한다.
   */
  const html = async (u) => (await ctx.request.get(`${BASE}${u}`)).text();
  const onChip = (h, label) => new RegExp(`pg-chip on">${label}`).test(h);
  const hAll = await html("/?span=all");
  const hDef = await html("/");
  chk("H-첫 바이트부터 맞다 (SSR)",
    onChip(hAll, "전체 기간") && !onChip(hAll, "이번 분기") && onChip(hDef, "이번 분기"),
    `?span=all → 전체 기간 ${onChip(hAll, "전체 기간")} · 기본 → 이번 분기 ${onChip(hDef, "이번 분기")} (하이드레이션을 기다리지 않는다)`);

  // 업무 목록도 같다 — 주소에 있는 값은 서버가 안다.
  const sel = (h) => (/<option value="([a-z]+)" selected="">/.exec(h.split('aria-label="정렬 기준"')[1] ?? "") ?? [])[1];
  const tPri = await html("/tasks?sort=priority");
  const tGone = await html("/tasks?sort=progress");
  const tDef = await html("/tasks");
  const tWide = await html("/tasks?due=overdue&assignee=all");
  chk("D-첫 바이트부터 전체 범위 (SSR)",
    /pg-chip on">전체 영역/.test(tWide) && /<option value="all" selected="">/.test(tWide),
    `전체 영역 칩 ${/pg-chip on">전체 영역/.test(tWide)} · 담당 all ${/<option value="all" selected="">/.test(tWide)}`);

  chk("U-공유 링크는 SSR 부터 맞다",
    sel(tPri) === "priority" && sel(tDef) === "due" && sel(tGone) === "due" && /class="sortgone"/.test(tGone),
    `?sort=priority → ${sel(tPri)} · 기본 → ${sel(tDef)} · ?sort=progress → ${sel(tGone)} + 안내 ${/class="sortgone"/.test(tGone)}`);

  chk("콘솔 오류 0건", consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(" / ") : "관측 도구가 성했다");
} finally {
  await browser.close();
}

console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
