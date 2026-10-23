// 내 기록(업무기록 · 0037) — 빨리 적히고, 내 것만 보이고, 남의 것은 못 건드린다.
//
//   node scripts/worklog-walk.mjs            재기만 한다
//   SHOT=1 node scripts/worklog-walk.mjs     화면 캡처까지 (OUT 폴더)
//
// 묻는 것:
//   ① `#이름` 이 카테고리가 되고 본문에서 빠진다 · 같은 이름은 두 번 만들어지지 않는다
//   ② 빈 기록은 400 · 날짜 지정이 된다 · 남의 폴더 첨부는 걸러진다
//   ③ **남의 기록은 없는 것처럼** — 목록에 안 나오고, 고치기·지우기·카테고리 숨기기가 404
//   ④ 카테고리를 숨기면 그 기록은 「분류 없음」으로 남는다(지워지지 않는다)
//   ⑤ 레일에 「내 기록」이 있고 누르면 열린다(열한 번째)
//   ⑥ 화면에서 한 줄 쓰고 엔터 → 목록에 뜬다 · 칩으로 고른 카테고리가 붙는다
//   ⑦ 거르개 · 고치기 · 지우기가 화면에서 된다
//   ⑧ 좁은 화면(390px)에서 옆으로 안 넘친다 · 공간 모드에서도 열린다
//   ⑨ 콘솔 오류 0
//
// **로컬 전용.** 제가 만든 줄(본문에 「[검사]」 · 카테고리 이름 「검사」로 시작)만 지운다.
import { chromium } from "playwright";
import { createHmac } from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";
import { shot } from "./shot.mjs";

requireLocalDb("worklog-walk.mjs");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const OUT = process.env.OUT ?? "docs/shots/worklog";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const KEY = "ui_v3_enabled";
const MARK = "[검사]";
const cleanup = async (ids) => {
  await sql(`DELETE FROM work_log WHERE owner_actor_id = ANY($1) AND (body LIKE '%' || $2 || '%'
               OR category_id IN (SELECT id FROM work_log_category WHERE owner_actor_id = ANY($1) AND name LIKE '검사%'))`, [ids, MARK]);
  await sql(`UPDATE work_log SET category_id = NULL WHERE owner_actor_id = ANY($1)
               AND category_id IN (SELECT id FROM work_log_category WHERE owner_actor_id = ANY($1) AND name LIKE '검사%')`, [ids]);
  await sql(`DELETE FROM work_log_category WHERE owner_actor_id = ANY($1) AND name LIKE '검사%'`, [ids]);
};

