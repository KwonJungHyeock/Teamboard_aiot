// 업무 목록의 **조건 한 벌** — 화면과 CSV 가 같은 자리에서 가져간다 (MD-P-2026-066 §C-2).
//
// ── 왜 한 파일인가 ──────────────────────────────────────────────
//
// 지시서 §C-19: 「목록 화면과 CSV 가 같은 함수를 쓴다. 각자 만들면 반드시
// 어긋난다 — 화면은 막혀 있는데 파일로는 남의 것이 나가는 사고가 실제로 난
// 적이 있다.」
//
// 그 사고의 모양은 늘 같다. 화면은 `applyFilters()` 를 쓰고, 내보내기는
// 「SQL 에 WHERE 를 다시 적는」 길을 간다. 두 벌이 되는 순간 **한쪽만 고쳐진다.**
//
// 그래서 이 파일이 셋을 한꺼번에 낸다:
//   ① 주소 → 조건      `parseListQuery`
//   ② 조건 → 주소      `serializeListQuery`
//   ③ 조건 → 행 고르기  `selectRows`  ← **권한 거르기가 이 안에 있다**
//
// ── 권한을 왜 함수 안에 넣는가 (§C-20) ─────────────────────────
//
// 「함수 밖에서 거르면 CSV 가 빠뜨린다.」 실제로 그렇다. `/api/tasks` 는
// `visibleTaskSql()` 로 남의 개인 업무를 쿼리에서 뺀다 — 화면은 그래서 안전하다.
// 내보내기가 **자기 쿼리를 새로 쓰면** 그 한 줄을 빠뜨릴 수 있고, 빠뜨려도
// 화면은 멀쩡하므로 아무도 모른다.
//
// 그래서 `selectRows()` 가 **행마다 한 번 더** 묻는다(`visibleTo`). SQL 이 이미
// 걸렀으면 이 그물은 아무것도 안 잡는다 — 그물이 비어 있는 것이 정상이고,
// 그물이 없는 것이 사고다.
//
// ── 「내 항목」은 새 축이 아니다 (§B-4 · §C-16) ─────────────────
//
// `?mine=1` 은 **담당 축의 값 하나**다 — 「나」를 담당에 더한다. 축을 늘리지
// 않는다(051 §B). 그래서 「내 항목」만 켠 결과와 「담당 ▾ 에서 나」를 고른
// 결과가 **같은 id 집합**이다(§C-26). 두 길이 같은 함수를 지나가므로 같다.
import {
  applyFilters, activeChips, isDueSel, GROUPS,
  type Query, type DueSel, type TaskRow, type ChipView,
} from "./tasks";
import { kstDate } from "./today";

/** 주소에 쓰는 이름. **한 곳에 모아 둔다** — 화면과 CSV 가 같은 글자를 읽는다. */
export const KEYS = {
  cat: "cat", who: "who", status: "st", due: "due", q: "q",
  /** §B-4 — 「내 업무」는 이 값이 붙은 업무 목록이다. 새 화면이 아니다. */
  mine: "mine",
  sort: "sort", done: "done",
  /** 072 §C — 완료 시각이 이 달 안. 값은 `month` 하나뿐이다 */
  fin: "fin",
} as const;

/** 상태 축이 받는 값 넷. `GROUPS` 에서 나온다 — 여기 손으로 적지 않는다. */
export const STATUS_VALUES: readonly string[] = GROUPS.map((g) => g.statuses[0] as string);

/** 조건 한 벌 = 축 다섯(`Query`) + 「내 항목」 + 「완료 시각이 이 달」. */
export interface ListQuery extends Query {
  /** 담당 축에 **나**를 더한다. */
  mine: boolean;
  /**
   * **완료 시각(KST)이 이 달 안** (072 §C). 대시보드 「이번 달 완료」 타일이 가는 길이다.
   *
   * 거르개 줄(▾ 고르개들)에는 이 조건을 고르는 자리를 **안 만든다**(§C-10) —
   * 주소(`?fin=month`)로만 걸린다. 다만 걸려 있으면 「걸린 조건」 줄에는 선다 —
   * 이 목록의 규칙이 「조건이 어디 숨어 있으면 빈 목록이 고장으로 읽힌다」이기 때문이다.
   * 기간은 **이 달 하나뿐**이다(§C-13). 지난달·분기는 필요해지면 그때.
   */
  finMonth: boolean;
}

