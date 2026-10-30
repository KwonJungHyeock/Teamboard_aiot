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
  // 2026-10 디자인 v1.0 — 상단 캡슐 메뉴 여덟 + 계정 메뉴 셋 + 옛 주소(새 자리로 넘긴다)
  { n: 1, key: "dash",    label: "업무 현황", path: `${V3_BASE}` },
  { n: 2, key: "tasks",   label: "전체 업무", path: `${V3_BASE}/tasks` },
  { n: 3, key: "detail",  label: "전체 업무", path: `${V3_BASE}/tasks/`, prefix: true },
  { n: 4, key: "new",     label: "내 업무",   path: `${V3_BASE}/new` },
  { n: 5, key: "goals",   label: "목표 관리", path: `${V3_BASE}/goals`, prefix: true },
  { n: 6, key: "stats",   label: "성과 분석", path: `${V3_BASE}/stats` },
  { n: 7, key: "team",    label: "업무 현황", path: `${V3_BASE}/team` },
  { n: 8, key: "members", label: "구성원 관리", path: `${V3_BASE}/members` },
  { n: 9, key: "me",      label: "내 정보",   path: `${V3_BASE}/me` },
  { n: 10, key: "my", label: "내 업무", path: `${V3_BASE}/my` },
  { n: 11, key: "log", label: "업무일지", path: `${V3_BASE}/log` },
  { n: 12, key: "control", label: "업무 현황", path: `${V3_BASE}/control` },
  { n: 13, key: "room", label: "회의", path: `${V3_BASE}/room`, prefix: true },
  { n: 14, key: "settings", label: "설정", path: `${V3_BASE}/settings` },
  { n: 15, key: "reports", label: "보고", path: `${V3_BASE}/reports`, prefix: true },
  { n: 15, key: "calendar", label: "일정", path: `${V3_BASE}/calendar` },
  { n: 16, key: "report", label: "월간 보고", path: `${V3_BASE}/report` },
];

/** 새 화면 스위치 자리. **스위치가 꺼져 있어도** 관리자에게는 열린다(`app/v3/layout.tsx`) */

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
    // 2026-10 정련 — 「/v3/tasks/」(상세, 끝이 /)는 「/v3/tasks」(목록)와 **같다고 보지 않는다.**
    // 그렇게 보면 목록 화면의 위 바 제목이 「업무 상세」가 됐다(390px 캡처로 찾았다).
    .find((s) => (s.prefix
      ? p.startsWith(s.path) || (!s.path.endsWith("/") && p === s.path)
      : p === s.path)) ?? null;
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

/*
 * ── 2026-10 레일 정리 — **여섯 개만** ─────────────────────────────
 *
 * 지시: 「왼쪽 패널에서 필수 기능만 빼고 필요 없는 것들 빼고 심플하게」.
 * 세 묶음(067 §0-4)을 한 줄로 접었다. 묶음 제목이 없으면 그리지 않는다.
 *
 *   관제 · 내 업무 · 내 기록 · 업무 목록 · 목표 · 회의실(곧)
 *
 * 레일에서 **빠진 화면은 없어진 것이 아니다** — 주소는 그대로 열린다(`NINE`).
 *   · 대시보드 · 팀 · 집계 → 관제가 대신하고, 관제 머리의 작은 링크로 간다
 *   · 내 정보 · 구성원 · 새 화면 스위치 → 아래 계정 블록(`ACCOUNT_LINKS`)
 *   · 캘린더 · 프로젝트 · 영역 · 설정(자물쇠) → 아직 없는 화면이라 뺐다
 * 회의실은 자물쇠로 자리만 보여 두다가 2026-10 회의실(0038)에서 열었다. 캘린더는 주 보기를 더해 2026-10 에 다시 넣었다.
 */
export const RAIL: RailGroup[] = [
  {
    title: "",
    items: [
      { label: "업무 현황", href: `${V3_BASE}/control` },
      { label: "내 업무", href: `${V3_BASE}/my` },
      { label: "업무일지", href: `${V3_BASE}/log` },
      { label: "전체 업무", href: `${V3_BASE}/tasks` },
      { label: "목표 관리", href: `${V3_BASE}/goals` },
      { label: "성과 분석", href: `${V3_BASE}/stats`, lead: true },
      { label: "일정", href: `${V3_BASE}/calendar` },
      { label: "회의", href: `${V3_BASE}/room` },
    ],
  },
];

/** 상단 캡슐 메뉴 — 순서 · 이름 고정 (DESIGN.md 3.2). `match` 는 켜짐 판정에 쓰는 주소 앞부분 */
export const MENU: { label: string; href: string; match: string[]; lead?: boolean }[] = [
  { label: "업무 현황", href: `${V3_BASE}/control`, match: [`${V3_BASE}/control`] },
  { label: "내 업무",   href: `${V3_BASE}/my`,      match: [`${V3_BASE}/my`] },
  { label: "업무일지",  href: `${V3_BASE}/log`,     match: [`${V3_BASE}/log`, `${V3_BASE}/report`] },
  { label: "전체 업무", href: `${V3_BASE}/tasks`,   match: [`${V3_BASE}/tasks`] },
  { label: "목표 관리", href: `${V3_BASE}/goals`,   match: [`${V3_BASE}/goals`] },
  { label: "성과 분석", href: `${V3_BASE}/stats`,   match: [`${V3_BASE}/stats`], lead: true },
  { label: "일정",      href: `${V3_BASE}/calendar`, match: [`${V3_BASE}/calendar`] },
  { label: "회의",      href: `${V3_BASE}/room`,    match: [`${V3_BASE}/room`] },
  { label: "보고",      href: `${V3_BASE}/reports`, match: [`${V3_BASE}/reports`] },
];

/**
 * 계정 블록의 링크 — 레일에서 내려온 것들. 등급 조건은 **그 화면과 같은 함수**로
 * 가린다(§G 038): 구성원 · 스위치는 관리자만.
 */
export const ACCOUNT_LINKS: RailItem[] = [
  { label: "내 정보", href: `${V3_BASE}/me` },
  { label: "구성원 관리", href: `${V3_BASE}/members`, admin: true },
  { label: "설정", href: `${V3_BASE}/settings`, lead: true },
];
