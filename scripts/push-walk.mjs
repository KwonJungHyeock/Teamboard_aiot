// 데스크톱 알림(0041) — 진짜로 암호화돼서 그 기기로 가는가. 검사기가 **푸시 서버 흉내**를 낸다.
//
//   VAPID_PUBLIC_KEY=… VAPID_PRIVATE_KEY=… (개발 서버에도 같은 값) node scripts/push-walk.mjs
//
// 브라우저 대신 검사기가 기기 키(ECDH P-256 + auth 16바이트)를 만들어 등록하고, 앱이 보낸
// 암호문을 그 키로 **풀어서** 내용을 본다. 브라우저 · 구글 푸시 서버는 거치지 않는다
// (검사 환경은 밖으로 못 나간다) — 그 구간은 웹 푸시 표준과 web-push 라이브러리를 믿는다.
//
// 묻는 것:
//   ① 공개 열쇠가 나온다 · 푸시 서버가 아닌 주소(https://evil…)는 400
//   ② 시험 알림이 암호화돼서 오고, 풀면 그 글이다 · VAPID 서명 머리가 붙어 있다
//   ③ 업무를 맡기면(만들 때 · 담당 바꿀 때) 받는 사람에게만 · 맡긴 사람에게는 안 간다
//   ④ 회의를 열면 연 사람 빼고 온다 — 누르면 그 회의로(url)
//   ⑤ 종류를 끄면 안 온다
//   ⑥ 푸시 서버가 410(구독 버림)을 주면 그 기기는 꺼진다
//   ⑦ 아침 작업(cron)이 「오늘 마감」을 보낸다
//   ⑧ 로그인 없이 /manifest.webmanifest · /sw.js 가 열린다 · 내 정보에 「알림 · 앱 설치」
//   ⑨ 브라우저 쪽 — sw.js 가 푸시를 받으면 알림이 실제로 뜬다(DevTools 로 푸시를 넣어 본다)
//
// **로컬 전용.** 검사 기기 · 「[검사]」 업무 · 회의만 지운다.
import { chromium } from "playwright";
import { createHmac, createECDH, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import pg from "pg";
import { requireLocalDb } from "./local-only.mjs";

requireLocalDb("push-walk.mjs");
const ece = createRequire(import.meta.url)("http_ece");

const BASE = process.env.BASE ?? "http://127.0.0.1:3000";
const S = process.env.AUTH_SECRET, DSN = process.env.DATABASE_URL;
if (!S) { console.error("AUTH_SECRET 필요"); process.exit(1); }
const pool = new pg.Pool({ connectionString: DSN });
const sql = async (t, p = []) => (await pool.query(t, p)).rows;
const tok = (u) => { const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(Date.now()/1000)+3600 })).toString("base64url");
  return `${p}.${createHmac("sha256", S).update(p).digest("base64url")}`; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const chk = (id, c, n) => { if (c) { pass++; console.log(`OK   ${id.padEnd(30)} ${n}`); }
  else { fail++; console.log(`FAIL ${id.padEnd(30)} ${n}`); } };

const MARK = "[검사]";
const PORT = 4599;
// 기기 둘 — 받는 사람(팀원) · 맡기는 사람(팀장)
const dev = (name) => { const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  return { name, ecdh, auth: randomBytes(16), endpoint: `http://localhost:${PORT}/${name}` }; };
const devs = { member: dev("member"), lead: dev("lead") };
const got = { member: [], lead: [] };
let answer = 201;                                   // 흉내 서버가 돌려줄 상태
const server = createServer((req, res) => {
  const chunks = []; req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const d = devs[req.url.slice(1)];
    if (d) {
      let msg = null;
      try { msg = JSON.parse(ece.decrypt(Buffer.concat(chunks), { version: "aes128gcm", privateKey: d.ecdh, authSecret: d.auth }).toString()); }
      catch (e) { msg = { error: e.message }; }
      got[d.name].push({ msg, vapid: String(req.headers.authorization ?? ""), enc: req.headers["content-encoding"] });
    }
    res.writeHead(answer); res.end();
  });
});

