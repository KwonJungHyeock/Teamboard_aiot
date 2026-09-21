// 콘솔에서 **안 세는 것** — 한 곳에 모은다 (MD-P-2026-061 §D-14 · 062 §A-2).
//
// ── 왜 한 파일인가 ────────────────────────────────────────────────
//
// 검사기마다 「이건 빼자」를 흩어 놓으면 서른 개 파일에 서른 개의 예외가 생기고,
// 그때부터 **경고를 센다는 말이 뜻을 잃는다.** 무엇을 안 보기로 했는지가
// 곧 무엇을 못 보는지다(§G 059). 그러니 한 곳에서, 세면서 자란다.
//
// ── 062 §A-2 가 붙인 조건 셋 ──────────────────────────────────────
//
//   1. **정확한 앞부분 문자열로만 맞춘다.** 정규식을 안 쓴다 — 그러니
//      `.*` · `.+` 를 적을 자리가 아예 없다. 넓은 그물은 우리 경고까지
//      같이 건져 올린다. 앞부분이 너무 짧아도 같은 일이 나므로 길이도 막는다.
//   2. **두 칸으로 나눈다.** 「우리 것이 아닌 것」과 「우리 것인데 아직 못
//      고친 것」. 둘째 칸은 **0건이어야 한다** — 줄이 생기면 보고에 올라온다.
//      무시 목록이 우리 결함이 숨는 곳이 되지 않게.
//   3. **매 실행마다 걸려 뺀 건수를 찍는다.** 뺀 것을 안 보이게 빼지 않는다.
//      이 숫자가 갑자기 뛰면 누가 그물을 넓힌 것이다.
//
// ── 줄을 더하는 규칙 ──────────────────────────────────────────────
//
//   · **이유 없는 줄은 넣지 않는다.** 「시끄러워서」는 이유가 아니다.
//   · 우리 코드가 낸 것은 첫 칸에 넣지 않는다. 고치거나, 둘째 칸에 넣고
//     보고에 올려 지시를 받는다.
//   · 검사기가 **스스로 만든** 오류(일부러 낸 404·400)는 **어느 칸에도**
//     넣지 않는다 — 그건 그 검사기 안에서 따로 세야 한다
//     (v3-bulk ③짝 · v3-detail ⑲ · v3-links ⑧짝 참고).
//     여기 넣으면 다른 검사기에서 난 진짜 404 까지 같이 눈감게 된다.

/** 검사기가 붙이는 말머리. 정규식이 아니라 **이 둘뿐**이다. */
const LEVEL_TAGS = ["[error] ", "[warning] "];

/** 앞부분이 이보다 짧으면 그물이 넓다고 본다. */
const MIN_PREFIX = 12;

/**
 * ── 첫 칸 · 우리 것이 아닌 것 ──────────────────────────────────
 * 브라우저·프레임워크가 내는 것. 고칠 자리가 우리 쪽에 없다.
 */
export const NOT_OURS = [
  {
    /*
     * 크롬이 내는 안내다. sticky/fixed 헤더가 있는 화면에서 `scrollIntoView`
     * 를 부르면 「가려질 수 있어 자동 스크롤을 건너뛴다」고 알린다. 동작은
     * 정상이고, sticky 헤더를 거두는 것은 설계를 되돌리는 일이다.
     * 처음 걸린 자리: agent-usage 2건 · open-due-screen 2건 · first-run 4건 ·
     * saved-view 3건 (060 전량 실행).
     */
    starts: "Skipping auto-scroll behavior due to",
    why: "크롬이 내는 안내 — sticky 헤더 + scrollIntoView. 우리 코드가 아니고 동작은 정상이다",
  },
  {
    /* 리액트가 개발 서버에서만 내는 개발도구 권유. 배포본에는 없다. */
    starts: "Download the React DevTools",
    why: "dev 서버에서만 나오는 리액트 안내 — 배포본에는 없다",
  },
  {
    /* Next dev 의 빠른 새로고침 안내. 코드를 고치면 나온다. */
    starts: "[Fast Refresh]",
    why: "Next dev 의 빠른 새로고침 안내 — 배포본에는 없다",
  },
];

/**
 * ── 둘째 칸 · 우리 것인데 아직 못 고친 것 ──────────────────────
 *
 * **비어 있어야 한다.** 여기 줄이 생기면 그 회차 보고에 목록으로 올린다.
 * 「나중에 고친다」를 적는 곳이지 「없던 일로 한다」를 적는 곳이 아니다.
 */
export const OURS_NOT_FIXED = [];

/** 두 칸을 합친 것. */
export const IGNORED_CONSOLE = [...NOT_OURS, ...OURS_NOT_FIXED];

// 조건 1 을 **들여오는 순간** 강제한다. 검사기가 돌기 전에 터져야
// 넓은 그물이 한 번이라도 쓰이는 일이 없다.
for (const r of IGNORED_CONSOLE) {
  if (typeof r.starts !== "string" || r.starts.length < MIN_PREFIX)
    throw new Error(`무시 목록: 앞부분이 너무 짧다 (${MIN_PREFIX}자 이상) — ${JSON.stringify(r.starts)}`);
  if (!r.why || !r.why.trim())
    throw new Error(`무시 목록: 이유 없는 줄은 넣지 않는다 — ${r.starts}`);
}

/** 조건 3 — 무엇이 몇 번 걸렸는지. 실행이 끝날 때 한 줄로 찍는다. */
const tally = new Map();

/**
 * 이 줄을 무시하기로 했는가. 무시하면 **왜 무시하는지**를 돌려준다.
 *
 * 불리언이 아니라 이유를 돌려주는 이유: 부르는 쪽이 「무시 3건」이 아니라
 * 「무엇을 왜 3건 무시했는지」를 찍을 수 있어야 한다.
 */
export function ignoredWhy(text) {
  if (typeof text !== "string") return null;
  let body = text;
  for (const tag of LEVEL_TAGS) if (body.startsWith(tag)) { body = body.slice(tag.length); break; }
  for (const r of IGNORED_CONSOLE) {
    if (!body.startsWith(r.starts)) continue;
    tally.set(r.starts, (tally.get(r.starts) ?? 0) + 1);
    return r.why;
  }
  return null;
}

/** 지금까지 걸려 뺀 건수. 검사기가 제 합계 줄 옆에 쓰고 싶으면 이것을 쓴다. */
export function ignoredCount() {
  let n = 0;
  for (const v of tally.values()) n += v;
  return n;
}

export function ignoredReport() {
  const n = ignoredCount();
  const per = [...tally.entries()].map(([k, v]) => `${k.slice(0, 34)} ${v}건`).join(" · ");
  return `무시 목록 — 걸려 뺀 줄 ${n}건${n ? ` [${per}]` : ""}` +
         ` · 목록 ${NOT_OURS.length}줄(우리 것 아님) + ${OURS_NOT_FIXED.length}줄(우리 것인데 못 고침)`;
}

/*
 * 조건 3 은 **부르는 쪽이 잊어도** 지켜져야 한다. 검사기마다 「찍어 주세요」를
 * 부탁하면 하나가 빠지고, 빠진 그 하나가 그물이 넓어지는 자리가 된다.
 * 그래서 이 파일을 들여온 실행은 끝날 때 반드시 한 줄을 남긴다.
 */
process.on("exit", () => { console.log(ignoredReport()); });
