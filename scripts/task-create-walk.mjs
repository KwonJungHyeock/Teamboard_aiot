// 업무 등록 모달 · 프로젝트 연결 실측 (MD-P-2026-027 §C · §D).
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

requireLocalDb("task-create-walk.mjs");

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
  await ctx.addCookies([{ name: "tb_session", value: tok({ id:1, actorId:1, name:"권정혁", role:"lead", email:"l@l" }),
    domain: new URL(BASE).hostname, path: "/" }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  const shot = (id) => page.screenshot({ path: `${OUT}/${id}.png` });
  const box = (sel) => page.locator(sel).first().boundingBox();

  const areaId = (await sql(`SELECT id FROM area WHERE is_active ORDER BY sort_order LIMIT 1`))[0].id;

  // ══ §C3 목록 맨 위 한 줄 입력 ═══════════════════════════════════════
  await page.goto(`${BASE}/tasks?assignee=all`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  await page.locator(".frn-skip").first().click().catch(() => {});   // 첫 사용 안내가 떠 있으면 닫는다

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
  chk("C1-속성", props.join(" · ") === "공개 범위 · 프로젝트 · 목표 · 담당 · 상태 · 우선순위 · 기한 · 영역",
    `속성 순서 "${props.join(" · ")}"`);

  const foot = await page.locator(".ntm-foot").innerText();
  const corals = await page.locator(".ntm .btn-primary").count();
  chk("C1-하단", /취소/.test(foot) && /만들고 계속 추가/.test(foot) && /만들기/.test(foot) && corals === 1,
    `하단 "${foot.replace(/\n+/g, " · ")}" · 코랄 ${corals}개 (1이어야 한다)`);

  // ══ §D1 프로젝트 검색형 콤보박스 ═════════════════════════════════════
  await page.locator('.ntm-side .prop-row:has(.prop-l:text-is("프로젝트")) .pcb-v').click();
  await page.waitForTimeout(300);
  const allOpts = await page.locator(".pcb-list .pcb-o").allTextContents();
  await page.locator(".pcb-q").fill("플랫");
  await page.waitForTimeout(250);
  const narrowed = await page.locator(".pcb-list .pcb-o").allTextContents();
  await shot("D1-filter");
  chk("D1-검색", narrowed.length < allOpts.length,
    `전체 ${allOpts.length}줄 → "플랫" 입력 후 ${narrowed.length}줄 [${narrowed.join(", ")}]`);

  await page.locator(".pcb-q").fill(PJ);
  await page.waitForTimeout(250);
  const createRow = await page.locator(".pcb-new").innerText().catch(() => "");
  chk("D1-만들기줄", createRow.includes(PJ), `일치 0건일 때 맨 아래 "${createRow}"`);

  await page.locator(".pcb-new").click();
  // 고정 대기(1400ms)를 쓰면 안 된다. dev 서버가 /api/projects 를 처음 컴파일하는 회차에는
  // 이 POST 가 2.1초 걸렸고(따뜻할 때는 36ms), 그 회차마다 이 검사가 통째로 무너졌다.
  // **끝났는지를 보고 기다린다** — 시간이 아니라 조건이다.
  const pickedCell = page.locator('.ntm-side .prop-row:has(.prop-l:text-is("프로젝트")) .pcb-v');
  await pickedCell.filter({ hasText: PJ }).waitFor({ timeout: 15000 }).catch(() => {});
  const picked = await pickedCell.innerText();
  const pjRow = await sql(`SELECT id, area_id FROM project WHERE name=$1 AND is_active`, [PJ]);
  await shot("D1-created");
  chk("D1-생성", pjRow.length === 1 && picked.includes(PJ),
    `그 자리에서 만들고 바로 선택됨 — 값 "${picked}" · project ${pjRow.length}건 · area_id ${pjRow[0]?.area_id ?? "없음"}`);

  // ══ §C2 조작 — ⌘Enter 저장 · 만들고 계속 추가 ════════════════════════
  await page.locator(".ntm-keep input").check();
  await page.keyboard.press("Meta+Enter");
  await page.waitForTimeout(1600);
  const stillOpen = await page.locator(".ntm").count();
  const titleAfter = await page.locator(".ntm-title").inputValue().catch(() => "!!닫힘");
  const keptProject = await page.locator('.ntm-side .prop-row:has(.prop-l:text-is("프로젝트")) .pcb-v').innerText().catch(() => "");
  const madeBadge = await page.locator(".ntm-made").innerText().catch(() => "");
  await shot("C2-keep");
  chk("C2-계속추가", stillOpen === 1 && titleAfter === "" && keptProject.includes(PJ),
    `⌘Enter 저장 후 모달 유지 · 제목 "${titleAfter}"(비어야 함) · 프로젝트 "${keptProject}"(유지돼야 함) · 배지 "${madeBadge}"`);

  const savedT2 = (await sql(`SELECT project_id FROM task WHERE title=$1 AND is_active`, [t2]));
  chk("C2-저장값", savedT2.length === 1 && savedT2[0].project_id === pjRow[0]?.id,
    `저장된 업무의 project_id ${savedT2[0]?.project_id ?? "없음"} (새 프로젝트 ${pjRow[0]?.id} 이어야 한다)`);

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
