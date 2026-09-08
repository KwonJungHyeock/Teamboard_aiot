// 카운트다운 계산 검사 (MD-P-2026-033 §A) — **순수 함수라 조건을 만들어 부른다.**
//
// DB 도 브라우저도 필요 없다. `lib/countdown.ts` 가 `now` 를 인자로 받게 만든 값이
// 여기서 나온다 — 「오픈 1초 전」을 보려고 시스템 시계를 돌리지 않아도 된다.
//
//   node scripts/countdown-walk.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const REPO = process.cwd();
const OUT = path.join(REPO, ".cd-walk-out");

let pass = 0, fail = 0;
const ok = (n, c, d = "") => {
  if (c) { pass++; console.log(`OK   ${n}${d ? ` — ${d}` : ""}`); }
  else { fail++; console.log(`FAIL ${n}${d ? ` — ${d}` : ""}`); }
};

const T = (iso) => Date.parse(iso);

try {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  execFileSync(path.join(REPO, "node_modules", ".bin", "tsc"),
    [path.join(REPO, "lib", "countdown.ts"), "--outDir", OUT,
     "--module", "commonjs", "--moduleResolution", "node", "--target", "es2022",
     "--skipLibCheck", "--esModuleInterop"], { stdio: "inherit" });
  const req = createRequire(path.join(OUT, "noop.cjs"));
  const { remainUntil, dDay, pad2 } = req(path.join(OUT, "countdown.js"));

  const OPEN = T("2026-11-02T00:00:00+09:00");

  // ── ① 자료의 D-55 가 그대로 나오는가 ────────────────────────────
  // 자료 기준일 2026-09-08 · 목표 11-02 · **D-55**.
  // 근무 시간대(09:00 KST)로 잡는다 — 자정에만 맞는 계산이면 하루 종일 틀린다.
  const nowWork = T("2026-09-08T09:00:00+09:00");
  ok("① 자료의 D-55 와 같다", dDay(OPEN, nowWork) === 55, `D-${dDay(OPEN, nowWork)}`);

  // ── ② 그런데 남은 밀리초로 나누면 54 다 — **그래서 따로 센다** ──
  // 이 단언이 없으면 왜 `dDay` 를 따로 만들었는지 다음 사람이 모른다.
  const naive = Math.floor(remainUntil(OPEN, nowWork).totalMs / 86400000);
  ok("② 밀리초를 나누면 하루 어긋난다 (달력으로 세는 이유)", naive === 54,
     `단순 나눗셈 ${naive}일 · 달력 ${dDay(OPEN, nowWork)}일`);

  // ── ③ 하루 안에서 D 값이 안 흔들린다 ────────────────────────────
  // 짝이 되는 단언. ①만 보면 「그 시각에만 맞는」 계산과 구분이 안 된다.
  const sameDay = ["00:00", "09:00", "13:37", "23:59"].map(
    (hm) => dDay(OPEN, T(`2026-09-08T${hm}:00+09:00`))
  );
  ok("③ 같은 날이면 몇 시든 같은 D 값", new Set(sameDay).size === 1,
     `[${sameDay.join(", ")}]`);

  // ── ④ 경계 — 오픈 직전·정각·직후 ────────────────────────────────
  const before1s = remainUntil(OPEN, OPEN - 1000);
  ok("④ 1초 전은 아직 안 지났다", before1s.past === false && before1s.seconds === 1,
     `past ${before1s.past} · ${before1s.seconds}초`);
  const at0 = remainUntil(OPEN, OPEN);
  ok("④ 정각은 **지난 것으로** 센다", at0.past === true, `past ${at0.past}`);
  const after = remainUntil(OPEN, OPEN + 5000);
  ok("④ 지난 뒤 조각은 전부 0 이다",
     after.past && after.days === 0 && after.hours === 0 && after.minutes === 0 && after.seconds === 0,
     JSON.stringify(after));

  // ── ⑤ 지난 뒤 D 는 음수다 — 「지났다」와 「오늘이다」가 다르다 ───
  ok("⑤ 오픈 당일 D-DAY (0)", dDay(OPEN, T("2026-11-02T13:00:00+09:00")) === 0,
     `D-${dDay(OPEN, T("2026-11-02T13:00:00+09:00"))}`);
  ok("⑤ 하루 지나면 -1", dDay(OPEN, T("2026-11-03T00:30:00+09:00")) === -1,
     `${dDay(OPEN, T("2026-11-03T00:30:00+09:00"))}`);

  // ── ⑥ 조각이 실제로 합쳐서 맞는가 ───────────────────────────────
  // 「일·시·분·초」를 따로 내는 계산은 어느 하나가 틀려도 그럴듯해 보인다.
  // 되짚어 더해서 원래 밀리초가 나오는지 본다.
  const r = remainUntil(OPEN, T("2026-09-08T09:12:34+09:00"));
  const back = ((r.days * 24 + r.hours) * 60 + r.minutes) * 60 + r.seconds;
  ok("⑥ 조각을 되짚어 더하면 원래 값이다",
     back === Math.floor(r.totalMs / 1000),
     `${back}초 vs ${Math.floor(r.totalMs / 1000)}초`);

  // ── ⑦ 자릿수 ────────────────────────────────────────────────────
  ok("⑦ 한 자리는 0 을 채운다", pad2(9) === "09" && pad2(0) === "00", `${pad2(9)} · ${pad2(0)}`);
  ok("⑦ 음수는 0 으로 (숫자가 뒤집혀 보이지 않는다)", pad2(-3) === "00", pad2(-3));

  // ── ⑧ 시간대 — 서버가 UTC 여도 KST 로 센다 ──────────────────────
  // 컨테이너 TZ 가 UTC 라 이걸 안 보면 로컬에서만 맞는 계산을 배포하게 된다.
  // 11-02 00:00 KST 는 11-01 15:00 UTC 다. UTC 로 세면 D-1 이 어긋난다.
  const eveKst = T("2026-11-01T23:00:00+09:00");   // KST 로 하루 전
  ok("⑧ TZ 가 UTC 인 서버에서도 KST 달력으로 센다", dDay(OPEN, eveKst) === 1,
     `D-${dDay(OPEN, eveKst)} (process.env.TZ=${process.env.TZ ?? "미설정"})`);

  console.log("");
  console.log(`${pass}/${pass + fail} 통과`);
  if (fail) process.exitCode = 1;
} catch (e) {
  console.error(String(e && e.stack ? e.stack : e));
  process.exitCode = 1;
} finally {
  rmSync(OUT, { recursive: true, force: true });
}
