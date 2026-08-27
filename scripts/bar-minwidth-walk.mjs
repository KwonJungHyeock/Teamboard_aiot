// 기한 막대의 **최소 폭 8px** 을 실측한다 (MD-P-2026-031 §D6 · §C3 ⑥).
//
// **로컬 전용. 원격 DB 에서 실행 금지** (지시 32).
// 읽기만 한다 — 아무것도 만들지 않고 아무것도 지우지 않는다.
//
// 무엇을 보는가.
//   ① 8px 보다 얇은 막대가 **한 개도 없다** — CSS 하한이 실제로 걸리는지
//      짝: 재어 본 막대가 0개가 아니다 (빈 화면은 "얇은 막대 0개"로도 통과한다)
//   ② 하한에 **걸린 건수**를 보고한다. 기하값이 8px 미만이라 늘어난 막대의 비율.
//      **절반을 넘으면 하한이 문제를 가리고 있는 것이다 — 눈금 범위가 틀렸다는 신호다.**
//      (§C2 의 stub 20% 규칙과 같은 성격이다: 하한도 stub 도 증상이지 처방이 아니다)
//   ③ 오른쪽 끝에 붙은 막대가 트랙 밖으로 나가지 않는다 — 넓혀 놓고 잘라 내면 넓힌 적이 없다
//
// ⚠ | head 로 파이프하지 말 것. SIGPIPE 로 finally 정리가 죽는다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("bar-minwidth-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const MIN = 8;
const pool = new pg.Pool({ connectionString: DSN });
const tok = (u) => {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`;
};

const rows = [];
const ok = (id, n) => { rows.push({ id, pass: true, n }); console.log(`OK   ${id.padEnd(18)} ${n}`); };
const bad = (id, n) => { rows.push({ id, pass: false, n }); console.log(`FAIL ${id.padEnd(18)} ${n}`); };
const note = (id, n) => { rows.push({ id, pass: null, n }); console.log(`측정 ${id.padEnd(18)} ${n}`); };

let browser;
try {
  const lead = (await pool.query(
    `SELECT a.id, a.display_name FROM actor a JOIN account c ON c.actor_id = a.id
      WHERE a.type='human' AND a.is_active ORDER BY a.id LIMIT 1`)).rows[0];
  if (!lead) throw new Error("사람 계정이 없다 — 시드부터 하라");

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: "tb_session", value: tok({ id: lead.id, name: lead.display_name, role: "lead" }),
                          url: BASE, httpOnly: true, sameSite: "Lax" }]);
  const page = await ctx.newPage();

  /** 한 화면의 막대를 전부 잰다. 기하값(--w)과 실제 픽셀을 **둘 다** 읽는다. */
  async function measure(path) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    // 첫 화면 안내가 떠 있으면 본문이 안 눌리고, 화면에 따라 렌더도 늦다.
    const frn = page.locator(".frn-skip");
    if (await frn.count()) { await frn.first().click(); await page.locator(".frn-bg").waitFor({ state: "detached", timeout: 5000 }); }
    await page.waitForSelector(".tt-track", { timeout: 10000 }).catch(() => {});
    return page.$$eval(".tt-bar", (bars, min) => bars.map((b) => {
      const track = b.closest(".tt-track");
      const tw = track ? track.getBoundingClientRect().width : 0;
      const r = b.getBoundingClientRect();
      const trk = track ? track.getBoundingClientRect() : null;
      // 컴포넌트가 넣은 백분율 — 하한이 걸리기 **전**의 값이다.
      const wPct = parseFloat(b.style.getPropertyValue("--w")) || 0;
      return {
        px: Math.round(r.width * 10) / 10,
        trackPx: Math.round(tw * 10) / 10,
        rawPx: Math.round((wPct / 100) * tw * 10) / 10,   // 하한이 없었다면 이 폭이었다
        clamped: (wPct / 100) * tw < min,
        overflowRight: trk ? Math.round((r.right - trk.right) * 10) / 10 : 0,
      };
    }), MIN);
  }

  for (const [label, path] of [["/tasks", "/tasks"], ["홈", "/"]]) {
    const bars = await measure(path);
    if (bars.length === 0) { note(`표본-${label}`, "막대 0개 — 이 화면의 판정은 세우지 않는다"); continue; }

    const trackPx = bars[0].trackPx;
    note(`표본-${label}`, `막대 ${bars.length}개 · 트랙 ${trackPx}px`);

    // ① 8px 미만이 없다 (+ 짝: 잰 막대가 0개가 아니다 — 위 표본 줄이 그 짝이다)
    const thin = bars.filter((b) => b.px < MIN - 0.5);
    thin.length === 0
      ? ok(`①얇은막대-${label}`, `${MIN}px 미만 0개 / ${bars.length}개 (가장 좁은 것 ${Math.min(...bars.map((b) => b.px))}px)`)
      : bad(`①얇은막대-${label}`, `${MIN}px 미만 ${thin.length}개 — 폭: ${thin.map((b) => b.px).join(", ")}px`);

    // ② 하한에 걸린 건수.
    //
    // 비율로 판정하려면 표본이 있어야 한다. 막대 4개에서 3개가 걸리면 75% 지만,
    // **행 하나가 25%p 를 움직인다** — 「괜찮다」와 「범위가 틀렸다」 사이보다 큰 폭이다.
    // 그런 수를 판정으로 올리면 시드가 한 줄 바뀔 때마다 결론이 뒤집힌다.
    // 10건이면 한 행이 10%p 이내다. 그 아래는 **세어서 적기만 하고 판정하지 않는다.**
    const RATIO_MIN = 10;
    const hit = bars.filter((b) => b.clamped);
    const pct = Math.round((hit.length / bars.length) * 1000) / 10;
    const line = `하한에 걸린 막대 ${hit.length}/${bars.length}건 (${pct}%)`
      + (hit.length ? ` · 늘리기 전 폭 ${hit.map((b) => b.rawPx).join(", ")}px` : "");
    if (bars.length < RATIO_MIN)
      note(`②걸린건수-${label}`, `${line} — 막대 ${bars.length}개는 비율을 판정하기에 부족하다(${RATIO_MIN}건 필요). 세어서 적기만 한다`);
    else if (pct > 50)
      bad(`②걸린건수-${label}`, `${line} — **절반을 넘는다. 하한이 문제를 가리고 있다: 눈금 범위가 틀렸다는 신호다**`);
    else ok(`②걸린건수-${label}`, line);

    // ③ 트랙 밖으로 안 나간다
    const out = bars.filter((b) => b.overflowRight > 0.5);
    out.length === 0
      ? ok(`③넘침-${label}`, `트랙 오른쪽을 넘는 막대 0개 (가장 많이 나간 것 ${Math.max(...bars.map((b) => b.overflowRight))}px)`)
      : bad(`③넘침-${label}`, `트랙을 넘는 막대 ${out.length}개 — ${out.map((b) => b.overflowRight).join(", ")}px 초과`);
  }
} catch (e) {
  console.log(String(e && e.stack ? e.stack : e));
  bad("예외", String(e && e.message ? e.message.split("\n")[0] : e));
} finally {
  if (browser) { try { await browser.close(); } catch (e) { console.log(`   브라우저 종료 실패: ${e}`); } }
  try { await pool.end(); } catch { /* 종료 경로 — 이미 닫혔다면 더 할 일이 없다 */ }
  const f = rows.filter((r) => r.pass === false).length;
  const p = rows.filter((r) => r.pass === true).length;
  console.log(`\n결과 ${p}/${p + f} 통과 · 측정 ${rows.filter((r) => r.pass === null).length}건`);
  if (rows.length === 0) { console.error("측정된 줄이 0건이다 — 서버가 떠 있는지 확인하라"); process.exit(2); }
  process.exit(f ? 1 : 0);
}
