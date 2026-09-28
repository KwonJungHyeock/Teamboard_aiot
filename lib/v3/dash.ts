// 대시보드의 숫자 — **목록과 같은 함수에서 나온다** (MD-P-2026-071 §B).
//
// 타일 넷과 영역 막대는 전부 여기서 센다. 화면(`TodayView`)은 그리기만 한다.
// 검사기가 이 파일을 불러 **같은 id 집합**을 낸다(071 §B-17) — 규칙을 옮겨 적지 않는다.
//
// **이 파일은 순수하다.** `pg` 도 `fetch` 도 없다.
import {
  EMPTY_LIST_QUERY, selectRows, serializeListQuery, type ListQuery, type SelectableRow,
} from "./list-query";
import { V3_BASE } from "./routes";
import { kstDate, weekEnd, shortDate } from "./today";

/** 안 끝난 셋. 완료를 빼야 「기한 지남」에 끝난 일이 안 섞인다(066 §D-30). */
export const OPEN_STATUSES = ["todo", "doing", "review"] as const;

type Row = SelectableRow & { completedAt?: string | null };

export interface TileDelta {
  /** 이번 값 − 비교 값. 양수면 ▲ */
  n: number;
  /** 무엇과 비교했는가 — 화면에 그대로 적는다 */
  basis: string;
}
export interface DashTile {
  key: "doing" | "late" | "soon" | "done";
  label: string;
  /** 이 타일이 센 업무들. 숫자는 이것의 길이다 — 검사기는 **이 집합**을 목록과 맞춘다 */
  ids: number[];
  /**
   * 누르면 갈 목록. **조건을 못 만드는 타일은 `null`** — 누르는 것을 안 만든다(070 §E-43).
   * 조건은 `serializeListQuery` 를 지난다. 대시보드가 주소를 따로 짓지 않는다.
   */
  href: string | null;
  /** 이 조건 그대로의 `ListQuery`. `href` 가 없으면 `null` */
  query: ListQuery | null;
  /** 증감 — **못 재는 타일은 `null`**(071 §B-9). 지어내지 않는다 */
  delta: TileDelta | null;
}

const listHref = (q: ListQuery) => `${V3_BASE}/tasks?${serializeListQuery(q)}`;

/** `YYYY-MM-DD` 에서 달을 옮긴다. 일은 그 달의 끝을 넘지 않게 자른다(3월 31일 → 2월 28일). */
function shiftMonthDay(date: string, by: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + by, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, last);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * 「이번 달 완료」의 조건 — `status = done` · **완료 시각이 이 달**(072 §C · `finMonth`).
 * 071 에는 목록에 이 축이 없어 타일을 안 눌리게 했다. 072 에서 축을 하나 냈다.
 */
export const DONE_MONTH_QUERY: ListQuery = { ...EMPTY_LIST_QUERY, status: new Set(["done"]), finMonth: true };

/**
 * 이번 달에 마친 업무. **목록과 같은 조건**(`DONE_MONTH_QUERY`)을 `selectRows` 에 넣는다 —
 * 타일이 따로 세면 타일과 목록이 갈린다. 권한도 거기서 걸러진다.
 */
export function doneInMonth<T extends Row>(rows: readonly T[], viewerId: number, today: string): T[] {
  return selectRows(rows, DONE_MONTH_QUERY, viewerId, today);
}

/**
 * 타일 넷 (071 §B-8).
 *
 *   진행 중       status = doing                          → 목록 ?st=doing
 *   기한 지남     안 끝난 셋 · 기한 < 오늘                 → 목록 ?st=…&due=late   (그대로)
 *   이번 주 마감  안 끝난 셋 · 오늘 ≤ 기한 ≤ 이번 주 끝     → 목록 ?st=…&due=soon   (그대로)
 *   이번 달 완료  done · 완료 시각이 이번 달               → 목록 ?st=done&fin=month
 *
 * 071 에서는 「이번 달 완료」가 목록에 완료 시각 축이 없어 **안 눌렸다**. 072 §C 에서
 * 축(`finMonth`)을 승인받아 냈다 — 이제 넷 다 누르면 그 조건 그대로의 목록이 열린다.
 *
 * ── 증감 (§B-9) — **잴 수 있는 것에만** ────────────────────────────
 *
 * 「지난주엔 몇 건이 진행 중이었나」는 지금 DB 로 못 잰다 — 상태의 옛 값을 쌓아 두는
 * 곳이 없다(활동 기록은 문장이다). 기한 지남 · 이번 주 마감도 같다: 지난주에 그 업무가
 * 안 끝난 상태였는지 모른다. 그래서 셋은 **증감을 안 붙인다.**
 *
 * 「이번 달 완료」만 잰다 — 완료 시각이 남아 있으므로 **지난달의 같은 기간**(1일 ~ 오늘과
 * 같은 날)에 마친 것을 같은 규칙으로 셀 수 있다. 지난달 **전체**와 비교하지 않는다 —
 * 달 중간에는 늘 ▼ 가 뜨고, 그건 변화가 아니라 날짜다.
 * ⚠ 완료를 되돌렸다 다시 완료하면 완료 시각이 바뀐다(071 §C-20). 이 숫자도 흔들린다.
 */
