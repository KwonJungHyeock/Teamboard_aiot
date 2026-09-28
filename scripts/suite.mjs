// 전량 실행기 — **첫 판이 정본이 되게** (MD-P-2026-068 §B).
//
//   node scripts/suite.mjs --probe      서버 하나로 전부 돌리며 매 검사 뒤 서버 상태를 찍는다(재는 판)
//   node scripts/suite.mjs              SUITE_EVERY 개마다 서버를 새로 띄우며 돈다(보통 판)
//
//   SUITE_EVERY     몇 개마다 서버를 새로 띄우나      (재서 정한 값 — 아래 EVERY 참조)
//   SUITE_LOGIN_MS  /login 응답이 이보다 느리면 「못 쟀다」 (재서 정한 값 — 아래 SLOW_MS 참조)
//   SUITE_ONLY      쉼표로 이름 몇 개만               (예: v3-tasks-walk,denied-walk)
//   SUITE_OUT       결과를 적을 폴더                   (기본: 시스템 임시 폴더)
//
// ── 왜 이 파일이 생겼나 ──────────────────────────────────────────
//
// 065 · 067 첫 판 · 067 다시 판 — **세 번** 같은 모양이었다. 개발 서버 하나로
// 수십 개를 돌리면 뒤쪽에서 주소가 안 담기고(`?sort=null`) `/login` 이 5초가 되고,
// 서버를 새로 띄우면 열 개가 초록이 된다. 첫 판 빨강 열여섯 중 열이 가짜였고,
// **어느 열인지는 사람이 매번 판단했다.** 그 판단이 한 번 틀리면 진짜 빨강을
// 가짜로 넘긴다.
//
// 같은 일이 세 번 났으면 우연이 아니다 — 그 일을 고치지 말고 **그 일이 나는 자리**를
// 고친다. 자리는 「서버 하나로 끝까지 돈다」이다.
//
// ── 세 가지를 한다 ──────────────────────────────────────────────
//
//   ① **나눠 띄운다.** EVERY 개마다 서버를 새로 띄운다. 그 수는 `--probe` 로 재서 정했다
//   ② **스스로 알아챈다.** 검사 앞뒤로 `/login` 을 재서 기준치를 넘으면 그 판을
//      「못 쟀다」로 가른다. 「안 된다(빨강)」와 「못 쟀다」는 다른 값이다
//   ③ **든 시간을 적는다.** 새로 띄우는 데 몇 초가 드는지, 전량이 몇 분인지
//
// ── 무엇을 검사기로 치는가 ──────────────────────────────────────
//
// 이름으로 고른다 — `*-walk` · `*-audit` · `*-probe` · `repro-*` · `member-boundary`.
// 옛 러너는 「단언이 있어 보이는 파일」을 다 돌려서 **조사용 스크립트 둘**
// (`a3-orphan-tasks` 읽기 조사 · `md024-purge-demo` 데모 삭제 — 드라이런이 기본이라
// 지운 것은 없었다)이 섞여 있었다. 데이터를 지우는 스크립트가 전량에 끼면 안 된다.
//
// **로컬 전용.** 각 검사기가 제 안에서 `requireLocalDb` 로 막는다.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const BASE = "http://127.0.0.1:3000";
const PROBE = process.argv.includes("--probe");

/**
 * 몇 개마다 새로 띄우나 — **068 §B-4 에서 재서 정했다.** 짐작한 값이 아니다.
 * 근거는 `docs/068-전량실행기.md` 의 재는 판 표다.
 */
