// 아직 안 여는 화면 — **한 파일에 모은다** (MD-P-2026-066 §B · 067 §A-3).
//
// ── 「없는 것」과 「아직 안 여는 것」은 다른 말이다 (§B-5) ────────
//
// 404 는 「그런 자리가 없다」는 뜻이다. 여기 적힌 것들은 **있고, 만들고 있고,
// 날짜가 정해져 있다.** 404 를 쓰면 읽는 사람이 자기가 주소를 잘못 친 줄 알거나
// 프로그램이 고장 난 줄 안다 — 둘 다 사실이 아니다.
//
// ── `lib/denied.ts` 의 짜임을 그대로 쓴다 (§B-7) ────────────────
//
// 새 방법을 만들지 않는다. 거기와 같은 네 조각이다: 열쇠 타입 · 문구 표 ·
// href 만들개 · **모르는 열쇠면 `null` 인 읽개**(주소는 사람이 손으로 고칠 수
// 있고, 거기 적힌 것을 화면에 옮기면 남이 써 준 문장을 우리 목소리로 읽게 된다).
//
// ── 목록이 067 §0-2 로 채워졌다 ─────────────────────────────────
//
// 066 에서는 지시서 §1 이 잘려 와서 **이름을 대고 시킨 둘**(내 정보·설정)만
// 넣어 뒀다. 067 §0-2 가 아홉과 「미룬 것」을 줬으므로 이제 전수로 채운다.
//
// **아홉 밖의 v3 주소는 목록에 없어도 막힌다** — 뿌리(`app/v3/layout.tsx`)가
// `isNine()` 으로 한 번에 막는다(§0-2). 이 목록은 **이름과 문구가 필요한 곳**,
// 즉 레일에 자물쇠로 서거나 옛 주소로 들어올 수 있는 곳이다.
//
// ── 푸는 일이 **한 줄 지우기**여야 한다 (§B-10) ─────────────────
//
// 화면이 서면 이 배열에서 그 줄을 지운다. 그러면 레일 자물쇠 · 옛 주소 막기 ·
// 검사의 「막혀 있다」가 **함께** 풀린다. 자리가 흩어져 있으면 하나만 풀고 둘을
// 잊는다. 067 에서 `profile` 을 지운 것이 그 첫 예다 — 내 정보(`/v3/me`)가 섰다.
import { V3_BASE } from "./routes";

export interface NotYetScreen {
  key: string;
  /** 사람이 부르는 이름. 레일과 막음 화면이 같은 낱말을 쓴다 */
  label: string;
  /** ① 무엇인지 — 한 문장 */
  what: string;
  /**
   * 옛 주소. **주소로 직접 들어와도 막으려면** 이게 있어야 한다 (§B-9).
   * 없는 것(`null`)은 옛 화면이 따로 없거나 막을 필요가 없는 것이다.
   */
  old: string | null;
  /** `old` 로 **시작하는** 주소까지 막는다 (`/projects/7` · `/areas/rnd`) */
  prefix?: boolean;
}

/**
 * ② 표. **줄을 지우면 그 화면이 열린다.**
 *
 * 순서는 067 §0-2 의 「가오픈 뒤로 미룬 것」 차례 그대로다 — 지시서와 대조할 때
 * 눈으로 짚을 수 있어야 한다.
 */
