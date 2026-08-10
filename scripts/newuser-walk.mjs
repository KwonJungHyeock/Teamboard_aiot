// MD-P-2026-031 §C 회신 6 · 2-1 — **영역 0개 계정이 처음 보는 화면**을 잰다.
//
// **쓰기가 있다. 로컬 DSN 이 아니면 즉시 종료한다** (지시 32). 우회 플래그 없다.
//
// 왜 이 검사가 있는가.
//   「새 계정 발급」 폼에는 영역이 없다. `POST /api/members` 는 actor · account ·
//   에이전트 · agent_config 를 만들지만 **`actor_area` 행은 안 만든다.**
//   그리고 §C 회신 5 에서 `userDefaults(user).areaIds` 를 첫 화면 필터로 만들었다.
//   그래서 **다음에 계정을 받는 사람이 처음 보는 화면**이 무엇인지가 지금 문제다.
//
// 코드를 읽고 추론하지 않는다. **실제로 계정을 만들어서 로그인해 잰다.**
// 계정 생성도 우리가 흉내내지 않고 **진짜 API 를 부른다** — 흉내낸 경로를 재면
// 진짜 경로가 뭘 빠뜨렸는지는 영원히 안 보인다.
//
//   AUTH_SECRET=... DATABASE_URL=postgres://…@127.0.0.1/… node scripts/newuser-walk.mjs
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET;
const DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
if (!DSN) { console.error("DATABASE_URL 필요"); process.exit(1); }
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DSN)) {
  console.error("이 검사는 계정을 만든다. **로컬 DSN 에서만 돈다.** 중단한다.");
  process.exit(1);
}

const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

let pass = 0, fail = 0;
const chk = (name, ok, detail) => {
  console.log(`${ok ? "  ok " : "FAIL"} ${name.padEnd(30)} ${detail}`);
  ok ? pass++ : fail++;
};

const pool = new pg.Pool({ connectionString: DSN });
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-proxy-server", "--no-sandbox"],
});

const EMAIL = "zz-newuser-walk@example.com";
let newId = null, agentId = null;