const EVERY = Number(process.env.SUITE_EVERY ?? 0) || null;   // 재기 전에는 비워 둔다
/** `/login` 이 이보다 느리면 그 판은 「못 쟀다」. 근거는 같은 문서. */
const SLOW_MS = Number(process.env.SUITE_LOGIN_MS ?? 1500);
const ONLY = (process.env.SUITE_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = process.env.SUITE_OUT ?? path.join(os.tmpdir(), "teamboard-suite");
fs.mkdirSync(OUT, { recursive: true });

const env = { ...process.env };
for (const line of fs.readFileSync(path.join(REPO, ".env.local"), "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && env[m[1]] === undefined) env[m[1]] = m[2];
}

/* ── 검사기 고르기 ─────────────────────────────────────────────── */
const IS_CHECKER = /(-walk|-audit|-probe)\.mjs$|^repro-.*\.mjs$|^member-boundary\.mjs$/;
let checkers = fs.readdirSync(path.join(REPO, "scripts")).filter((f) => IS_CHECKER.test(f)).sort();
/*
 * **은퇴한 검사기** — 머리(앞 40줄)에 `// ── 은퇴 ──` 줄이 있는 파일. 전량에서 뺀다.
 * 068 §C-3 에서 처음 생겼다(`repro-0033` · `repro-0035`). 이유는 각 파일 머리에 있다.
 * 조용히 빠지면 빠진 줄 모른다 — **뺀 수와 이름을 매 판 찍는다.**
 */
const RETIRED = /^\/\/ ── 은퇴 ──/m;
const retired = checkers.filter((f) =>
  RETIRED.test(fs.readFileSync(path.join(REPO, "scripts", f), "utf8").split("\n").slice(0, 40).join("\n")));
checkers = checkers.filter((f) => !retired.includes(f));
if (ONLY.length) checkers = checkers.filter((f) => ONLY.includes(f.replace(/\.mjs$/, "")));
console.log(`검사기 ${checkers.length}개 · 은퇴 ${retired.length}개` +
            `${retired.length ? ` (${retired.map((f) => f.replace(/\.mjs$/, "")).join(" · ")} — 이유는 각 파일 머리)` : ""}`);

/* ── 서버 ─────────────────────────────────────────────────────── */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `/login` 한 번의 응답 시간(ms). 못 받으면 `Infinity`. */
async function loginMs() {
  const t = Date.now();
  try {
    const r = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(20000) });
    await r.arrayBuffer();
    return r.ok ? Date.now() - t : Infinity;
  } catch { return Infinity; }
}
/** 세 번 재서 가운데 값 — 한 번 튄 것으로 판정하지 않는다. */
async function health() {
  const xs = [await loginMs(), await loginMs(), await loginMs()].sort((a, b) => a - b);
  return xs[1];
}
/**
 * 3000 번에서 듣는 프로세스들. **이름으로 찾지 않는다** — `pkill -f next` 가
 * 제 셸까지 죽인 적이 두 번 있다. 포트로 찾는다.
 *
 * `lsof` · `ss` 를 쓰지 않는다 — 이 컨테이너에서는 둘 다 **빈 값**을 돌려준다(068 에서
 * 겪었다: 3000 을 누가 잡고 있는데 `lsof` 는 없다고 했고, 새 서버가 조용히 3001 로
 * 떠서 재는 값이 전부 ∞ 가 됐다). 커널 표 `/proc/net/tcp` 에서 소켓 번호를 찾고,
 * `/proc/<pid>/fd` 에서 그 소켓을 쥔 프로세스를 찾는다.
 */
function portPids(port = 3000) {
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();
  for (const f of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let text = "";
    try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
    for (const line of text.split("\n").slice(1)) {
      const c = line.trim().split(/\s+/);
      if (c.length > 9 && c[1].endsWith(`:${hex}`) && c[3] === "0A") inodes.add(c[9]);   // 0A = LISTEN
    }
  }
  if (!inodes.size) return [];
  const pids = [];
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d) || Number(d) === process.pid) continue;
    let fds = [];
    try { fds = fs.readdirSync(`/proc/${d}/fd`); } catch { continue; }
    for (const fd of fds) {
      let link = "";
      try { link = fs.readlinkSync(`/proc/${d}/fd/${fd}`); } catch { continue; }
      const m = /^socket:\[(\d+)\]$/.exec(link);
      if (m && inodes.has(m[1])) { pids.push(Number(d)); break; }
    }
  }
  return pids;
}
/** 서버를 쥔 프로세스와 그 **부모 `next dev`** 까지 — 자식만 죽이면 부모가 다시 띄운다. */
function serverTree(pids) {
  const out = new Set(pids);
  for (const pid of pids) {
    try {
      const ppid = Number(fs.readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ")[1]);
      const cmd = fs.readFileSync(`/proc/${ppid}/cmdline`, "utf8");
      if (cmd.includes("next/dist/bin/next")) out.add(ppid);
    } catch { /* 이미 없다 */ }
  }
  return [...out];
}
/** 서버 메모리(MB) — 느려지는 것과 같이 가는지 보려고 찍는다. */
function rssMb() {
  const pid = portPids()[0];
  if (!pid) return null;
  try {
    const kb = Number(fs.readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)?.[1]);
    return Math.round(kb / 1024);
  } catch { return null; }
}