let browser, others = [];
try {
  await new Promise((r) => server.listen(PORT, r));
  const lead = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND (a.role IN ('admin','lead') OR a.admin_grant) ORDER BY a.actor_id LIMIT 1`))[0];
  const member = (await sql(`SELECT a.actor_id id, a.role, a.admin_grant, ac.display_name nm FROM account a JOIN actor ac ON ac.id = a.actor_id
      WHERE ac.is_active AND a.role = 'member' AND NOT a.admin_grant ORDER BY a.actor_id LIMIT 1`))[0];
  if (!lead || !member) throw new Error("팀장 하나 · 팀원 하나가 필요하다");
  const cookie = (u) => `tb_session=${tok({ id: u.id, actorId: u.id, name: u.nm, role: u.role, adminGrant: u.admin_grant, email: "x@x" })}`;
  const api = async (u, method, path, body, headers = {}) => {
    const r = await fetch(`${BASE}${path}`, { method, redirect: "manual", headers: { ...(u ? { cookie: cookie(u) } : {}), "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null), type: r.headers.get("content-type") ?? "" };
  };
  const reg = (u, d, kinds) => api(u, "POST", "/api/push", { subscription: { endpoint: d.endpoint,
    keys: { p256dh: d.ecdh.getPublicKey().toString("base64url"), auth: d.auth.toString("base64url") } }, kinds });
  const reset = () => { got.member.length = 0; got.lead.length = 0; };
  // 다른 사람들의 진짜 기기로 검사 알림이 가지 않게 — 검사 동안 남의 기기는 잠시 꺼 둔다
  others = await sql(`UPDATE push_subscription SET disabled_at = now() WHERE disabled_at IS NULL AND endpoint NOT LIKE 'http://localhost:${PORT}/%' RETURNING id`);

  // ── ① ─────────────────────────────────────────────────────────
  const info = await api(member, "GET", "/api/push");
  const evil = await api(member, "POST", "/api/push", { subscription: { endpoint: "https://evil.example.com/x", keys: { p256dh: "a".repeat(40), auth: "b".repeat(20) } } });
  const r1 = await reg(member, devs.member);
  const r2 = await reg(lead, devs.lead);
  chk("①-열쇠·주소-막기", !!info.data?.publicKey && evil.status === 400 && r1.status === 200 && r2.status === 200,
      `공개 열쇠 ${info.data?.publicKey ? "있음" : "**없음**"} · 엉뚱한 주소 ${evil.status} · 등록 ${r1.status}/${r2.status}`);

  // ── ② ─────────────────────────────────────────────────────────
  reset();
  const t = await api(member, "POST", "/api/push/test");
  await sleep(400);
  const m0 = got.member[0];
  chk("②-암호문을-풀면-그-글", t.data?.sent === 1 && m0?.msg?.title === "알림이 켜졌습니다" && m0.enc === "aes128gcm" && /^vapid t=.+, ?k=/.test(m0.vapid),
      `보냄 ${t.data?.sent}/${t.data?.devices} · 푼 제목 "${m0?.msg?.title ?? m0?.msg?.error}" · 암호 ${m0?.enc} · 서명 ${m0?.vapid.slice(0, 12)}…`);

  // ── ③ ─────────────────────────────────────────────────────────
  reset();
  const c1 = await api(lead, "POST", "/api/tasks", { title: `${MARK} 맡긴 업무`, assigneeId: member.id });
  const c2 = await api(lead, "POST", "/api/tasks", { title: `${MARK} 내 업무였다가 넘김` });
  await api(lead, "PATCH", `/api/tasks/${c2.data?.id}`, { assigneeId: member.id });
  await sleep(500);
  const titles = got.member.map((g) => g.msg?.title ?? "");
  chk("③-맡기면-받는-사람에게만", got.member.length === 2 && titles.some((x) => x.includes("맡겼습니다")) && titles.some((x) => x.includes("넘겼습니다"))
      && got.member.some((g) => g.msg?.url === `/v3/tasks/${c1.data?.id}`) && got.lead.length === 0,
      `팀원 ${got.member.length}통 [${titles.join(" / ")}] · 팀장 ${got.lead.length}통`);

  // ── ④ ─────────────────────────────────────────────────────────
  reset();
  const mt = await api(lead, "POST", "/api/meetings", { title: `${MARK} 알림 회의` });
  await sleep(500);
  chk("④-회의-열면-연-사람-빼고", got.member.length === 1 && got.member[0].msg?.url === `/v3/room/${mt.data?.id}` && got.lead.length === 0,
      `팀원 ${got.member.length}통 "${got.member[0]?.msg?.title}" → ${got.member[0]?.msg?.url} · 연 사람 ${got.lead.length}통`);

  // ── ⑤ ─────────────────────────────────────────────────────────
  reset();
  const off = await api(member, "PATCH", "/api/push", { endpoint: devs.member.endpoint, kinds: ["due"] });
  await api(lead, "POST", "/api/tasks", { title: `${MARK} 꺼 둔 종류`, assigneeId: member.id });
  await api(lead, "POST", "/api/meetings", { title: `${MARK} 꺼 둔 회의` });
  await sleep(500);
  chk("⑤-끈-종류는-안-온다", off.status === 200 && got.member.length === 0, `종류 바꾸기 ${off.status} · 받은 것 ${got.member.length}통`);

  // ── ⑦ 아침 작업 ───────────────────────────────────────────────
  reset();
  const today = (await sql(`SELECT (now() AT TIME ZONE 'Asia/Seoul')::date::text d`))[0].d;
  await api(lead, "POST", "/api/tasks", { title: `${MARK} 오늘 마감`, assigneeId: member.id, dueDate: today });
  const cronHeaders = process.env.CRON_SECRET ? { authorization: `Bearer ${process.env.CRON_SECRET}` } : { "x-vercel-cron": "1" };
  const cron = await api(null, "GET", "/api/cron/team-watch", undefined, cronHeaders);
  await sleep(500);
  const due = got.member.find((g) => String(g.msg?.title ?? "").includes("오늘 마감"));
  chk("⑦-아침-마감-알림", cron.status === 200 && !!due && due.msg.url === "/v3/tasks?mine=1",
      `작업 ${cron.status} (pushed ${cron.data?.pushed}) · 받은 제목 "${due?.msg?.title ?? "없음"}"`);

  // ── ⑥ 죽은 기기 ───────────────────────────────────────────────
  answer = 410;
  await api(member, "POST", "/api/push/test");
  await sleep(400);
  answer = 201;
  const dead = (await sql(`SELECT disabled_at FROM push_subscription WHERE endpoint = $1`, [devs.member.endpoint]))[0];
  chk("⑥-410-이면-그-기기는-꺼진다", !!dead?.disabled_at, `disabled_at ${dead?.disabled_at ? "찍힘" : "**안 찍힘**"}`);

  // ── ⑧ 설치 파일 · 화면 ───────────────────────────────────────
  const man = await api(null, "GET", "/manifest.webmanifest");
  const sw = await fetch(`${BASE}/sw.js`, { redirect: "manual" });
  browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-proxy-server", "--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  await ctx.addCookies([{ name: "tb_session", domain: new URL(BASE).hostname, path: "/",
    value: tok({ id: member.id, actorId: member.id, name: member.nm, role: member.role, adminGrant: member.admin_grant, email: "x@x" }) }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { const ty = m.type(); if (ty === "error" || ty === "warning") errs.push(`[${ty}] ${m.text().slice(0, 160)}`); });
  await page.goto(`${BASE}/v3/me`, { waitUntil: "networkidle" });
  const card = await page.locator(".v3-card", { hasText: "알림 · 앱 설치" }).innerText().catch(() => "");
  const linked = await page.locator('link[rel="manifest"]').count();
  chk("⑧-설치-파일·화면", man.status === 200 && man.data?.start_url === "/v3/control" && man.data?.icons?.length === 2
      && sw.status === 200 && (sw.headers.get("content-type") ?? "").includes("javascript")
      && card.includes("이 기기에서 알림 켜기") && linked === 1 && errs.length === 0,
      `manifest ${man.status} · sw.js ${sw.status} · 카드 ${card.includes("이 기기에서 알림 켜기") ? "있음" : "없음"} · manifest 링크 ${linked} · 콘솔 ${errs.length}`);

  // ── ⑨ 브라우저 쪽 ────────────────────────────────────────────
  await ctx.grantPermissions(["notifications"], { origin: BASE });
  await page.evaluate(async () => { await navigator.serviceWorker.register("/sw.js", { scope: "/" }); await navigator.serviceWorker.ready; });
  const cdp = await ctx.newCDPSession(page);
  const regs = [];
  cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
  await cdp.send("ServiceWorker.enable");
  await sleep(500);
  const r = regs.find((x) => x.scopeURL.startsWith(new URL(BASE).origin) && !x.isDeleted);
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(BASE).origin, registrationId: r?.registrationId ?? "0",
    data: JSON.stringify({ title: `${MARK} 브라우저 알림`, body: "본문", url: "/v3/room", tag: "walk" }) }).catch(() => {});
  await sleep(800);
  const shown = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({ t: n.title, d: n.data })));
  chk("⑨-sw.js-가-알림을-띄운다", shown.some((n) => n.t === `${MARK} 브라우저 알림` && n.d?.url === "/v3/room"),
      `등록 ${r ? "있음" : "없음"} · 뜬 알림 [${shown.map((n) => n.t).join(" / ")}]`);

} catch (e) {
  fail++; console.log(`FAIL 실행 중 오류 ${e.message}`);
} finally {
  await browser?.close().catch(() => {});
  server.close();
  if (others.length) await sql(`UPDATE push_subscription SET disabled_at = NULL WHERE id = ANY($1)`, [others.map((o) => o.id)]).catch(() => {});
  await sql(`DELETE FROM push_subscription WHERE endpoint LIKE $1`, [`http://localhost:${PORT}/%`]).catch(() => {});
  await sql(`DELETE FROM activity_log WHERE task_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM notification WHERE ref_type = 'task' AND ref_id IN (SELECT id FROM task WHERE title LIKE $1 || '%')`, [MARK]).catch(() => {});
  await sql(`DELETE FROM task WHERE title LIKE $1 || '%'`, [MARK]).catch(() => {});
  await sql(`DELETE FROM meeting WHERE title LIKE $1 || '%'`, [MARK]).catch(() => {});
  await pool.end();
  console.log(`\n합계 ${pass + fail} · 통과 ${pass} · 실패 ${fail}`);
  process.exit(fail ? 1 : 0);
}