async function cleanup() {
  if (!newId) return;
  await q(`DELETE FROM agent_config WHERE actor_id IN (SELECT id FROM actor WHERE owner_actor_id = $1)`, [newId]);
  await q(`DELETE FROM actor WHERE owner_actor_id = $1`, [newId]);
  await q(`DELETE FROM account WHERE actor_id = $1`, [newId]);
  await q(`DELETE FROM activity_log WHERE actor_id = $1`, [newId]).catch(() => {});
  await q(`DELETE FROM actor_area WHERE actor_id = $1`, [newId]);
  await q(`DELETE FROM actor WHERE id = $1`, [newId]);
  console.log(`\n정리 — 계정 #${newId}${agentId ? ` · 에이전트 #${agentId}` : ""} 삭제`);
}

try {
  // ── 0. 진짜 발급 경로로 계정을 만든다 ────────────────────────
  await q(`DELETE FROM account WHERE email = $1`, [EMAIL]);   // 이전 회차 잔여물
  const lead = await browser.newContext();
  await lead.addCookies([{
    name: "tb_session",
    value: tok({ id: 1, actorId: 1, name: "권정혁", role: "lead", email: "l@l" }),
    domain: new URL(BASE).hostname, path: "/",
  }]);
  const res = await lead.request.post(`${BASE}/api/members`, {
    data: { displayName: "ZZ-신규", email: EMAIL, role: "member" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok()) throw new Error(`계정 발급 실패 ${res.status()} ${JSON.stringify(body)}`);
  const row = (await q(`SELECT actor_id FROM account WHERE email = $1`, [EMAIL]))[0];
  newId = row?.actor_id;
  agentId = (await q(`SELECT id FROM actor WHERE owner_actor_id = $1`, [newId]))[0]?.id ?? null;

  const areas = await q(`SELECT area_id FROM actor_area WHERE actor_id = $1`, [newId]);
  chk("N-발급된 계정은 영역 0개", areas.length === 0,
    `actor#${newId} · actor_area ${areas.length}행 (폼에 영역 칸이 없다)`);

  // ── 1. 그 사람으로 로그인해서 첫 화면을 잰다 ──────────────────
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{
    name: "tb_session",
    value: tok({ id: newId, actorId: newId, name: "ZZ-신규", role: "member", email: EMAIL }),
    domain: new URL(BASE).hostname, path: "/",
  }]);
  const page = await ctx.newPage();

  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e).slice(0, 120)));
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 120)); });
  page.on("requestfailed", (r) => {
    const why = r.failure()?.errorText ?? "";
    if (!/ABORTED/i.test(why)) consoleErrors.push(`요청 실패 ${r.url().slice(-50)} (${why})`);
  });

  let listReqs = [];
  // eslint-disable-next-line no-unused-vars
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/api/tasks") listReqs.push(u.search);
  });

  // 발급 직후의 **진짜 첫 화면**은 비밀번호 변경 벽이다. 그것도 재고 넘어간다 —
  // 건너뛰고 재면 "신규 사용자가 처음 보는 것"을 잘못 말하게 된다.
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  const gate = await page.$$eval("form, .pwgate, h1, h2", (ns) =>
    ns.map((n) => n.textContent.trim().slice(0, 30)).filter(Boolean).slice(0, 3));
  chk("N-발급 직후엔 비밀번호 벽", await page.$eval("body", (b) => /비밀번호/.test(b.innerText)),
    `${gate.join(" / ")} — 목록은 아직 안 보인다`);

  // 비밀번호를 바꾼 뒤에도 **아직 목록이 아니다.** 첫 실행 안내(FirstRun)가 덮는다.
  //
  // 첫 회차 측정에서 이 단계를 **놓쳤다.** DOM 만 읽어서 그 아래의 빈 상태 문구를
  // "처음 보는 것"이라고 보고했는데, 실제로 처음 보이는 것은 이 안내다.
  // 클릭을 넣자 대화상자가 클릭을 가로채면서 드러났다 —
  // **덮인 것은 없는 것이 아니다.** 세기 전에 먼저 연다는 규칙의 반대 방향이다.
  await q(`UPDATE account SET must_change_pw = false WHERE actor_id = $1`, [newId]);
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  // **사건을 기다린 뒤 센다.** 고정 대기로 재면 서버가 느린 회차에 "안 떴다"가 나온다 —
  // 실제로 그렇게 한 번 틀린 FAIL 을 냈다. 안내는 `/api/onboarding` 응답 뒤에 그려진다.
  const frn = await page.waitForSelector(".frn[role=dialog]", { timeout: 15000 }).catch(() => null);
  const frnT = frn ? await page.$eval(".frn h2", (e) => e.innerText.trim()) : "";
  chk("N-그다음은 첫 실행 안내", !!frn, frn ? `"${frnT}" — 목록은 이 뒤다` : "안내가 안 떴다");
  if (frn) {
    await page.click(".frn .frn-skip");
    await page.waitForTimeout(800);
  }

  // 여기서부터가 **일상 화면**이다. 세 단계 중 셋째.
  listReqs = [];
  await page.goto(`${BASE}/tasks`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('select[aria-label="정렬 기준"]', { timeout: 15000 });
  for (let i = 0; i < 100 && listReqs.length === 0; i++) await page.waitForTimeout(100);
  await page.waitForTimeout(800);

  // **재는 순간에 뜬다.** 아래에서 빈 상태 버튼을 누르면 요청이 더 나가므로,
  // 나중에 `listReqs` 를 보면 그 클릭까지 세게 된다 — 그건 첫 진입의 수가 아니다.
  const firstReqs = listReqs.slice();
  const rows = await page.$$eval("table tbody tr", (ns) =>
    ns.filter((n) => !n.className.includes("tt-ruler") && !n.className.includes("tt-grp")).length);
  const addr = await page.evaluate(() => location.search);
  const areaAll = await page.$$eval(".pg-filters .pg-chip", (ns) =>
    ns.some((n) => n.textContent.trim() === "전체 영역" && n.classList.contains("on")));

  console.log(`\n── 영역 0개 계정의 /tasks (비밀번호 벽 · 첫 실행 안내를 지난 뒤) ──`);
  console.log(`   첫 요청 쿼리 : ${firstReqs.map((s) => s || "(빈 쿼리)").join(" | ") || "(요청 없음)"}`);
  console.log(`   요청 횟수    : ${firstReqs.length}`);
  console.log(`   주소         : ${addr || "(없음)"}`);
  console.log(`   보이는 행 수 : ${rows}`);
  console.log(`   「전체 영역」 : ${areaAll ? "켜짐" : "꺼짐"}`);

  // 기준 — 같은 조건으로 팀 전체를 부르면 몇 건인가. 이 수보다 적으면 "가려진" 것이다.
  const all = await ctx.request.get(`${BASE}/api/tasks?assignee=${newId}`);
  const mine = (await all.json()).tasks?.length ?? 0;
  const allRes = await ctx.request.get(`${BASE}/api/tasks`);
  const allN = (await allRes.json()).tasks?.length ?? 0;
  console.log(`   참고         : 이 사람 담당 ${mine}건 · 영역 안 걸고 전체 ${allN}건`);

  // **0건일 때 무엇이 보이는가.** 빈 표만 있으면 "고장"으로 읽힌다.
  // 클래스 이름을 짐작하지 않는다. 빈 상태 컴포넌트는 둘이고 이름은 각각 이렇다 —
  //   EmptyState(전체) `.empty-state` / SectionEmpty(섹션) `.sec-empty`
  // (첫 회차에 `.es` 로 짐작해서 "빈 표만 있다"는 **틀린 관측**을 냈다. 화면은 멀쩡했다.)
  const emptyT = await page.$$eval(".empty-state, .sec-empty", (ns) =>
    ns.map((n) => n.innerText.replace(/\s+/g, " ").trim().slice(0, 90)).filter(Boolean));
  const assigneeNow = await page.$eval('select[aria-label="담당"]', (e) => e.value);
  console.log(`   담당 필터    : ${assigneeNow} (본인)`);
  console.log(`   빈 상태 문구 : ${emptyT.length ? emptyT.join(" / ") : "(없음 — 빈 표만 있다)"}`);
  chk("N-0건이면 빈 상태가 있다", emptyT.length > 0,
    emptyT.length ? emptyT[0] : "빈 표만 남는다 — 이게 첫인상이 된다");

  // ── 빈 상태 세 갈래 (§C 회신 7 · ⓓ) ──────────────────────────
  //
  // 갈래마다 **다음 행동이 다르다.** 같은 문장 하나로 때우면 어느 필터를 어떻게
  // 하라는 말인지 알 수 없다. 신규 사용자가 만나는 것은 ① 이고, ①의 버튼이
  // 「담당 = 본인」 기본값을 안 바꾸고 문제를 푸는 자리다.
  const title = () => page.$eval(".empty-state .es-title", (e) => e.innerText.trim());
  const hint = () => page.$eval(".empty-state .es-hint", (e) => e.innerText.trim()).catch(() => "");
  const acts = () => page.$$eval(".empty-state .es-action button", (ns) =>
    ns.map((n) => `${n.innerText.trim()}${n.classList.contains("primary") ? "(채움)" : ""}`));

  const t1 = await title(), h1 = await hint(), a1 = await acts();
  chk("E①-나에게 배정된 것이 없다",
    /나에게 배정된 업무가 없어요/.test(t1) && a1.some((s) => s.startsWith("전체 담당으로 보기")),
    `"${t1}" / "${h1}" / [${a1.join("] [")}]`);
  chk("E①-채움은 하나뿐",
    a1.filter((s) => s.includes("(채움)")).length === 1,
    `채움 ${a1.filter((s) => s.includes("(채움)")).length}개 — 코랄은 화면당 하나(§E1)`);

  // ①의 버튼이 실제로 넓히는가. 주소에 남는가.
  await page.click('.empty-state .es-action button:text-is("전체 담당으로 보기")');
  await page.waitForTimeout(1200);
  const wideAddr = await page.evaluate(() => location.search);
  const wideRows = await page.$$eval("table tbody tr", (ns) =>
    ns.filter((n) => !n.className.includes("tt-ruler") && !n.className.includes("tt-grp")).length);
  chk("E①-누르면 넓어지고 주소에 남는다",
    /assignee=all/.test(wideAddr) && wideRows > 1,
    `주소 "${wideAddr}" · 행 ${wideRows} (기본값은 그대로 두고 사용자가 한 번 넓힌다)`);

  // ③ — 능동 조건이 걸린 경우. 걸린 조건을 그대로 나열하고 지우는 버튼을 준다.
  await page.goto(`${BASE}/tasks?status=doing&due=overdue&assignee=all`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('select[aria-label="정렬 기준"]', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.fill('input[type="search"], input[placeholder*="검색"]', "ZZZ없는검색어").catch(() => {});
  await page.waitForTimeout(900);
  const t3 = await title(), h3 = await hint(), a3 = await acts();
  chk("E③-걸린 조건을 그대로 나열한다",
    /조건에 맞는 업무가 없어요/.test(t3) && /검색어/.test(h3) && a3.some((s) => s.startsWith("조건 지우기")),
    `"${t3}" / "${h3}" / [${a3.join("] [")}]`);

  await page.click('.empty-state .es-action button:text-is("조건 지우기")');
  await page.waitForTimeout(1500);
  const clearedRows = await page.$$eval("table tbody tr", (ns) =>
    ns.filter((n) => !n.className.includes("tt-ruler") && !n.className.includes("tt-grp")).length);
  chk("E③-조건 지우기는 전부 푼다", clearedRows > 1,
    `행 ${clearedRows} — 하나만 풀면 또 0건일 수 있다`);

  // ② — 좁힌 것이 하나도 없는데 0건. **데이터를 비워서 재고 되돌린다.**
  const hidden = await q(`UPDATE task SET is_active = false WHERE is_active = true RETURNING id`);
  try {
    await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('select[aria-label="정렬 기준"]', { timeout: 15000 });
    await page.waitForTimeout(1500);
    const t2 = await title(), h2 = await hint(), a2 = await acts();
    chk("E②-진짜 비었을 때만 「없어요」",
      /^아직 업무가 없어요/.test(t2) && /첫 업무/.test(h2)
        && !a2.some((s) => /전체 담당|조건 지우기/.test(s)),
      `"${t2}" / "${h2}" / [${a2.join("] [")}] — 넓힐 것이 없으니 넓히는 버튼도 없다`);
  } finally {
    await q(`UPDATE task SET is_active = true WHERE id = ANY($1::int[])`, [hidden.map((r) => r.id)]);
    console.log(`   (되돌림 — 업무 ${hidden.length}건 다시 활성)`);
  }

  chk("N-요청은 한 번", firstReqs.length === 1, `${firstReqs.length}회`);
  chk("N-영역으로 좁히지 않는다", !/area=/.test(firstReqs[0] ?? ""),
    `쿼리 "${firstReqs[0] ?? ""}" — 소속이 없다는 것은 "볼 것이 없다"가 아니라 "아직 안 정했다"다`);
  chk("N-「전체 영역」이 켜져 있다", areaAll, areaAll ? "켜짐" : "꺼짐 — 어느 칩도 안 켜진 상태다");

  // ── 2. 홈 ────────────────────────────────────────────────
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".judge", { timeout: 15000 });
  await page.waitForTimeout(600);
  const tiles = await page.$$eval(".jt", (ns) => ns.map((n) => `${n.querySelector(".jt-l")?.textContent} ${n.querySelector(".jt-n")?.textContent}`));
  const hmRows = await page.$$eval("table tbody tr", (ns) =>
    ns.filter((n) => !n.className.includes("tt-ruler") && !n.className.includes("tt-grp")).length);
  const empty = await page.$$eval(".sec-empty, .empty", (ns) => ns.map((n) => n.textContent.trim().slice(0, 40)));
  console.log(`\n── 홈 ──`);
  console.log(`   판단 타일   : ${tiles.join(" · ")}`);
  console.log(`   목록 행 수  : ${hmRows}`);
  console.log(`   빈 상태 문구: ${empty.length ? empty.join(" / ") : "(없음)"}`);

  chk("N-홈은 영역과 무관하다", true, "홈은 담당·가시성으로만 고른다 — 영역 필터가 없다");
  chk("콘솔 오류 0건", consoleErrors.length === 0,
    consoleErrors.length ? consoleErrors.slice(0, 3).join(" / ") : "관측 도구가 성했다");
} finally {
  await cleanup().catch((e) => console.error("정리 실패:", e.message));
  await browser.close();
  await pool.end();
}

console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