let serverLog = null;
async function stopServer() {
  for (const pid of serverTree(portPids())) { try { process.kill(pid, "SIGTERM"); } catch { /* 이미 없다 */ } }
  for (let i = 0; i < 40 && portPids().length; i++) await sleep(250);
  for (const pid of serverTree(portPids())) { try { process.kill(pid, "SIGKILL"); } catch { /* 이미 없다 */ } }
  for (let i = 0; i < 20 && portPids().length; i++) await sleep(250);
  // 그래도 남아 있으면 **여기서 멈춘다.** 새 서버가 3001 로 떠서 ∞ 를 재는 것보다 낫다.
  if (portPids().length) throw new Error(`3000 번을 놓지 않는 프로세스: ${portPids().join(",")}`);
}
/**
 * 새로 띄운다. **`.next` 는 지우지 않는다** — 컴파일 캐시가 남아 있어야 새로 띄우는
 * 값이 싸다(§B-7). 느려지는 원인이 캐시가 아니라 프로세스라는 것은 재는 판에서 봤다
 * (문서 참조).
 * 돌려주는 값은 **띄우는 데 든 ms** — 첫 `/login` 200 까지와 데우기까지를 따로.
 */
async function startServer(tag) {
  await stopServer();
  const t0 = Date.now();
  const logPath = path.join(OUT, `server-${tag}.log`);
  serverLog = fs.openSync(logPath, "w");
  // 포트를 **박는다**(`-p 3000`). 안 박으면 3000 이 차 있을 때 조용히 옆 번호로 뜬다.
  const child = spawn(process.execPath, [path.join(REPO, "node_modules/next/dist/bin/next"), "dev", "-p", "3000"],
    { cwd: REPO, env, detached: true, stdio: ["ignore", serverLog, serverLog] });
  child.unref();
  let ok = false;
  for (let i = 0; i < 240 && !ok; i++) {
    ok = (await loginMs()) !== Infinity;
    if (!ok) {
      if (child.exitCode !== null) break;
      await sleep(500);
    }
  }
  if (!ok) throw new Error(`서버가 안 떴다 — ${logPath} 를 볼 것`);
  const up = Date.now() - t0;
  await warm();
  return { up, warm: Date.now() - t0 - up };
}
/**
 * 데운다 — 처음 여는 화면은 dev 서버가 그 자리에서 컴파일한다. 검사 도중에 첫
 * 컴파일이 걸리면 「RSC payload 를 못 받았다」 같은 **컴파일 경합**이 콘솔에 찍혀
 * 빨강이 된다(067 에서 두 번 봤다). 검사 앞에 한 번씩 열어 둔다.
 */
