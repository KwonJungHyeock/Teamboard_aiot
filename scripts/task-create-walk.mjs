// 업무 등록 모달 · 프로젝트 연결 실측 (MD-P-2026-027 §C · §D).
//
// ══ 061 §C 에서 **지운 검사와 그 이유** ═══════════════════════════════
//
// 027 §B 가 프로젝트 콤보박스를 버튼 줄로 바꾸면서 두 기능이 없어졌고, 그것을
// 재던 검사 둘을 지웠다. 조용히 지우면 무엇이 덮이지 않게 됐는지 아무도 모른다.
//
//   · **D1-만들기줄** — 「일치하는 프로젝트가 0건일 때 목록 맨 아래 『"이름"
//     만들기』 줄이 뜬다」. 지금 화면에는 그 줄이 없다.
//   · **D1-생성** — 「그 줄을 누르면 프로젝트가 만들어지고 바로 선택된다」.
//     위 줄이 없으니 누를 것이 없다. 「고르면 선택된다」 부분은 §C2 가 잰다.
//
//   ▸ **언제 다시 필요해지는가** — 모달 안에서 프로젝트를 새로 만드는 길이
//     생기면 그때 되살린다. 백로그 「모달에서 프로젝트 새로 만들기」에 올려 뒀다
//     (docs/BACKLOG.md). 그때는 061 §A-1 때문에 **만든 프로젝트의 영역이 지금
//     고른 영역과 같아야** 한다는 조건이 하나 더 붙는다.
//
//   ▸ D1-검색 은 안 지웠다. 지키려던 것이 검색이 아니라 「고를 수 있는 것이 다
//     보인다」였고, 그건 버튼 줄에서도 물을 수 있다 — 아래 D1 참고.
//
// 화면을 실제로 밟는다. 규격 숫자(720×560·220px)는 코드가 아니라 **렌더된 박스**에서 읽는다.
// 라벨에는 화면에서 읽은 값을 적는다 (§G 캡처 라벨 규격).
// 만든 것은 끝나고 지운다 — 실측 흔적을 데이터에 남기지 않는다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32) — 아래 requireLocalDb 가 강제한다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot as snap } from "./shot.mjs";   // 캡처는 SHOT=1 일 때만 (057 §0)
import { testUser } from "./test-user.mjs";
// 이 검사기에는 제 `shot` 이 이미 있다. 모듈 쪽은 `snap` 으로 받는다 —
// 같은 이름으로 받으면 제 함수가 저를 부르거나(무한) 선언이 겹친다.

requireLocalDb("task-create-walk.mjs");

/* 065 §B-9 — 검사가 쓰는 신분은 손으로 안 적는다. DB 에서 읽는다. */
const TEST_ME = await testUser();

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-027/task-create";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S || !DSN) { console.error("AUTH_SECRET / DATABASE_URL 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

const MARK = "[실측]";                       // 만든 것을 되찾기 위한 표식
const PJ = `${MARK} 콤보 신규 프로젝트`;
fs.mkdirSync(OUT, { recursive: true });

const rows = [];
const ok = (id, note) => { rows.push({ id, pass: true, note }); console.log(`OK   ${id.padEnd(20)} ${note}`); };
const bad = (id, note) => { rows.push({ id, pass: false, note }); console.log(`FAIL ${id.padEnd(20)} ${note}`); };
const chk = (id, cond, note) => (cond ? ok(id, note) : bad(id, note));