export const EMPTY_LIST_QUERY: ListQuery = {
  cat: new Set(), who: new Set(), status: new Set(), due: "all", q: "", mine: false, finMonth: false,
};

/** 주소의 `1,2,3` → 번호 집합. 이상한 값은 조용히 버린다 — 주소는 사람이 손으로 고친다. */
function nums(raw: string | null): Set<number> {
  return new Set((raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
}
function strs(raw: string | null, allowed: readonly string[]): Set<string> {
  return new Set((raw ?? "").split(",").filter((s) => allowed.includes(s)));
}

/** 있는 그대로 읽는다. `URLSearchParams` 든 Next 의 읽개든 `get` 하나만 쓴다. */
export interface Getter { get(k: string): string | null }

/**
 * 주소 → 조건. **화면과 CSV 가 이 함수를 같이 쓴다.**
 *
 * 화면이 자기 방식으로 읽고 CSV 가 또 자기 방식으로 읽으면, 같은 주소가
 * 두 곳에서 다른 조건이 된다 — 그게 §C-27(화면 id 집합 = CSV id 집합)이
 * 잡으려는 바로 그 자리다.
 */
export function parseListQuery(sp: Getter): ListQuery {
  return {
    cat: nums(sp.get(KEYS.cat)),
    who: nums(sp.get(KEYS.who)),
    status: strs(sp.get(KEYS.status), STATUS_VALUES),
    due: isDueSel(sp.get(KEYS.due)) ? (sp.get(KEYS.due) as DueSel) : "all",
    q: sp.get(KEYS.q) ?? "",
    mine: sp.get(KEYS.mine) === "1",
    finMonth: sp.get(KEYS.fin) === "month",
  };
}

/**
 * 조건 → 주소(쿼리 문자열). **기본값은 안 적는다** — 적으면 같은 화면을
 * 가리키는 주소가 둘이 되고, 「돌아온 자리」가 어느 쪽인지 알 수 없다.
 *
 * CSV 단추의 `href` 가 이걸로 만들어진다(§C-21 · §C-22).
 */
export function serializeListQuery(q: ListQuery): string {
  const p = new URLSearchParams();
  const list = (s: Set<number>) => Array.from(s).sort((a, b) => a - b).join(",");
  if (q.cat.size) p.set(KEYS.cat, list(q.cat));
  if (q.who.size) p.set(KEYS.who, list(q.who));
  // 화면 순서(GROUPS)대로 적는다 — 고른 차례대로 적으면 같은 조건이 다른 주소가 된다.
  const st = STATUS_VALUES.filter((v) => q.status.has(v)).join(",");
  if (st) p.set(KEYS.status, st);
  if (q.due !== "all") p.set(KEYS.due, String(q.due));
  if (q.q.trim()) p.set(KEYS.q, q.q.trim());
  if (q.mine) p.set(KEYS.mine, "1");
  if (q.finMonth) p.set(KEYS.fin, "month");
  return p.toString();
}

/** 아무것도 안 걸렸는가. 빈 화면 문구가 **두 갈래로 갈리는 기준**이다(§C-25). */
export function isEmptyListQuery(q: ListQuery): boolean {
  return q.cat.size === 0 && q.who.size === 0 && q.status.size === 0
    && q.due === "all" && q.q.trim() === "" && !q.mine && !q.finMonth;
}

/* ══ 권한 — **여기 안에 있다** (§C-20) ══════════════════════════════ */

/**
 * 권한 판정에 필요한 칸. `lib/visibility.ts` 의 규칙을 **행 하나에 대해** 묻는 꼴이다.
 *
 * 규칙을 새로 쓰지 않는다: `visibility='team'` 이면 팀 전체가 보고, `private` 는
 * **만든 사람만** 본다(팀장도 못 본다 — 025 §A2).
 */
export interface Owned {
  visibility: string;
  /** 개인 업무의 주인. 담당이 아니라 **만든 사람**이다. */
  createdById: number | null;
}

/** 이 사람이 이 행을 볼 수 있는가. `visibleTaskSql()` 과 **같은 말**이다. */
export function visibleTo(t: Owned, viewerId: number): boolean {
  return t.visibility === "team" || t.createdById === viewerId;
}

/** 목록·CSV 가 다루는 행 = 거르개가 보는 칸 + 권한이 보는 칸. */
export type SelectableRow = TaskRow & Owned;

/**
 * 담당 축의 실제 값. 「내 항목」이 켜져 있으면 **나를 더한다.**
 *
 * 축을 늘리지 않으므로 「내 항목 + 담당 ▾ 박정길」은 「나 또는 박정길」이 된다 —
 * 담당 축 안에서는 합집합, 축끼리는 교집합이라는 기존 규칙(051 §B) 그대로다.
 */
export function effectiveWho(q: ListQuery, viewerId: number): Set<number> {
  if (!q.mine) return q.who;
  const n = new Set(q.who);
  n.add(viewerId);
  return n;
}

/**
 * **조건에 맞는 행.** 화면도 CSV 도 이 함수만 부른다.
 *
 * 순서가 중요하다 — 권한을 **먼저** 거른다. 나중에 거르면 「전체 n건」 같은
 * 숫자를 남의 개인 업무까지 세어 놓고 화면에만 안 보이게 하는 꼴이 된다.
 */
export function selectRows<T extends SelectableRow>(
  rows: readonly T[], q: ListQuery, viewerId: number, today: string,
): T[] {
  const allowed = rows.filter((r) => visibleTo(r, viewerId));
  const hit = applyFilters(allowed, { ...q, who: effectiveWho(q, viewerId) }, today) as T[];
  if (!q.finMonth) return hit;
  // 072 §C — 완료 시각을 **KST 달력으로** 읽는다(UTC 로 자르면 9시간이 어긋난다 — `kstDate`)
  const ym = today.slice(0, 7);
  return hit.filter((r) => (kstDate(r.completedAt) ?? "").slice(0, 7) === ym);
}

/**
 * 걸린 조건을 사람이 읽는 말로. **「내 항목」도 여기 선다.**
 *
 * 화면이 따로 앞에 끼우면 「조건 n개」를 세는 자리와 칩을 그리는 자리가
 * 다른 수를 말한다 — 조건이 화면 어딘가에 숨는 바로 그 모양이다.
 */
export function listChips(
  q: ListQuery,
  areas: { id: number; name: string }[],
  people: { id: number; name: string }[],
): ChipView[] {
  const rest = activeChips(q, areas, people);
  // 072 §C — 주소로만 걸리는 조건도 **걸려 있으면 보인다**. 숨은 조건은 빈 목록을 고장으로 읽게 한다
  const fin: ChipView[] = q.finMonth ? [{ axis: "fin", value: null, label: "완료 · 이번 달" }] : [];
  return q.mine ? [{ axis: "mine", value: null, label: "내 항목" }, ...rest, ...fin] : [...rest, ...fin];
}

/**
 * 머리 보조설명의 **두 숫자** (§C-18) — 「24건 · 내 것 5건」.
 *
 * 둘 다 **같은 목록에서** 센다. 「내 것」을 따로 불러와 세면 조건이 걸린 화면에서
 * 두 숫자가 서로 다른 모집단을 말하게 된다.
 */
export function countMine(rows: readonly { assigneeId: number | null }[], viewerId: number): number {
  return rows.filter((r) => r.assigneeId === viewerId).length;
}
