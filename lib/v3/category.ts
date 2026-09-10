// v3 카테고리 = DB 의 `area` **일곱 개 그대로** (MD-P-2026-043 §1).
//
// ── 042 에서 무엇이 틀렸나 ───────────────────────────────────────
//
// 042 는 카테고리를 넷으로 고정하고 나머지 영역을 「기타」로 접었다. 그 넷은
// 목업에서 온 것이고 **DB 와 대조된 적이 없었다.** 지시자가 정정했다 —
// 「블루투스 앱」은 area 가 아니라 보고서의 묶음 이름이었다.
// 접기(fold)를 걷어냈다. `foldedAreaNames()` 도 없앴다 — 접지 않으니 쓸 일이 없다.
//
// ── 화면은 「카테고리」, DB 는 `area` ───────────────────────────
//
// 이름을 바꾸는 자리가 여기 하나여야 한다. 화면마다 옮겨 적으면 한 곳만
// 안 바뀐 채로 남는다. **area 를 만들거나 지우는 UI 는 없다 — 읽기만 한다.**
//
// ── 왜 색을 이름으로 정하고 id 로 넘기는가 ──────────────────────
//
// 지시: 「area id 에 매핑하라. 이름은 바뀔 수 있다」. 맞다 — 화면이 이름을 보고
// 색을 정하면 이름이 바뀌는 순간 색이 따라 흔들린다.
//
// 그런데 **id 를 코드에 박을 수도 없다.** area 는 `0001_baseline` 에서 한 번에
// 들어가지만 `ON CONFLICT (name) DO NOTHING` 이라, 그 표에 이미 행이 있던
// 환경에서는 id 가 다르다. 로컬에서 맞는 id 가 프로덕션에서 다른 색을 칠하고
// **아무 오류도 안 난다.** 그게 제일 나쁘다.
//
// 그래서 이렇게 가른다.
//   · 팔레트는 **이름으로** 적는다 (지시서가 색을 이름에 붙여 줬다)
//   · 서버가 `area` 를 한 번 읽어 **id → 색**으로 풀어 준다
//   · 화면은 풀린 값을 **받아서 쓴다.** 이름을 보고 판정하지 않는다
//
// 이름이 바뀌면 그 area 는 팔레트에서 빠져 「기타」 색이 되고, **이름은 그대로
// 보인다.** 색이 없다고 이름까지 지우면 그 업무가 어디 것인지 사라진다.

/** 색 이름. 값은 `app/v3.css` 에 있다 — 여기엔 값을 쓰지 않는다. */
export type AreaTone =
  | "platform" | "rnd" | "edu" | "design" | "lab" | "field" | "etc";

/**
 * 지시서 §1 의 색 배정. **상태색과 겹치지 않게 고른 값이다** —
 * 주의(#E39A1E) · 지남(#E0524F) · 완료(#2E9E5B) 는 체크와 기한 글자에만 쓰고
 * 태그 배경으로 쓰지 않는다.
 */
export const AREA_PALETTE: { name: string; tone: AreaTone }[] = [
  { name: "플랫폼", tone: "platform" },
  { name: "R&D", tone: "rnd" },
  { name: "교육자료", tone: "edu" },
  { name: "디자인", tone: "design" },
  { name: "연구소", tone: "lab" },
  { name: "현장실습교육", tone: "field" },
  { name: "기타", tone: "etc" },
];

/** 화면이 받는 모양. **id 로 다니고, 이름은 그리기만 한다.** */
export interface AreaView {
  id: number;
  name: string;
  tone: AreaTone;
}

/**
 * `area` 행들을 화면이 쓸 모양으로 푼다. **서버에서 한 번만** 부른다.
 *
 * 팔레트에 없는 이름은 `etc` 색이 되고 이름은 그대로 남는다.
 */
export function resolveAreas(rows: { id: number; name: string }[]): AreaView[] {
  const byName = new Map(AREA_PALETTE.map((p) => [p.name, p.tone]));
  return rows.map((r) => ({ id: r.id, name: r.name, tone: byName.get(r.name.trim()) ?? "etc" }));
}

/**
 * 팔레트에 이름이 없는 area — **색을 못 준 것들**.
 *
 * 화면에 띄우지는 않는다(사람이 할 일이 없다). 검사기가 「몇 개가 회색인가」를
 * 물을 때 쓰고, 늘어나면 팔레트가 낡았다는 뜻이다.
 */
export function unpaletted(areas: AreaView[]): AreaView[] {
  const named = new Set(AREA_PALETTE.map((p) => p.name));
  return areas.filter((a) => !named.has(a.name.trim()));
}

/** 모르는 id 를 만나도 **그리기는 한다.** 이름을 모르면 그것도 적는다. */
export const UNKNOWN_AREA = (id: number): AreaView => ({
  id, name: `영역 #${id}`, tone: "etc",
});

export function areaOf(areas: AreaView[], id: number | null | undefined): AreaView | null {
  if (id === null || id === undefined) return null;
  return areas.find((a) => a.id === id) ?? UNKNOWN_AREA(id);
}

/* ── 칩 줄 (§1) ───────────────────────────────────────────────────
   「전체」 + 건수 있는 것, **건수 많은 순**. 건수 0인 것은 접는다.
   **접힌 것이 있다는 사실은 보인다** — `＋n` 으로. 조용히 없애면 일곱 개가
   맞는지 세어 볼 수가 없다. */
export interface ChipItem { area: AreaView; count: number }

export function chipRow(areas: AreaView[], counts: Map<number, number>): {
  shown: ChipItem[];
  hidden: ChipItem[];
} {
  const all: ChipItem[] = areas.map((a) => ({ area: a, count: counts.get(a.id) ?? 0 }));
  const shown = all.filter((c) => c.count > 0).sort((a, b) =>
    b.count - a.count || a.area.name.localeCompare(b.area.name, "ko"));
  // 접히는 쪽도 순서를 정해 둔다 — 펼칠 때마다 자리가 바뀌면 못 찾는다.
  const hidden = all.filter((c) => c.count === 0)
    .sort((a, b) => a.area.name.localeCompare(b.area.name, "ko"));
  return { shown, hidden };
}
