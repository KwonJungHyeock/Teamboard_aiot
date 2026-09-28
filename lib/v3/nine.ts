// 가오픈에 여는 **아홉**과 레일 세 묶음 (MD-P-2026-067 §0-2 · §0-4).
//
// ── 왜 한 파일인가 ──────────────────────────────────────────────
//
// 「이 아홉 밖의 v3 주소는 전부 막음 화면으로 간다」(§0-2)를 지키려면
// **아홉이 무엇인지 아는 자리가 하나**여야 한다. 레일이 제 목록을 들고 뿌리가
// 또 제 목록을 들면, 하나만 고쳐진 날 **레일에 없는데 열리는 화면**이나
// **레일에 있는데 막히는 화면**이 생긴다 — 둘 다 눌러 보기 전엔 안 보인다.
//
// 그래서 여기 하나에서 셋이 나온다:
//   ① `NINE`      — 여는 아홉. 뿌리(`app/v3/layout.tsx`)가 이걸로 막는다
//   ② `RAIL`      — 레일 세 묶음. 자물쇠도 여기서 붙는다
//   ③ `isNine()`  — 주소 하나가 아홉에 드는가
//
// ── 아홉 (§0-2 · §0-4 의 레일에서 그대로) ───────────────────────
//
//   1 대시보드   2 업무 목록   3 업무 상세   4 새 업무   5 목표
//   6 집계       7 팀         8 구성원      9 내 정보
//
// 「내 업무」는 **화면이 아니다** — 업무 목록에 `?mine=1` 을 붙인 자리다
// (066 §B-4). 그래서 레일에는 서지만 아홉에는 따로 안 센다.
import { V3_BASE } from "./routes";

export interface NineScreen {
  /** 몇 번째 필수인가 (§0-2 의 번호). 보고에서 이 번호로 센다 */
  n: number;
  key: string;
  label: string;
  /** 정확히 이 경로. 상세처럼 뒤에 값이 붙는 것은 `prefix` 를 쓴다 */
  path: string;
  /** `path` 로 시작하는 것까지 아홉에 든다 (상세 `/v3/tasks/12`) */
  prefix?: boolean;
}

export const NINE: NineScreen[] = [
  { n: 1, key: "dash",    label: "대시보드",  path: `${V3_BASE}` },
  { n: 2, key: "tasks",   label: "업무 목록", path: `${V3_BASE}/tasks` },
  { n: 3, key: "detail",  label: "업무 상세", path: `${V3_BASE}/tasks/`, prefix: true },
  { n: 4, key: "new",     label: "새 업무",   path: `${V3_BASE}/new` },
  { n: 5, key: "goals",   label: "목표",      path: `${V3_BASE}/goals`, prefix: true },
  { n: 6, key: "stats",   label: "집계",      path: `${V3_BASE}/stats` },
  { n: 7, key: "team",    label: "팀",        path: `${V3_BASE}/team` },
  { n: 8, key: "members", label: "구성원",    path: `${V3_BASE}/members` },
  { n: 9, key: "me",      label: "내 정보",   path: `${V3_BASE}/me` },
  /*
   * ── 열 번째 (074 §A-8) — 새 화면 스위치 ─────────────────────────
   * 아홉에 없던 자리다. 스위치를 켜면 옛 「설정」이 막음 화면 뒤로 가서 **화면으로는
   * 끌 수 없었다**(073 §C). 끄는 길이 없는 스위치는 켤 수 없다 — 그래서 가오픈 필수에 더한다.
   * 관리자만 보이고 부른다(`admin` · 규약 6-3).
   */
  { n: 10, key: "switch", label: "새 화면 스위치", path: `${V3_BASE}/switch` },
];

/** 새 화면 스위치 자리. **스위치가 꺼져 있어도** 관리자에게는 열린다(`app/v3/layout.tsx`) */
export const SWITCH_PATH = `${V3_BASE}/switch`;