export function dashTiles<T extends Row>(rows: readonly T[], viewerId: number, today: string): DashTile[] {
  const open = new Set<string>(OPEN_STATUSES);
  const mk = (key: DashTile["key"], label: string, q: ListQuery): DashTile => ({
    key, label, ids: selectRows(rows, q, viewerId, today).map((r) => r.id),
    href: listHref(q), query: q, delta: null,
  });
  const doing = mk("doing", "진행 중", { ...EMPTY_LIST_QUERY, status: new Set(["doing"]) });
  const late = mk("late", "기한 지남", { ...EMPTY_LIST_QUERY, status: open, due: "late" });
  const soon = mk("soon", `이번 주 마감 (~${shortDate(weekEnd(today))})`,
                  { ...EMPTY_LIST_QUERY, status: open, due: "soon" });

  const now = doneInMonth(rows, viewerId, today);
  const prevDay = shiftMonthDay(today, -1);
  const prevYm = prevDay.slice(0, 7);
  const prev = selectRows(rows, { ...EMPTY_LIST_QUERY, status: new Set(["done"]) }, viewerId, today)
    .filter((t) => {
      const d = kstDate(t.completedAt ?? null);
      return d !== null && d.slice(0, 7) === prevYm && d <= prevDay;
    });
  const done: DashTile = {
    key: "done", label: "이번 달 완료", ids: now.map((r) => r.id),
    href: listHref(DONE_MONTH_QUERY), query: DONE_MONTH_QUERY,
    delta: { n: now.length - prev.length, basis: "지난달 같은 기간 대비" },
  };
  return [doing, late, soon, done];
}

/** 증감 한 줄 — 「▲ 2 · 지난달 같은 기간 대비」. 0 이면 화살표를 안 쓴다 */
export function deltaLine(d: TileDelta): string {
  if (d.n === 0) return `변동 없음 · ${d.basis}`;
  return `${d.n > 0 ? "▲" : "▼"} ${Math.abs(d.n)} · ${d.basis}`;
}

export interface AreaBar {
  areaId: number;
  name: string;
  ids: number[];
  href: string;
  query: ListQuery;
}

/**
 * 영역별 남은 업무 (071 §B-2) — 영역마다 **안 끝난 셋**의 건수.
 *
 * **0 인 영역도 줄을 남긴다**(§B-14) — 없어진 게 아니라 0 이다. 순서는 받은 영역
 * 순서(`sort_order`) 그대로다. 건수로 다시 줄 세우면 날마다 줄이 자리를 바꾼다.
 *
 * 누르면 **그 영역 + 안 끝난 셋**이 걸린 목록으로 간다. 막대가 센 것과 목록이 같은
 * 조건이어야 둘이 같은 id 집합이 된다 — 영역만 걸면 완료까지 섞여 숫자가 안 맞는다.
 */
export function areaBars<T extends Row>(
  rows: readonly T[], areas: readonly { id: number; name: string }[], viewerId: number, today: string,
): AreaBar[] {
  const open = new Set<string>(OPEN_STATUSES);
  return areas.map((a) => {
    const q: ListQuery = { ...EMPTY_LIST_QUERY, status: open, cat: new Set([a.id]) };
    return { areaId: a.id, name: a.name, ids: selectRows(rows, q, viewerId, today).map((r) => r.id),
             href: listHref(q), query: q };
  });
}