let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", value: tok(TEST_ME),
    domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // 059 §G — 경고까지 센다. 「오류」만 세면 하이드레이션 문제를 못 본다.
  page.on("console", (m) => { const t = m.type();
    if (t === "error" || t === "warning") errs.push(`[${t}] ` + m.text().slice(0, 160)); });
  const shot = (id) => snap(page, { path: `${OUT}/${id}.png` });
  const box = (sel) => page.locator(sel).first().boundingBox();

  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order LIMIT 1`))[0].id;

  // ══ §C3 목록 맨 위 한 줄 입력 ═══════════════════════════════════════
  await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.locator(".frn-skip").first().click({ timeout: 3000 })
    // 안내는 계정에 따라 안 뜬다(`account.onboarded_at`). 실패해도 되지만
    // **조용히 넘어가지는 않는다** — 빈 catch 는 없는 실패를 만든다(§G).
    .catch(() => console.log("   (첫 실행 안내 없음 — 닫을 것이 없다)"));   // 첫 사용 안내가 떠 있으면 닫는다

  const itiBox = await box(".iti");
  const itiPh = await page.locator(".iti-q").first().getAttribute("placeholder");
  chk("C3-존재", !!itiBox, `목록 상단 한 줄 입력 — 높이 ${itiBox ? Math.round(itiBox.height) : "없음"}px · 안내문 "${itiPh ?? ""}"`);

  // Enter = 제목만으로 즉시 생성
  const t1 = `${MARK} Enter 로 만든 업무`;
  await page.locator(".iti-q").first().fill(t1);
  await page.locator(".iti-q").first().press("Enter");
  await page.waitForTimeout(1400);
  const made1 = (await sql(`SELECT count(*)::int n FROM task WHERE title=$1 AND is_active`, [t1]))[0].n;
  const cleared = await page.locator(".iti-q").first().inputValue();
  await shot("C3-enter");
  chk("C3-Enter", made1 === 1 && cleared === "", `Enter → task ${made1}건 생성 · 입력칸 "${cleared}" (비어야 한다)`);

  // ⌘Enter = 친 내용을 그대로 들고 모달로 확장
  const t2 = `${MARK} 모달로 확장한 업무`;
  await page.locator(".iti-q").first().fill(t2);
  await page.locator(".iti-q").first().press("Meta+Enter");
  await page.waitForTimeout(700);
  const carried = await page.locator(".ntm-title").inputValue().catch(() => "");
  chk("C3-확장", carried === t2, `⌘Enter → 모달 제목 "${carried}" (친 내용 "${t2}" 이어야 한다)`);

  // ══ §C1 형태 ════════════════════════════════════════════════════════
  /*
   * 060 §C — **「고급」을 열고 나서 잰다.**
   *
   * 027 §B 부터 고급(`.ntm-side`)은 언제나 닫힌 채로 시작한다. 이 검사기는 그
   * 열이 처음부터 있다고 보고 30초를 기다리다 죽었다 — 027 이후로 줄곧
   * 그랬다. 화면이 아니라 검사기가 옛 화면을 묻고 있었다.
   *
   * 아래 C1-우측열·C1-속성 과 D1 의 프로젝트 콤보가 전부 그 열 안에 있으므로,
   * **사람이 하는 대로** 「고급」을 누르고 나서 잰다.
   */
  const adv = page.locator(".ntm-adv");
  await adv.waitFor({ timeout: 5000 });
  if ((await adv.getAttribute("aria-expanded")) !== "true") await adv.click();
  await page.locator(".ntm-side").waitFor({ timeout: 5000 });

  const m = await box(".ntm");
  const side = await box(".ntm-side");
  const titleFs = await page.locator(".ntm-title").evaluate((el) => getComputedStyle(el).fontSize);
  const scrim = await page.locator(".ntm-bg").evaluate((el) => getComputedStyle(el).backgroundColor);
  const props = await page.locator(".ntm-side .prop-l").allTextContents();
  await shot("C1-modal");
  chk("C1-치수", m && Math.round(m.width) === 720 && Math.round(m.height) === 560,
    `모달 ${m ? `${Math.round(m.width)}×${Math.round(m.height)}` : "없음"} (720×560 이어야 한다) · 스크림 ${scrim}`);
  chk("C1-우측열", side && Math.round(side.width) === 220,
    `오른쪽 속성 열 ${side ? Math.round(side.width) : "없음"}px (220 이어야 한다) · 제목 ${titleFs}`);
  /*
   * 060 §C — **프로젝트와 기간은 옆 열에서 본문으로 옮겨졌다** (027 §B).
   * 「언제까지인지는 나중에 채우는 값이 아니라 적을 때 아는 값이다」가 이유다.
   * 옛 목록 여덟을 그대로 요구하면 **옮긴 것을 사라진 것으로** 읽는다.
   *
   * 그래서 두 가지를 같이 묻는다 — 옆 열에 남은 여섯이 그 차례대로인가,
   * 그리고 **옮겨 간 둘이 본문에 있는가.** 뒤엣것을 안 물으면 「옆 열에서
   * 지워 버렸다」도 통과한다.
   */
  const inBody = await page.locator(".ntm-main .ntm-fl").allTextContents();
  const moved = ["프로젝트", "기간"];
  chk("C1-속성", props.join(" · ") === "공개 범위 · 목표 · 담당 · 상태 · 우선순위 · 영역"
      && moved.every((k) => inBody.some((t) => t.trim() === k)),
    `옆 열 "${props.join(" · ")}" · 본문 [${inBody.map((t) => t.trim()).join(" · ")}]` +
    ` — 옮겨 간 둘(${moved.join("·")})이 본문에 ${moved.every((k) => inBody.some((t) => t.trim() === k)) ? "있다" : "없다"}`);

  const foot = await page.locator(".ntm-foot").innerText();
  const corals = await page.locator(".ntm .btn-primary").count();
  chk("C1-하단", /취소/.test(foot) && /만들고 계속 추가/.test(foot) && /만들기/.test(foot) && corals === 1,
    `하단 "${foot.replace(/\n+/g, " · ")}" · 코랄 ${corals}개 (1이어야 한다)`);

  /* ══ §D1 프로젝트 고르개 (061 §C) ═══════════════════════════════
   *
   * 027 §B 가 검색형 콤보박스를 **버튼 줄**로 바꿨다. 셋을 하나씩 판단했다:
   *
   *  ① 「검색해서 고르기」 → **다시 쓴다.** 이 검사가 지키려던 것은 검색 자체가
   *     아니라 **「고를 수 있는 프로젝트가 사람 눈에 다 보인다」**였다. 콤보박스
   *     시절엔 목록을 열고 좁혀야 보였으니 검색으로 쟀을 뿐이다. 버튼 줄에서는
   *     한눈에 보이므로, **DB 와 개수를 맞춰** 같은 것을 묻는다.
   *     061 §A-1 로 기준이 「전체」가 아니라 **「그 영역」**이 됐다.
   *
   *  ② 「그 자리에서 만들기」 → **지웠다.** 아직 없는 기능이다. 지운 줄은
   *     이 파일 맨 위 주석에 남겼고, 백로그에 올렸다(docs/BACKLOG.md).
   *
   *  ③ 「만들고 바로 선택됨」 → **②와 같은 쪽.** ②가 만든 프로젝트를 확인하던
   *     검사라 ②가 없으면 잴 대상 자체가 없다. ①처럼 「지키려던 것」을 옮겨
   *     적을 수도 없다 — 지키려던 것이 「만들기의 결과」이고 그 만들기가 없다.
   *     그래서 지웠다. 「고르면 선택된다」는 §C2 가 이미 잰다.
   */
  const areaOf = async () =>
    (await page.locator('.ntm-side .prop-row:has(.prop-l:text-is("영역")) .prop-v').innerText()).trim();
  const curArea = await areaOf();
  const areaRow = (await sql(`SELECT id FROM area WHERE is_active AND name = $1`, [curArea]))[0];
  const dbInArea = (await sql(
    `SELECT count(*)::int n FROM project WHERE is_active AND area_id = $1`, [areaRow?.id ?? -1]))[0].n;
  const seenBtns = await page.locator(".ntm-main .pp .pp-b").allInnerTexts();
  const emptyNote = await page.locator(".ntm-main .pp-off").innerText().catch(() => null);
  chk("D1-그-영역-프로젝트가-다-보인다",
      areaRow !== undefined && seenBtns.length === dbInArea
      && (dbInArea === 0) === (emptyNote !== null),
      `영역 "${curArea}" — 버튼 ${seenBtns.length}개 [${seenBtns.join(" | ")}] · ` +
      `DB 그 영역 프로젝트 ${dbInArea}개 · 빈 안내 ${emptyNote ? `"${emptyNote}"` : "없음"} ` +
      `(061 §A-1 로 기준이 「전체」가 아니라 「그 영역」이다)`);

  // ══ §C2 조작 — ⌘Enter 저장 · 만들고 계속 추가 ════════════════════════
  /*
   * 060 §C — **C2 의 조건을 여기서 만든다.**
   *
   * C2 가 묻는 것은 「저장해도 프로젝트가 유지되는가」다. 그러려면 프로젝트가
   * 하나 **골라져 있어야** 하는데, 예전에는 D1 이 콤보박스에서 하나 만들어
   * 끼워 주는 바람에 C2 가 그 곁다리로 조건을 얻고 있었다. D1 이 재던 UI 가
   * 없어지자 C2 도 같이 죽었다 — 남의 조건에 얹혀 있었기 때문이다.
   *
   * 이제 C2 가 **제 조건을 제가 만든다**(§G 035). 버튼 줄에서 하나 고른다.
   */
  const pjBtn = page.locator(".ntm-main .pp .pp-b").first();
  /*
   * **이미 눌려 있으면 누르지 않는다.** 버튼은 토글이라(「누른 것을 다시 누르면
   * 벗는다」) 눌린 것을 또 누르면 선택이 풀린다.
   *
   * 061 §A-1 전에는 버튼 줄이 전체 프로젝트였고 첫 버튼이 기본값이 아니었다.
   * 이제 그 영역의 것만 남아서 **첫 버튼이 곧 기본값**(1순위 영역의 상시)인
   * 경우가 생겼고, 그대로 누르니 벗겨졌다. 화면이 아니라 이 조건이 틀렸다.
   */
  if ((await pjBtn.getAttribute("aria-pressed")) !== "true") await pjBtn.click();
  const pjName = (await pjBtn.innerText()).trim();
  const pjPicked = await sql(`SELECT id FROM project WHERE name = $1 AND is_active`, [pjName]);

  await page.locator(".ntm-keep input").check();
  await page.keyboard.press("Meta+Enter");
  await page.waitForTimeout(1600);
  const stillOpen = await page.locator(".ntm").count();
  const titleAfter = await page.locator(".ntm-title").inputValue().catch(() => "!!닫힘");
  // 골라진 버튼은 `aria-pressed="true"` 다 — 옛 콤보의 글자칸이 아니다.
  const keptProject = await page.locator('.ntm-main .pp .pp-b[aria-pressed="true"]')
    .innerText().catch(() => "");
  const madeBadge = await page.locator(".ntm-made").innerText().catch(() => "");
  await shot("C2-keep");
  chk("C2-계속추가", stillOpen === 1 && titleAfter === "" && keptProject.trim() === pjName,
    `⌘Enter 저장 후 모달 유지 · 제목 "${titleAfter}"(비어야 함) · ` +
    `프로젝트 "${keptProject.trim()}"(고른 "${pjName}" 이 유지돼야 함) · 배지 "${madeBadge}"`);

  const savedT2 = (await sql(`SELECT project_id FROM task WHERE title=$1 AND is_active`, [t2]));
  chk("C2-저장값", savedT2.length === 1 && savedT2[0].project_id === (pjPicked[0]?.id ?? null),
    `저장된 업무의 project_id ${savedT2[0]?.project_id ?? "없음"} (고른 "${pjName}" = ${pjPicked[0]?.id ?? "없음"} 이어야 한다)`);

  // Esc — 내용이 없으면 바로 닫힌다
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  chk("C2-Esc", (await page.locator(".ntm").count()) === 0, `Esc → 모달 ${await page.locator(".ntm").count()}개 (0이어야 한다)`);

  // ══ §C4 상세 패널은 만들지 않는다 ═══════════════════════════════════
  await page.goto(`${BASE}/tasks?panel=task:new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1100);
  const modalOnUrl = await page.locator(".ntm").count();
  const panelOnUrl = await page.locator(".tdp").count();
  await shot("C4-url");
  chk("C4-분리", modalOnUrl === 1 && panelOnUrl === 0,
    `?panel=task:new → 모달 ${modalOnUrl}개 · 상세 패널 ${panelOnUrl}개 (1 / 0 이어야 한다)`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ══ §D3 다중 선택 → 프로젝트 일괄 지정 ═══════════════════════════════
  //
  // **실측용 업무를 직접 만들어서 고른다.** 처음엔 목록의 앞 두 줄을 그냥 체크했는데,
  // 그건 진짜 업무였고 일괄 지정이 그 둘의 프로젝트를 실제로 바꿔 버렸다.
  // 검사 스크립트는 자기가 만든 것만 건드린다.
  await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  for (const n of ["가", "나"]) {
    await page.locator(".iti-q").first().fill(`${MARK} 일괄 대상 ${n}`);
    await page.locator(".iti-q").first().press("Enter");
    await page.waitForTimeout(1300);
  }
  /*
   * ── 실측 프로젝트를 **직접 만든다** ──────────────────────────────
   *
   * 061 §C-11 에서 D1-생성(모달 안에서 프로젝트를 만드는 길)을 지웠다. 그
   * 검사가 곁다리로 만들어 주던 프로젝트에 §D3·§D2·§D4 가 얹혀 있었고,
   * 지우고 나서 셋이 `pjRow` 를 못 찾아 죽었다 — C2 가 D1 에 얹혀 있던 것과
   * 똑같은 모양이다(§G 035). 이제 제 조건을 제가 만든다.
   *
   * 화면이 아니라 DB 에 넣는다. 저 셋이 재는 것은 「프로젝트를 만드는 길」이
   * 아니라 「있는 프로젝트에 업무가 붙는가」라서, 만드는 방법은 무엇이든 된다.
   *
   * **영역은 방금 만든 업무에서 가져온다.** 아무 영역에나 만들면
   * `trg_task_area_match` 가 일괄 지정을 막는다 — 061 §A 가 고친 바로 그
   * 제약이다. 기준값을 손으로 적는 대신 붙일 업무 쪽에서 읽는다.
   */
  const bulkTargets = await sql(
    `SELECT id, area_id FROM task WHERE title LIKE $1 AND is_active ORDER BY id`, [`${MARK} 일괄 대상%`]);
  if (bulkTargets.length === 0) throw new Error("일괄 대상 업무가 안 만들어졌다 — 뒤 단계를 잴 수 없다");
  const pjRow = await sql(
    `INSERT INTO project (name, area_id) VALUES ($1, $2) RETURNING id`,
    [PJ, bulkTargets[0].area_id]);
  // 화면은 프로젝트 목록을 이미 받아 왔다. 새로 고치지 않으면 일괄 지정 콤보에
  // 방금 만든 것이 안 뜬다 — 「없다」가 아니라 「아직 안 봤다」다.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // 검색으로 실측 업무만 남긴다 — 전체 선택이 남의 업무를 집지 않게.
  await page.locator(".tsearch").fill(MARK);
  await page.waitForTimeout(700);
  const visible = await page.locator("table tbody tr").count();
  await page.locator("table .col-chk input").first().check();   // 헤더 = 보이는 행 전체
  await page.waitForTimeout(400);
  const bulkText = await page.locator(".utp-bulk").innerText().catch(() => "");
  const headerCoral = await page.locator(".pg-act .btn-primary").count();
  await shot("D3-selected");
  chk("D3-일괄줄", /선택/.test(bulkText) && headerCoral === 0 && visible >= 2,
    `검색으로 실측 ${visible}건만 남기고 전체 선택 → "${bulkText.replace(/\n+/g, " · ")}" · 헤더 코랄 ${headerCoral}개 (0이어야 한다 — 화면당 1개)`);

  await page.locator(".utp-bulk .pcb-v").click();
  await page.waitForTimeout(300);
  await page.locator(".pcb-q").fill(PJ);
  await page.waitForTimeout(300);
  // 첫 줄은 항상 "연결 없음"이다. 이름으로 골라야 한다 —
  // .first() 로 집으면 해제를 지정으로 착각하고 통과시킬 뻔했다.
  await page.locator(".pcb-list .pcb-o", { hasText: PJ }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "선택 업무에 지정" }).click();
  await page.waitForTimeout(2200);
  const assigned = (await sql(
    `SELECT count(*)::int n FROM task WHERE project_id=$1 AND is_active AND title LIKE $2`,
    [pjRow[0]?.id, `${MARK}%`]))[0].n;
  await shot("D3-assigned");
  chk("D3-지정", assigned === visible,
    `일괄 지정 후 이 프로젝트의 실측 업무 ${assigned}건 (선택한 ${visible}건과 같아야 한다)`);

  // ══ §D2 프로젝트 상세 맨 아래 한 줄 입력 ═════════════════════════════
  // 앞 단계가 실패했으면 여기서 TypeError 로 죽지 말고 **왜 못 했는지**를 남긴다.
  if (pjRow.length === 0) {
    bad("D2-건너뜀", "D1 에서 프로젝트가 안 만들어져 §D2·§D4 를 실행하지 못했다");
    throw new Error("D1 실패 — 이후 단계 중단");
  }
  await page.goto(`${BASE}/projects/${pjRow[0].id}?tab=tasks`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1300);
  const tableBox = await box("table");
  const underBox = await box(".iti.under");
  const t3 = `${MARK} 프로젝트 상세에서 만든 업무`;
  await page.locator(".iti.under .iti-q").fill(t3);
  await page.locator(".iti.under .iti-q").press("Enter");
  await page.waitForTimeout(1600);
  const made3 = await sql(`SELECT project_id FROM task WHERE title=$1 AND is_active`, [t3]);
  await shot("D2-inline");
  chk("D2-위치", underBox && tableBox && underBox.y > tableBox.y,
    `입력 줄이 표 아래 — 표 y=${tableBox ? Math.round(tableBox.y) : "?"} · 입력 y=${underBox ? Math.round(underBox.y) : "없음"}`);
  chk("D2-자동지정", made3.length === 1 && made3[0].project_id === pjRow[0].id,
    `여기서 만든 업무의 project_id ${made3[0]?.project_id ?? "없음"} (${pjRow[0].id} 이어야 한다 — 연결 행위 없음)`);

  // ══ §D4 상세 속성 블록에서 그 자리 변경 ══════════════════════════════
  const target = made3[0] ? (await sql(`SELECT id FROM task WHERE title=$1`, [t3]))[0].id : null;
  await page.goto(`${BASE}/tasks?panel=task:${target}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator('.tdp .prop-row:has(.prop-l:text-is("프로젝트")) .prop-v').click();
  await page.waitForTimeout(400);
  const comboInPanel = await page.locator(".tdp .pcb").count();
  await page.locator(".tdp .pcb-v").click();
  await page.waitForTimeout(300);
  await page.locator(".tdp .pcb-list .pcb-o").first().click();   // "연결 없음"
  await page.waitForTimeout(1600);
  const after = (await sql(`SELECT project_id FROM task WHERE id=$1`, [target]))[0];
  await shot("D4-inline");
  chk("D4-콤보", comboInPanel === 1, `상세 속성 블록의 프로젝트 편집기가 콤보박스 ${comboInPanel}개 (셀렉트 아님)`);
  chk("D4-변경", after.project_id === null, `그 자리에서 "연결 없음" 선택 → project_id ${after.project_id ?? "null"}`);

  console.log(`\nJS 오류 ${errs.length}건${errs.length ? " — " + errs[0] : ""}`);
  const pass = rows.filter((r) => r.pass).length;
  console.log(`합계 ${rows.length} · 통과 ${pass} · 실패 ${rows.length - pass}`);
  fs.writeFileSync(`${OUT}/walk.json`, JSON.stringify({ rows, errs }, null, 2));
} finally {
  // 정리 — 실측으로 만든 업무·프로젝트만 지운다. 표식이 붙은 것만 고른다.
  const t = await sql(`SELECT id FROM task WHERE title LIKE $1`, [`${MARK}%`]);
  if (t.length) {
    await sql(`DELETE FROM goal_task WHERE task_id = ANY($1::int[])`, [t.map((x) => x.id)]);
    await sql(`DELETE FROM activity_log WHERE task_id = ANY($1::int[])`, [t.map((x) => x.id)]);
    await sql(`DELETE FROM task WHERE id = ANY($1::int[])`, [t.map((x) => x.id)]);
  }
  const p = await sql(`SELECT id FROM project WHERE name LIKE $1`, [`${MARK}%`]);
  if (p.length) {
    // 실측 프로젝트를 아직 가리키는 업무가 남아 있으면 그건 **남의 업무**다.
    // 조용히 NULL 로 밀지 않는다 — 무엇을 건드렸는지 이름으로 찍고 되돌린다.
    const stray = await sql(
      `SELECT id, title FROM task WHERE project_id = ANY($1::int[]) AND title NOT LIKE $2`,
      [p.map((x) => x.id), `${MARK}%`]);
    if (stray.length) {
      console.log(`⚠ 실측이 아닌 업무 ${stray.length}건이 실측 프로젝트를 가리킨다 — ${stray.map((x) => `#${x.id} ${x.title}`).join(", ")}`);
      await sql(`UPDATE task SET project_id = NULL WHERE id = ANY($1::int[])`, [stray.map((x) => x.id)]);
    }
    await sql(`DELETE FROM project WHERE id = ANY($1::int[])`, [p.map((x) => x.id)]);
  }
  await sql(`DELETE FROM activity_log WHERE message LIKE $1`, [`%${MARK}%`]);
  console.log(`정리 — 업무 ${t.length}건 · 프로젝트 ${p.length}건 삭제`);
  await browser?.close();
  await pool.end();
}