let browser, swBefore = null, ids = [];
try {
  const swRow = (await sql(`SELECT value FROM config WHERE key = $1`, [KEY]))[0];
  swBefore = swRow === undefined ? null : swRow.value;
  await sql(`INSERT INTO config (key, value) VALUES ($1, to_jsonb(true))
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [KEY]);

  const people = await sql(
    `SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active ORDER BY (a.role IN ('admin','lead')) DESC, a.actor_id LIMIT 2`);
  if (people.length < 2) throw new Error("활성 계정이 둘 필요하다");
  const [me, other] = people;
  ids = [me.id, other.id];
  await cleanup(ids);
  const cookie = (u) => `tb_session=${tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" })}`;
  const api = async (u, method, path, body) => {
    const r = await fetch(`${BASE}${path}`, { method, headers: { cookie: cookie(u), "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };

  // ── ① 태그 ─────────────────────────────────────────────────────
  const a1 = await api(me, "POST", "/api/worklog", { body: `#검사태그 예제 3/5 정리 ${MARK}` });
  const a2 = await api(me, "POST", "/api/worklog", { body: `${MARK} 두 번째 #검사태그` });
  const c1 = a1.data?.entry?.categoryId, c2 = a2.data?.entry?.categoryId;
  chk("①-#이름이-카테고리로", a1.status === 200 && c1 && c1 === c2 && !a1.data.entry.body.includes("#검사태그"),
      `본문 "${a1.data?.entry?.body}" · 카테고리 ${c1} / 두 번째 ${c2} (같아야 한다)`);

  // ── ② 입력 ─────────────────────────────────────────────────────
  const empty = await api(me, "POST", "/api/worklog", { body: "   " });
  const dated = await api(me, "POST", "/api/worklog", {
    body: `${MARK} 어제 한 일`, loggedOn: "2026-10-01",
    attachments: [
      { pathname: `worklog/${other.id}/11111111-1111-1111-1111-111111111111-x.png`, name: "남의.png", size: 1, contentType: "image/png" },
      { pathname: `worklog/${me.id}/22222222-2222-2222-2222-222222222222-y.pdf`, name: "내.pdf", size: 1, contentType: "application/pdf" },
    ] });
  const att = dated.data?.entry?.attachments ?? [];
  chk("②-빈칸·날짜·남의-첨부", empty.status === 400 && dated.data?.entry?.loggedOn === "2026-10-01"
      && att.length === 1 && att[0].name === "내.pdf",
      `빈 기록 ${empty.status} · 날짜 ${dated.data?.entry?.loggedOn} · 첨부 ${att.map((f) => f.name).join(",")} (남의 것 걸러짐)`);

  // ── ③ 남의 것 ───────────────────────────────────────────────────
  const theirs = await api(other, "GET", "/api/worklog?month=2026-10");
  const seen = (theirs.data?.entries ?? []).filter((e) => e.body.includes(MARK)).length;
  const p = await api(other, "PATCH", `/api/worklog/${a1.data.entry.id}`, { body: "바꿈" });
  const d = await api(other, "DELETE", `/api/worklog/${a1.data.entry.id}`);
  const h = await api(other, "DELETE", `/api/worklog/categories/${c1}`);
  const useCat = await api(other, "POST", "/api/worklog", { body: `${MARK} 남의 카테고리로`, categoryId: c1 });
  chk("③-남의-기록은-없는-것처럼", seen === 0 && p.status === 404 && d.status === 404 && h.status === 404 && useCat.status === 400,
      `남이 본 내 기록 ${seen}줄 · 고치기 ${p.status} · 지우기 ${d.status} · 카테고리 숨기기 ${h.status} · 남의 카테고리로 쓰기 ${useCat.status}`);

  // ── ④ 카테고리 숨기기 ──────────────────────────────────────────
  const hide = await api(me, "DELETE", `/api/worklog/categories/${c1}`);
  const after = await api(me, "GET", "/api/worklog?month=2026-10");
  const left = (after.data?.entries ?? []).filter((e) => e.id === a1.data.entry.id)[0];
  chk("④-숨기면-분류-없음으로", hide.status === 200 && left && left.categoryId === null
      && !(after.data?.categories ?? []).some((c) => c.id === c1),
      `숨기기 ${hide.status} · 그 기록 ${left ? `남음(카테고리 ${left.categoryId})` : "사라짐"}`);

  // ── 화면 ───────────────────────────────────────────────────────
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const errs = [];
  const open = async (viewport, extra = []) => {
    const c = await browser.newContext({ viewport });
    const host = new URL(BASE).hostname;
    await c.addCookies([{ name: "tb_session", domain: host, path: "/", value: cookie(me).split("=")[1] }, ...extra.map((x) => ({ ...x, domain: host, path: "/" }))]);
    const pg_ = await c.newPage();
    pg_.on("pageerror", (e) => errs.push(e.message));
    pg_.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    pg_.on("dialog", (dl) => dl.accept());
    return pg_;
  };
  if (process.env.SHOT === "1") mkdirSync(OUT, { recursive: true });

  const w = await open({ width: 1440, height: 900 });
  await w.goto(`${BASE}/v3`, { waitUntil: "networkidle" });
  const link = w.locator('.v3-rail a[href="/v3/log"]');
  const hasLink = (await link.count()) === 1;
  if (hasLink) await link.click();
  await w.waitForURL(/\/v3\/log$/, { timeout: 9000 }).catch(() => {});
  await w.locator(".v3-log-in").first().waitFor({ timeout: 9000 });
  const cur = await w.locator('.v3-rail a[href="/v3/log"]').getAttribute("aria-current");
  chk("⑤-레일에서-열린다", hasLink && w.url().endsWith("/v3/log") && cur === "page", `링크 ${hasLink} · 주소 ${w.url()} · aria-current ${cur}`);

  // 카테고리 칩 하나 만들고 → 고르고 → 쓰고 엔터
  await w.locator(".v3-log-chip.add").click();
  await w.locator(".v3-log-newcat").fill("검사칩");
  await w.locator(".v3-log-newcat").press("Enter");
  await w.locator(".v3-log-chip", { hasText: "#검사칩" }).waitFor({ timeout: 9000 });
  const picked = await w.locator(".v3-log-chip", { hasText: "#검사칩" }).getAttribute("aria-pressed");
  await w.locator(".v3-log-in").first().fill(`화면에서 쓴 한 줄 ${MARK}`);
  await w.locator(".v3-log-in").first().press("Enter");
  const row = w.locator(".v3-log-e", { hasText: `화면에서 쓴 한 줄 ${MARK}` });
  await row.waitFor({ timeout: 9000 }).catch(() => {});
  const rowText = (await row.count()) ? await row.innerText() : "";
  const cleared = await w.locator(".v3-log-in").first().inputValue();
  chk("⑥-쓰고-엔터면-뜬다", rowText.includes("#검사칩") && cleared === "" && picked === "true",
      `새 칩이 바로 골라짐 ${picked} · 줄 "${rowText.replace(/\s+/g, " ").slice(0, 60)}" · 입력칸 비워짐 ${cleared === ""}`);
  await w.waitForTimeout(500);
  await shot(w, { path: `${OUT}/wide.png` });

  // 거르개 · 고치기 · 지우기
  await w.locator(".v3-log-f", { hasText: "검사칩" }).click();
  const filtered = await w.locator(".v3-log-e").count();
  await w.locator(".v3-log-f", { hasText: "전체" }).click();
  await row.hover();
  await row.locator("button", { hasText: "고치기" }).click();
  // 고치는 동안은 줄 글자가 입력칸 안으로 들어가 「글자로 찾기」가 안 맞는다 — 고치는 칸을 직접 잡는다.
  const ed = w.locator(".v3-log-edit textarea");
  await ed.fill(`고친 한 줄 ${MARK}`);
  await ed.press("Enter");
  const edited = w.locator(".v3-log-e", { hasText: `고친 한 줄 ${MARK}` });
  await edited.waitFor({ timeout: 9000 }).catch(() => {});
  const editedOk = (await edited.count()) === 1;
  await edited.hover();
  await edited.locator("button", { hasText: "지우기" }).click();
  await w.waitForTimeout(900);
  const gone = (await w.locator(".v3-log-e", { hasText: `고친 한 줄 ${MARK}` }).count()) === 0;
  chk("⑦-거르개·고치기·지우기", filtered === 1 && editedOk && gone,
      `「검사칩」만 보기 ${filtered}줄 · 고친 줄 보임 ${editedOk} · 지운 뒤 사라짐 ${gone}`);

  // 좁은 화면 · 공간 모드
  const ph = await open({ width: 390, height: 844 }, [{ name: "v3_look", value: "space" }]);
  await ph.goto(`${BASE}/v3/log`, { waitUntil: "networkidle" });
  await ph.waitForTimeout(700);
  const m = await ph.evaluate(`({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth,
    space: document.querySelector(".v3")?.classList.contains("v3-space") ?? false, title: document.querySelector(".v3-topbar-t")?.textContent })`);
  await shot(ph, { path: `${OUT}/phone-space.png` });
  chk("⑧-좁은-화면·공간-모드", m.sw <= m.cw && m.space && m.title === "내 기록",
      `문서 폭 ${m.sw} / 화면 ${m.cw} · 공간 모드 ${m.space} · 위 바 "${m.title}"`);

  chk("⑨-콘솔-오류", errs.length === 0, `${errs.length}건${errs.length ? ` — ${errs[0].slice(0, 120)}` : ""}`);
} catch (e) {
  fail++; console.log(`FAIL 실행 ${e.stack ?? e}`);
} finally {
  await browser?.close();
  if (ids.length) await cleanup(ids);
  if (swBefore === null) await sql(`DELETE FROM config WHERE key = $1`, [KEY]);
  else await sql(`UPDATE config SET value = $2 WHERE key = $1`, [KEY, JSON.stringify(swBefore)]);
  await pool.end();
  console.log(`\n${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
}