export const NOT_YET: NotYetScreen[] = [
  { key: "calendar", label: "캘린더", old: "/calendar",
    what: "달과 주로 업무를 보는 자리입니다. 주 보기가 아직 없어 반쪽입니다." },
  { key: "projects", label: "프로젝트", old: "/projects", prefix: true,
    what: "프로젝트 목록과 프로젝트 작업실입니다." },
  { key: "signals", label: "시그널", old: "/signals",
    what: "결정 · 검토 · 메모 · 위험을 모아 두는 자리입니다." },
  { key: "inbox", label: "승인 인박스", old: "/inbox",
    what: "에이전트가 제안한 업무를 승인하거나 반려하는 자리입니다." },
  { key: "activity", label: "활동", old: "/activity",
    what: "누가 무엇을 바꿨는지 쌓이는 자리입니다." },
  { key: "huddle", label: "허들룸", old: "/huddle",
    what: "함께 보며 리뷰하는 자리입니다." },
  { key: "reports", label: "보고", old: "/reports",
    what: "성과 리포트와 승인 보고서를 만드는 자리입니다." },
  { key: "handover", label: "인수인계", old: "/handover",
    what: "인계 문서를 만들고 넘기는 자리입니다." },
  { key: "saved", label: "저장한 보기", old: "/saved",
    what: "자주 쓰는 조건을 저장해 두는 자리입니다." },
  { key: "notes", label: "메모", old: "/notes",
    what: "혼자 적어 두는 자리입니다." },
  { key: "status", label: "시스템 상태", old: "/status",
    what: "연결과 러너가 살아 있는지 보는 자리입니다." },
  { key: "areas", label: "영역", old: "/areas", prefix: true,
    what: "영역 하나를 펼쳐 보는 자리입니다." },
  { key: "open-due", label: "가오픈 기한", old: "/open-due",
    what: "가오픈 날짜를 기준으로 기한을 모아 보는 자리입니다." },
  /*
   * 설정은 0-2 의 목록에 없지만 **가오픈 뒤다**(066 §B-11 · 067 §D-23).
   * 목록에서 빼면 레일의 자물쇠가 사라지고, 사라진 자리는 아무도 안 찾는다.
   */
  { key: "settings", label: "설정", old: "/settings",
    what: "팀 전체에 걸리는 값을 정하는 자리입니다." },
  /*
   * 074 §B — 켠 뒤에도 옛 화면이 뜨던 **유일한 자리**였다(073 §C 실측 · 관리자 200).
   * 「v3 안에서 옛 화면이 열리는 자리 0개」(066 §B-13)가 전면 전환의 숫자라 한 줄 더한다.
   * **에이전트를 철거할 때 이 줄을 지운다**(BACKLOG 에이전트 철거 줄에 적었다).
   */
  { key: "agent-usage", label: "에이전트 사용량", old: "/admin/agent-usage",
    what: "에이전트를 철거하기 전에 흔적을 세어 두는 자리입니다." },
];

/** ② 「언제 열리는지」 (§B-6). **한 곳에서** 온다 — 날짜가 바뀌면 여기만 고친다. */
export const NOT_YET_WHEN = "11월 2일 가오픈 뒤에 엽니다.";

/**
 * ② 「돌아갈 길 하나」 (§B-6). **읽는 사람이 할 수 있는 게 있어야 한다.**
 *
 * 길이 하나인 이유: 둘을 내면 어느 쪽이 「원래 가려던 곳」인지 사람이 고민한다.
 * 로그인한 누구나 볼 수 있는 화면으로 보낸다 — `lib/denied.ts` 가 팀 홈을 고른
 * 것과 같은 판단이다.
 */
export const NOT_YET_BACK = { label: "대시보드로", href: V3_BASE };

/** ③ 막는 자리가 부른다. */
export function notYetHref(key: string): string {
  return `${V3_BASE}/not-yet?k=${key}`;
}

/** ④ 도착한 화면이 부른다. **모르는 열쇠면 `null`** — 아무 말도 안 만든다. */
export function notYetOf(key: string | null | undefined): NotYetScreen | null {
  if (!key) return null;
  return NOT_YET.find((s) => s.key === key) ?? null;
}

/**
 * 옛 주소가 막혀 있는가 (§B-9).
 *
 * **레일에서 빼는 것만으로는 안 막힌다** — 주소창에 치면 그대로 열린다.
 * 옛 셸이 이 함수로 한 번 더 묻는다. 긴 것부터 봐서 `/projects/7` 이
 * `/projects` 에 걸리게 한다.
 */
export function notYetForOld(path: string): NotYetScreen | null {
  const clean = path.split("?")[0].replace(/\/+$/, "") || "/";
  return [...NOT_YET]
    .filter((s) => s.old !== null)
    .sort((a, b) => (b.old as string).length - (a.old as string).length)
    .find((s) => (s.prefix ? clean === s.old || clean.startsWith(`${s.old}/`) : clean === s.old))
    ?? null;
}
