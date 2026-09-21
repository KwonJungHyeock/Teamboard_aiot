// 서비스 이름 실측 (MD-P-2026-057 §A).
//
// **로컬 전용** (지시 32). 스위치를 시작 전으로 되돌린다.
//
// ── 무엇을 보는가 ────────────────────────────────────────────────
//
//   ① 두 이름이 **lib 상수 한 곳**에서 나온다 — 화면에 하드코딩된 문자열 0건
//   ② 「미션덱 / Mission Deck / MISSION DECK」이 **사람이 읽는 자리에 0건**
//   ③ 식별자 둘(`MissionDeck/1.0` · `createdByMissionDeck`)은 **그대로 있다**
//   ④ 긴 이름이 로고 자리 넷에 다 들어갔다
//   ⑤ 긴 이름이 **안 잘린다** — 요소 폭 안에 글자가 다 들어간다 (값으로 잰다)
//   ⑥ 짧은 이름 자리에서 **긴 이름이 안 나온다**
//   ⑦ 390px 에서도 로고가 안 깨진다 — 안 잘리고, 아래 것을 안 밀어낸다
//   ⑧ 콘솔 오류 0
//
// ── ⑤ 를 왜 값으로 재는가 ───────────────────────────────────────
// 「보인다」와 「들어갔다」는 다르다. `text-overflow: ellipsis` 나 `overflow:
// hidden` 이 걸려 있으면 화면에는 말끔한데 끝이 잘려 있다. `scrollWidth` 가
// `clientWidth` 보다 크면 잘린 것이다 — 눈이 아니라 이 값으로 묻는다.
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { createRequire } from "node:module";
import { mkdirSync, rmSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";   // 캡처는 SHOT=1 일 때만 (057 §0)

requireLocalDb("brand-name-walk.mjs");

const REPO = process.cwd();
const TMP = path.join(REPO, ".bn-out");
const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/MD-P-2026-057";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
/** 세 표기 모두. 대문자·띄어쓰기·한글이 다 섞여 있었다. */
const OLD = /미션덱|mission\s*deck/i;

/** 잘렸는가 — 눈이 아니라 값으로. 1px 은 소수점 반올림이라 봐준다. */
const CLIPPED = `(el) => el.scrollWidth > el.clientWidth + 1`;

let browser, swBefore = null;
try {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "brand.ts"),
     "--outDir", TMP, "--rootDir", path.join(REPO, "lib"), "--module", "commonjs",
     "--moduleResolution", "node", "--target", "es2022", "--skipLibCheck", "--esModuleInterop"],
    { stdio: "inherit" });
  const req = createRequire(path.join(TMP, "noop.cjs"));
  // **제품의 상수를 그대로 부른다.** 검사기가 이름을 옮겨 적으면 둘이 갈릴 때
  // 검사기가 틀린 쪽을 정답으로 삼는다 (§G 048).
  const { APP_NAME, APP_NAME_LONG, ORG_NAME, TEAM_NAME } = req(path.join(TMP, "brand.js"));

  /*
   * ── ① 이름이 한 곳에서만 나온다 ───────────────────────────────
   *
   * 화면 파일에 이름이 **문자열로** 적혀 있으면 다음에 또 바뀔 때 한 군데를
   * 빠뜨린다. 리포를 훑어 `lib/brand.ts` 밖에 적힌 곳이 있는지 센다.
   */
  const SRC = execFileSync("git", ["ls-files", "app", "components", "lib"], { encoding: "utf-8" })
    .split("\n").filter((f) => /\.(ts|tsx)$/.test(f) && f !== "lib/brand.ts");
  const hard = [];
  for (const f of SRC) {
    readFileSync(path.join(REPO, f), "utf-8").split("\n").forEach((line, i) => {
      if (line.includes(APP_NAME_LONG) || line.includes(APP_NAME)) hard.push(`${f}:${i + 1}`);
    });
  }
  chk("①-이름이-lib-한-곳에서만", hard.length === 0,
      `lib/brand.ts 밖에 적힌 자리 ${hard.length}건${hard.length ? ` [${hard.join(" · ")}]` : ""}` +
      ` · 훑은 파일 ${SRC.length}개`);

  /*
   * ── ②③ 옛 이름과 식별자 ──────────────────────────────────────
   *
   * ② 는 「사람이 읽는 자리」만 본다 — 주석과 docs/ 는 그때 그 이름이 맞다(§A-3).
   * ③ 은 그 반대다. 식별자 둘은 **있어야** 한다. ② 만 두면 「싹 지웠다」도
   * 통과하므로, 지우면 안 되는 것이 남아 있는지 짝으로 묻는다.
   */
  const CODE_LINE = /^\s*(\/\/|\*|\/\*)/;
  const left = [];
  for (const f of SRC) {
    readFileSync(path.join(REPO, f), "utf-8").split("\n").forEach((line, i) => {
      if (CODE_LINE.test(line) || !OLD.test(line)) return;
      if (/MissionDeck\/1\.0|createdByMissionDeck/.test(line)) return;   // ③ 이 지킨다
      left.push(`${f}:${i + 1}`);
    });
  }
  chk("②-옛-이름이-코드에-0건", left.length === 0,
      `사람이 읽는 자리에 남은 것 ${left.length}건${left.length ? ` [${left.join(" · ")}]` : ""}` +
      ` (주석·docs 는 그때 그 이름이 맞아서 안 센다)`);

  const ua = readFileSync(path.join(REPO, "app/api/unfurl/route.ts"), "utf-8");
  const mark = readFileSync(path.join(REPO, "app/api/notion/resource/route.ts"), "utf-8");
  chk("③-식별자-둘은-그대로",
      ua.includes("MissionDeck/1.0") && mark.includes("createdByMissionDeck"),
      `User-Agent "MissionDeck/1.0" ${ua.includes("MissionDeck/1.0") ? "있음" : "없어졌다"}` +
      ` · meta 열쇠 createdByMissionDeck ${mark.includes("createdByMissionDeck") ? "있음" : "없어졌다"}` +
      ` — 표시만 갈아 끼우고 식별은 안 건드린다`);

  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  const setSwitch = async (v) => {
    if (v === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb($2::boolean))
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, v]);
  };

  const me = (await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];

  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const errs = [];
  const open = async (ctx) => {
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errs.push(e.message));
    p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(m.text()); });
    return p;
  };
  const signed = async (w, h) => {
    const c = await browser.newContext({ viewport: { width: w, height: h } });
    await c.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
      value: tok({ id: me.id, actorId: me.id, name: "검사", role: me.role,
                   adminGrant: me.admin_grant, email: "x@x" }) }]);
    return c;
  };

  /*
   * ── ④⑤ 로고 자리 넷 ──────────────────────────────────────────
   *
   * 넷은 화면이 서로 다르다 — 로그인(로그아웃 상태) · 오류(전역) ·
   * 옛 사이드바(스위치 꺼짐) · v3 레일(스위치 켜짐). 한 번에 못 본다.
   */
  const logos = [];

  // 3 로그인 — 쿠키 없이
  {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const p = await open(c);
    await p.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    const el = p.locator(".login-hero-t span");
    logos.push({ name: "로그인", text: (await el.innerText()).trim(),
                 clipped: await el.evaluate(CLIPPED) });
    await shot(p, { path: `${OUT}/A-로그인.png` });
    await c.close();
  }

  // 5 옛 화면 사이드바 — 스위치 꺼짐
  await setSwitch(null);
  {
    const c = await signed(1440, 900);
    const p = await open(c);
    await p.goto(`${BASE}/`, { waitUntil: "networkidle" });
    /*
     * 061 §F-19 — 로고 자리는 **두 줄**이 됐다(윗줄 팀 · 아랫줄 서비스).
     * 한 줄짜리 옛 구조를 물으면 「이름이 사라졌다」로 읽는다.
     * 두 줄을 각각 읽고, 합쳐서 긴 이름과 같은지 본다 — 나뉘었어도 **잃은 글자가
     * 없어야** 한다.
     */
    const el = p.locator(".brand .nm").first();
    logos.push({ name: "옛 사이드바", text: (await el.innerText()).replace(/\s+/g, " ").trim(),
                 clipped: await el.evaluate(CLIPPED) });

    /*
     * ── ④짝2 로고가 커져서 **밑을 밀지 않았는가** ────────────────
     *
     * 처음엔 「계정 블록이 화면 안에 있는가」로 물었다가 틀렸다. 옛 사이드바는
     * `position: relative` 에 높이가 문서 전체(1745px)라서 계정 블록은 원래부터
     * 화면 밖 바닥에 있다 — 스크롤해야 보인다. 내가 만든 적 없는 성질을
     * 요구한 것이었다. 057 은 옛 화면을 고치지 않는다(§D).
     *
     * 물어야 할 것은 「**이번 변경이** 밑을 밀었는가」다. 그래서 같은 실행 안에서
     * 옛 이름(한 줄)으로 되돌려 재고 비교한다 — 기준을 손으로 적지 않는다.
     */
    const nm = await p.locator(".brand .nm").boundingBox();
    const after = await p.locator(".acctblk").evaluate((el) => Math.round(el.getBoundingClientRect().bottom));
    const before = await p.evaluate(() => {
      // 061 §F-19 — 로고 밑줄이 `small` 에서 `.nm-team` 으로 바뀌었다.
      const s = document.querySelector(".brand .nm .nm-team");
      const keep = s.textContent;
      s.textContent = "AAA";                                  // 한 줄짜리로 되돌린다
      const y = Math.round(document.querySelector(".acctblk").getBoundingClientRect().bottom);
      s.textContent = keep;                                   // 바로 되돌린다
      return y;
    });
    chk("④짝2-로고가-밑을-안-밀었다", after === before,
        `계정 블록 아래끝 — 긴 이름 ${after}px · 한 줄로 되돌리면 ${before}px` +
        ` · 로고 칸 높이 ${nm ? Math.round(nm.height) : "?"}px (두 줄)` +
        ` — 옛 사이드바는 원래 문서 높이만큼 길어서 계정 블록이 화면 밖 바닥에 있다`);

    await shot(p, { path: `${OUT}/A-옛화면.png` });
    await c.close();
  }

  // 6 v3 레일 — 스위치 켜짐
  await setSwitch(true);
  let v3ctx = await signed(1440, 900);
  {
    const p = await open(v3ctx);
    await p.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    const el = p.locator(".v3-rail-brand");
    logos.push({ name: "v3 레일", text: (await el.innerText()).replace(/\s+/g, " ").trim(),
                 clipped: await el.evaluate(CLIPPED) });

    /*
     * ── ⑥ 짧은 이름 자리에서 긴 이름이 안 나온다 ────────────────
     * `<title>` 이 그 자리다. 긴 이름을 넣으면 탭에서 잘린다.
     */
    const title = await p.title();
    chk("⑥-짧은-이름-자리엔-짧게",
        title.includes(APP_NAME) && !title.includes(APP_NAME_LONG) && title.includes(ORG_NAME),
        `<title> "${title}" — 짧은 이름 있음 · 긴 이름 없음 · 조직 이름 그대로`);

    await shot(p, { path: `${OUT}/A-v3레일.png` });
  }

  // 4 오류 화면 — 전역 오류는 띄울 수 없으므로 **소스에서** 확인한다.
  //   화면을 못 여는 자리를 「봤다」고 적지 않는다 (§G 049).
  {
    const ge = readFileSync(path.join(REPO, "app/global-error.tsx"), "utf-8");
    chk("④짝-오류-화면도-긴-이름",
        ge.includes("APP_NAME_LONG") && !OLD.test(ge.replace(/^\s*\/\/.*$/gm, "")),
        `app/global-error.tsx 가 APP_NAME_LONG 을 쓴다 (전역 오류 화면은 띄울 수 없어 소스로 확인)`);
  }

  // 061 §E-17(나) — 빈 배열이면 **화면을 못 읽은 것**이다. 최소 개수를 함께 묻는다.
  /*
   * 061 §F-19 — 로고 자리가 **두 줄**이 됐다. 로그인은 아직 한 줄(`APP_NAME_LONG`)이고
   * 레일·사이드바는 팀 + 서비스 두 줄이다. **잃은 글자가 없는지**로 묻는다:
   * 줄바꿈을 지우면 긴 이름과 같아야 하고, 두 조각이 다 들어 있어야 한다.
   */
  const whole = (t) => t.replace(/\s+/g, " ").trim();
  chk("④-로고-넷에-긴-이름",
      logos.length === 3
      && logos.every((l) => whole(l.text) === APP_NAME_LONG)
      && logos.every((l) => l.text.includes(TEAM_NAME) && l.text.includes(APP_NAME)),
      logos.map((l) => `${l.name} "${l.text}"`).join(" · ") +
      ` — 줄바꿈을 지우면 "${APP_NAME_LONG}" 과 같아야 한다 + 오류 화면(위)`);
  chk("⑤-긴-이름이-안-잘린다", logos.every((l) => !l.clipped),
      logos.map((l) => `${l.name} ${l.clipped ? "잘림" : "다 들어감"}`).join(" · ") +
      " — scrollWidth ≤ clientWidth 로 쟀다(보이는 것과 들어간 것은 다르다)");

  /*
   * ── ⑤짝 잘림을 잡을 수 있는가 ────────────────────────────────
   *
   * 「안 잘렸다」가 늘 참이면 ⑤ 는 아무것도 안 잰다(§G 054). 일부러 한 줄로
   * 묶고 폭을 줄여서 **잘리게 만든 뒤** 검사식이 그것을 잡는지 본다.
   */
  {
    const p = await open(v3ctx);
    await p.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    const el = p.locator(".v3-rail-brand .v3-rail-team");   // 061 §F-19 로 이름이 바뀌었다
    const forced = await el.evaluate((n) => {
      n.style.whiteSpace = "nowrap"; n.style.overflow = "hidden"; n.style.width = "40px";
      return n.scrollWidth > n.clientWidth + 1;
    });
    await el.evaluate((n) => { n.style.whiteSpace = ""; n.style.overflow = ""; n.style.width = ""; });
    chk("⑤짝-잘림을-잡을-수-있다", forced,
        `폭을 40px 로 조여 보니 잘림 ${forced ? "잡힘" : "못 잡음 — 그럼 ⑤는 아무것도 안 잰다"} (되돌림)`);
  }
  await v3ctx.close();

  /*
   * ── ⑦ 390px ─────────────────────────────────────────────────
   *
   * 잘리지 않는 것만으로는 모자란다. 두 줄로 접히면서 **레일 메뉴를 밀어내
   * 화면 밖으로 보내지 않았는지**도 본다 — 로고가 커지면 밑이 밀린다.
   */
  await setSwitch(true);
  {
    const c = await signed(390, 844);
    const p = await open(c);
    await p.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
    /*
     * 059 §B ① 뒤로는 **레일이 서랍이다.** 닫혀 있을 때는 `visibility: hidden`
     * 이라 `innerText` 가 빈 글자로 온다 — 처음엔 그걸 「이름이 사라졌다」로 읽고
     * 실패했다. 화면이 옳고 검사기가 옛 화면을 묻고 있었다.
     * 사람이 하는 대로 ☰ 를 눌러 열고 나서 잰다.
     */
    await p.locator(".v3-burger").click();
    await p.waitForTimeout(320);                 // 서랍이 미끄러져 나올 때까지
    const el = p.locator(".v3-rail-brand");
    /*
     * 061 §F-19 — 전에는 `getClientRects().length` 로 줄 수를 셌다. 로고가 한 줄일
     * 때 쓰던 방법이고, 안쪽에 블록(`.v3-rail-team`)이 생긴 뒤로는 무엇을 세든
     * 1 이 나온다 — **늘 같은 값을 내놓는 숫자는 근거가 아니다**(§G 054).
     * 두 줄을 각각 읽어 적는다.
     */
    const narrow = { text: (await el.innerText()).replace(/\s+/g, " ").trim(), clipped: await el.evaluate(CLIPPED),
                     rows: await el.evaluate((n) => {
                       const team = n.querySelector(".v3-rail-team");
                       /*
                        * **줄이 나뉘었는지**를 재려면 두 조각의 세로 자리를 비교해야 한다.
                        * 처음엔 「로고 칸이 윗줄보다 높다」로 물었다가 틀렸다 — 한 줄로
                        * 되돌려도 좁은 화면에서는 어차피 접혀서 늘 참이었다. 서비스
                        * 이름은 요소가 아니라 **글자 노드**라 Range 로 자리를 잡는다.
                        */
                       const svc = [...n.childNodes].find((c) => c.nodeType === 3 && c.textContent.trim());
                       const r = document.createRange(); if (svc) r.selectNodeContents(svc);
                       const tb = team?.getBoundingClientRect(), sb = svc ? r.getBoundingClientRect() : null;
                       return { team: team?.textContent ?? "(없음)",
                                teamBottom: tb ? Math.round(tb.bottom) : null,
                                svcTop: sb ? Math.round(sb.top) : null };
                     }) };
    const menu = await p.locator(".v3-rail a").first().boundingBox();
    // v3 레일은 `sticky` · `height: 100vh` 라 계정 블록이 **화면 안 바닥**에 있다.
    // 옛 사이드바와 달리 여기서는 화면 안에 있는지 물어도 된다.
    const acct = await p.locator(".v3-acct").boundingBox();
    const vh = 844;
    chk("⑦-390px-에서도-안-깨진다",
        narrow.text === APP_NAME_LONG && !narrow.clipped && menu !== null && menu.y < vh
        && acct !== null && acct.y + acct.height <= vh + 1
        && narrow.rows.team === TEAM_NAME
        && narrow.rows.svcTop !== null && narrow.rows.svcTop >= narrow.rows.teamBottom - 1,
        `"${narrow.text}" · 윗줄 "${narrow.rows.team}" 아래끝 ${narrow.rows.teamBottom}px` +
        ` · 서비스 이름 윗끝 ${narrow.rows.svcTop}px (아래여야 줄이 나뉜 것)` +
        ` · ${narrow.clipped ? "잘림" : "다 들어감"}` +
        ` · 첫 메뉴 y=${menu ? Math.round(menu.y) : "(없음)"}px` +
        ` · 계정 블록 아래끝 ${acct ? Math.round(acct.y + acct.height) : "(없음)"}px` +
        ` (둘 다 화면 ${vh}px 안이라야 안 밀린 것)`);
    await shot(p, { path: `${OUT}/A-390px.png` });
    await c.close();
  }

  chk("⑧-콘솔오류", errs.length === 0, `${errs.length}건${errs.length ? ` [${errs[0]}]` : ""}`);

  console.log(`\n${pass}/${pass + fail} 통과`);
  process.exitCode = fail === 0 ? 0 : 1;
} finally {
  // 스위치를 시작 전으로. 검사기가 켜 둔 채 끝나면 다음 검사기가 엉뚱한 화면을 본다.
  try {
    if (swBefore === null) await pool.query(`DELETE FROM config WHERE key = $1`, [KEY]);
    else await pool.query(`INSERT INTO config (key, value) VALUES ($1, $2)
                           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY, swBefore]);
    const now = (await pool.query(`SELECT value FROM config WHERE key = $1`, [KEY])).rows[0];
    console.log(`\n뒷정리 확인 — 스위치 ${now ? JSON.stringify(now.value) : "(행 없음)"}` +
                ` (시작 전 ${swBefore === null ? "(행 없음)" : JSON.stringify(swBefore)})`);
  } finally {
    rmSync(TMP, { recursive: true, force: true });
    await browser?.close();
    await pool.end();
  }
}
