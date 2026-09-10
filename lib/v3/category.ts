// v3 카테고리 — **넷으로 고정** (MD-P-2026-042 §A · §C-3).
//
// ── 화면은 「카테고리」, DB 는 `area` 그대로 ─────────────────────
//
// 지시: 화면에서 「영역」이라는 말을 「카테고리」로 바꾼다. DB 는 안 건드린다.
// 그러니 **이름을 바꾸는 자리가 여기 하나**여야 한다 — 화면마다 따로 옮겨
// 적으면 한 곳만 안 바뀐 채로 남는다.
//
// ── 지금 맞지 않는 것 (지시자 확인 필요) ────────────────────────
//
// DB 의 `area` 는 **7개**다: R&D · 플랫폼 · 교육자료 · 디자인 · 연구소 ·
// 현장실습교육 · 기타. 목업의 카테고리는 **4개**다: 플랫폼 · 블루투스 앱 ·
// R&D · 기타.
//
//   · 「블루투스 앱」에 해당하는 area 가 **DB 에 없다** → 그 칩은 늘 0건이다
//   · 교육자료 · 디자인 · 연구소 · 현장실습교육 네 영역(활성 업무 6건)이
//     카테고리에 없다 → 아래 매핑에서 **「기타」로 접힌다**
//
// 접는 것 자체는 되돌릴 수 있다(표시만 바꾼다). 다만 **접혔다는 사실이 화면에서
// 보여야 한다** — 「기타 9건」이 실제로는 다섯 영역의 합이라는 것을 모르면
// 사람이 잘못 읽는다. 그래서 `foldedAreaNames()` 를 함께 낸다.
//
// area 를 4개로 정리하는 것은 **DB 변경**이라 이번 회차 범위 밖이다.

export type CategoryKey = "platform" | "bt" | "rnd" | "etc";

export interface Category {
  key: CategoryKey;
  /** 화면에 그대로 쓰는 말. */
  label: string;
  /**
   * 이 카테고리로 접히는 `area.name` 들. **이름으로 판정한다** —
   * area id 는 환경마다 다르고(로컬/프로덕션), 이름은 사람이 정한 값이라
   * 여기서만 쓰인다면 그나마 안전하다. 이름이 바뀌면 `기타` 로 떨어지므로
   * 조용히 사라지지는 않는다.
   */
  areaNames: string[];
}

/** 넷뿐이다. **추가 UI 를 만들지 않는다** (지시 §C-3). */
export const CATEGORIES: Category[] = [
  { key: "platform", label: "플랫폼", areaNames: ["플랫폼"] },
  { key: "bt", label: "블루투스 앱", areaNames: ["블루투스 앱", "블루투스앱"] },
  { key: "rnd", label: "R&D", areaNames: ["R&D"] },
  // 「기타」는 **나머지 전부**다. 아래 `categoryOf` 가 폴백으로 여기 넣는다.
  { key: "etc", label: "기타", areaNames: ["기타"] },
];

const BY_AREA = new Map<string, CategoryKey>(
  CATEGORIES.flatMap((c) => c.areaNames.map((n) => [n, c.key] as const))
);

/**
 * 영역 이름 → 카테고리. **모르는 영역은 「기타」다.**
 *
 * 모르는 것을 버리지 않는다 — 버리면 그 업무가 어느 칩에서도 안 보이고,
 * 안 보이는 업무는 없는 업무가 된다.
 */
export function categoryOf(areaName: string | null | undefined): CategoryKey {
  if (!areaName) return "etc";
  return BY_AREA.get(areaName.trim()) ?? "etc";
}

export function categoryLabel(key: CategoryKey): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? "기타";
}

/**
 * 「기타」로 접힌 영역 이름들 — **카테고리에 자기 칩이 없는 것들**.
 *
 * 화면이 이걸 적어야 「기타 9건」을 사람이 바로 읽는다.
 * 원래 「기타」인 영역은 접힌 것이 아니므로 뺀다.
 */
export function foldedAreaNames(areaNames: (string | null | undefined)[]): string[] {
  const own = new Set(CATEGORIES.flatMap((c) => c.areaNames));
  const seen: string[] = [];
  for (const raw of areaNames) {
    const n = (raw ?? "").trim();
    if (n.length > 0 && !own.has(n) && !seen.includes(n)) seen.push(n);
  }
  return seen.sort();
}