/**
 * 막음 화면 자신은 **아홉이 아니지만 열려 있어야 한다.** 안 그러면 막힌 사람을
 * 막음 화면으로 보내고 그 화면이 또 막혀서 고리가 된다(041 에서 겪은 그것).
 */
export const NOT_YET_PATH = `${V3_BASE}/not-yet`;

/** 이 주소가 아홉(+막음 화면)에 드는가. **뿌리가 이걸로 막는다.** */
export function isNine(pathname: string): boolean {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || V3_BASE;
  if (p === NOT_YET_PATH) return true;
  return NINE.some((s) => (s.prefix ? p.startsWith(s.path) || p === s.path.replace(/\/$/, "") : p === s.path));
}

/** 어느 필수인가. 모르면 `null` — **이름을 지어내지 않는다.** */
export function nineOf(pathname: string): NineScreen | null {
  const p = pathname.split("?")[0].replace(/\/+$/, "") || V3_BASE;
  // 긴 것부터 본다. `/v3/tasks/12` 는 상세지 목록이 아니다.
  return [...NINE].sort((a, b) => b.path.length - a.path.length)
    .find((s) => (s.prefix ? p.startsWith(s.path) || p === s.path.replace(/\/$/, "") : p === s.path)) ?? null;
}

/* ══ 레일 세 묶음 (§0-4) ═══════════════════════════════════════════
 *
 *   개인   대시보드 · 내 업무 · 캘린더🔒
 *   업무   업무 목록 · 목표 · 집계 · 팀 · 프로젝트🔒
 *   관리   구성원 · 영역🔒 · 내 정보
 *
 * 자물쇠는 **지우지 않고 남긴다**(066 §B-8) — 지우면 없어진 줄 알고, 그냥 두면
 * 404 를 만난다. 자물쇠 항목의 목적지는 막음 화면이다.
 */
export interface RailItem {
  label: string;
  /** 자물쇠면 막음 화면의 열쇠, 아니면 갈 경로 */
  href?: string;
  /** 아직 안 여는 곳. 값은 `lib/v3/not-yet.ts` 의 열쇠다 */
  lock?: string;
  /** 팀장부터 보이는 항목 (`hasLead`) */
  lead?: boolean;
  /** 관리자만 보이는 항목 (`isAdmin`) */
  admin?: boolean;
}

export interface RailGroup { title: string; items: RailItem[] }

export const RAIL: RailGroup[] = [
  {
    title: "개인",
    items: [
      { label: "대시보드", href: `${V3_BASE}` },
      // 「내 업무」는 새 화면이 아니라 **업무 목록의 한 조건**이다 (066 §B-4).
      { label: "내 업무", href: `${V3_BASE}/tasks?mine=1` },
      // 캘린더는 주 보기가 없어 반쪽이고, 옛 화면으로 내보내면 §A-2 가 깨진다.
      { label: "캘린더", lock: "calendar" },
    ],
  },
  {
    title: "업무",
    items: [
      { label: "업무 목록", href: `${V3_BASE}/tasks` },
      { label: "목표", href: `${V3_BASE}/goals` },
      // 집계는 팀장부터다 — **그 화면과 같은 함수로 가린다**(§G 038).
      { label: "집계", href: `${V3_BASE}/stats`, lead: true },
      { label: "팀", href: `${V3_BASE}/team` },
      { label: "프로젝트", lock: "projects" },
    ],
  },
  {
    title: "관리",
    items: [
      // 구성원은 **관리자만**이다. 권한이 없으면 레일에 안 나오고 부르지도
      // 않는다(규약 6-3) — 「아홉에 들어 있다」와 「누구에게나 보인다」는 다른 말이다.
      { label: "구성원", href: `${V3_BASE}/members`, admin: true },
      { label: "영역", lock: "areas" },
      { label: "내 정보", href: `${V3_BASE}/me` },
      // 074 §A — 끄는 자리 · 켜는 자리. **관리자만** 보이고 부른다
      { label: "새 화면 스위치", href: SWITCH_PATH, admin: true },
    ],
  },
];