async function warm() {
  const tok = mintAdmin();
  const hit = (u) => fetch(`${BASE}${u}`, { headers: { cookie: `tb_session=${tok}` }, redirect: "manual",
    signal: AbortSignal.timeout(60000) }).then((r) => r.arrayBuffer()).catch(() => null);
  for (const u of ["/", "/tasks", "/goals", "/projects", "/calendar", "/open-due", "/members",
                   "/settings", "/signals", "/notes", "/activity", "/api/tasks", "/api/goals"]) await hit(u);
  // v3 화면은 스위치가 켜져야 컴파일된다. **켰다가 원래대로** 되돌린다.
  const before = sql(`SELECT value FROM config WHERE key='ui_v3_enabled'`);
  sql(`INSERT INTO config (key, value) VALUES ('ui_v3_enabled', to_jsonb(true))
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  try {
    for (const u of ["/v3", "/v3/tasks", "/v3/goals", "/v3/members", "/v3/me", "/v3/team",
                     "/v3/stats", "/v3/new", "/v3/not-yet", "/v3/calendar"]) await hit(u);
  } finally {
    if (before === "") sql(`DELETE FROM config WHERE key='ui_v3_enabled'`);
    else sql(`UPDATE config SET value = '${before}'::jsonb WHERE key='ui_v3_enabled'`);
  }
}
function sql(q) {
  return execFileSync("psql", [env.DATABASE_URL, "-At", "-c", q], { encoding: "utf8" }).trim();
}
function mintAdmin() {
  const id = Number(sql(`SELECT a.actor_id FROM account a JOIN actor ac ON ac.id=a.actor_id
                         WHERE ac.is_active AND (a.role='admin' OR a.admin_grant) ORDER BY 1 LIMIT 1`));
  const body = Buffer.from(JSON.stringify({ id, actorId: id, name: "suite", role: "admin", adminGrant: true,
    email: "suite@local", exp: Math.floor(Date.now() / 1000) + 6 * 3600 })).toString("base64url");
  const sig = execFileSync(process.execPath, ["-e",
    `process.stdout.write(require("crypto").createHmac("sha256", process.env.AUTH_SECRET).update(${JSON.stringify(body)}).digest("base64url"))`],
    { env, encoding: "utf8" });
  return `${body}.${sig}`;
}

/* ── 검사기 하나 ─────────────────────────────────────────────── */
function runOne(file) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let out = "";
    const child = spawn(process.execPath, [path.join("scripts", file)], { cwd: REPO, env });
    const kill = setTimeout(() => child.kill("SIGKILL"), 700_000);
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    child.on("close", (code) => {
      clearTimeout(kill);
      resolve({ code: code ?? 124, out, secs: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

/* ── 본판 ─────────────────────────────────────────────────────── */
const rows = [];
const restarts = [];
const t0 = Date.now();
let sinceStart = 0;
restarts.push({ at: 0, ...(await startServer("0")) });

for (let i = 0; i < checkers.length; i++) {
  const file = checkers[i];
  const name = file.replace(/\.mjs$/, "");
  if (!PROBE && EVERY && sinceStart >= EVERY) {
    restarts.push({ at: i, ...(await startServer(String(i))) });
    sinceStart = 0;
  }
  const before = await health();
  const r = await runOne(file);
  const after = await health();
  const fails = (r.out.match(/^\s*FAIL/gm) ?? []).length;
  const red = r.code !== 0 || fails > 0;
  /*
   * 「못 쟀다」 — 검사 **앞이나 뒤**에서 서버가 기준치보다 느렸고 결과가 빨강이면.
   * 초록은 느린 서버에서도 초록이다(단언이 다 통과했다). 거짓 빨강만 가른다.
   */
  const sick = Math.max(before, after) > SLOW_MS;
  const verdict = !red ? "초록" : sick ? "못 쟀다" : "빨강";
  const row = { i: i + 1, name, verdict, code: r.code, fails, secs: r.secs,
                beforeMs: before, afterMs: after, rss: rssMb(),
                first: (r.out.match(/^\s*FAIL.*$/m)?.[0] ?? (r.code ? (r.out.match(/(예외|넘어졌다|Error)[^\n]*/)?.[0] ?? "") : "")).slice(0, 180) };
  rows.push(row);
  sinceStart += 1;
  console.log(`${String(row.i).padStart(2)} ${verdict.padEnd(4)} ${name.padEnd(28)} ${String(r.secs).padStart(4)}s` +
              `  login ${before === Infinity ? "∞" : before}→${after === Infinity ? "∞" : after}ms  rss ${row.rss ?? "?"}MB` +
              `${red ? `  │ ${row.first}` : ""}`);
  // 못 쟀으면 **바로** 새로 띄운다. 느린 서버로 다음 것까지 재면 못 쟀다가 번진다.
  if (!PROBE && sick) { restarts.push({ at: i + 1, reason: "느려짐", ...(await startServer(`sick${i}`)) }); sinceStart = 0; }
}
await stopServer();

const total = Math.round((Date.now() - t0) / 1000);
const count = (v) => rows.filter((r) => r.verdict === v).length;
const summary = {
  mode: PROBE ? "probe" : "normal", every: EVERY, slowMs: SLOW_MS, total, checkers: rows.length,
  retired: retired.map((f) => f.replace(/\.mjs$/, "")),
  green: count("초록"), red: count("빨강"), unmeasured: count("못 쟀다"),
  restarts: restarts.map((r) => ({ at: r.at, reason: r.reason ?? "정기", upMs: r.up, warmMs: r.warm })),
};
fs.writeFileSync(path.join(OUT, `suite-${PROBE ? "probe" : "normal"}.json`), JSON.stringify({ summary, rows }, null, 2));
console.log(`\n합계 ${rows.length} · 초록 ${summary.green} · 빨강 ${summary.red} · 못 쟀다 ${summary.unmeasured}` +
            ` · 새로 띄움 ${restarts.length}번(평균 ${Math.round(restarts.reduce((s, r) => s + r.up + r.warm, 0) / restarts.length / 1000)}초)` +
            ` · 전량 ${Math.floor(total / 60)}분 ${total % 60}초`);
console.log(`빨강: ${rows.filter((r) => r.verdict === "빨강").map((r) => r.name).join(" · ") || "없음"}`);
console.log(`못 쟀다: ${rows.filter((r) => r.verdict === "못 쟀다").map((r) => r.name).join(" · ") || "없음"}`);
console.log(`은퇴(안 돌렸다): ${summary.retired.join(" · ") || "없음"}`);
console.log(`결과 파일: ${path.join(OUT, `suite-${PROBE ? "probe" : "normal"}.json`)}`);
