// 가오픈 기준 기한 — **표시와 집계만.** 날짜를 옮기지 않는다 (MD-P-2026-037 §B).
//
// ── 왜 옮기지 않는가 ─────────────────────────────────────────────
//
// 가오픈이 11/2 로 확정됐다고 등록된 기한을 일괄로 밀면 **선후관계가 뒤엉키고
// 되돌릴 수 없다.** 어느 것이 원래 그 날짜였고 어느 것이 밀린 것인지 구분이
// 사라진다. 그래서 **보이게만** 하고, 조정은 사람이 화면에서 한다.
//
// ── D 는 대문 카운트다운과 같은 곳에서 센다 ──────────────────────
//
// 두 자리가 다른 숫자를 내면 안 된다. `lib/countdown.ts` 의 `dDay` 를 그대로
// 쓴다 — **달력 날짜 차이**다. 남은 밀리초를 나누면 시각에 따라 하루가 어긋난다.
import { dDay } from "./countdown";

/** 기한이 가오픈일에 대해 어디 서 있는가. **세 갈래다.** */
export type OpenDueBucket = "before" | "after" | "none";

export interface OpenDueMark {
  bucket: OpenDueBucket;
  /**
   * 가오픈까지 남은 날수. 기한이 **없으면 null** 이다.
   * 양수면 가오픈 전, 0이면 당일, 음수면 가오픈 뒤.
   */
  days: number | null;
  /** 화면에 그대로 붙일 수 있는 말. 기한이 없으면 null. */
  label: string | null;
}

/**
 * 업무의 기한을 가오픈일 기준으로 읽는다.
 *
 * `dueDate` 는 `YYYY-MM-DD` (date-only). 시각이 없으므로 **그 날의 KST 자정**으로
 * 본다 — `lib/countdown.ts` 의 `dDay` 가 어차피 달력 날짜로 세므로 시각은
 * 결과에 영향을 주지 않는다.
 */
export function openDueMark(
  dueDate: string | null | undefined,
  openAtMs: number,
  timeZone = "Asia/Seoul"
): OpenDueMark {
  // ── 기한 없음은 「먼 미래」가 아니라 **별개의 갈래**다 ──
  //
  // 0 이나 아주 큰 수로 접으면 정렬·집계에서 다른 것들 사이에 끼어 버리고,
  // 그러면 **아무 날에도 안 걸려서 마지막까지 안 보인다.** 늦은 것보다 위험하다.
  if (!dueDate) return { bucket: "none", days: null, label: null };

  const dueMs = Date.parse(`${dueDate.slice(0, 10)}T00:00:00+09:00`);
  if (!Number.isFinite(dueMs)) return { bucket: "none", days: null, label: null };

  // 가오픈일에서 기한까지가 아니라 **기한에서 가오픈까지**를 센다 —
  // 「이 업무가 가오픈 며칠 전인가」가 읽고 싶은 값이다.
  const days = dDay(openAtMs, dueMs, timeZone);
  return {
    bucket: days >= 0 ? "before" : "after",
    days,
    label: days > 0 ? `가오픈 D-${days}` : days === 0 ? "가오픈 당일" : `가오픈 +${-days}일`,
  };
}

export interface OpenDueTally {
  before: number;
  after: number;
  none: number;
  /** 세 갈래에서 **뺀** 완료 업무 수. 빼고 나서 몇을 뺐는지 적는다. */
  excludedDone: number;
}

export interface OpenDueTask {
  status: string;
  dueDate: string | null;
}

/**
 * 세 갈래로 센다. **완료된 업무는 전부에서 뺀다.**
 *
 * 완료를 섞으면 「기한이 가오픈 뒤인 업무 12건」이 실제로는 이미 끝난 것들이라
 * 손댈 게 없는데도 손대야 할 것처럼 보인다. 빼되 **몇을 뺐는지 적는다** —
 * 안 적으면 총합이 안 맞아 보이고, 안 맞는 총합은 다시 세게 만든다.
 */
export function tallyOpenDue(tasks: OpenDueTask[], openAtMs: number): OpenDueTally {
  const t: OpenDueTally = { before: 0, after: 0, none: 0, excludedDone: 0 };
  for (const x of tasks) {
    if (x.status === "done") { t.excludedDone += 1; continue; }
    t[openDueMark(x.dueDate, openAtMs).bucket] += 1;
  }
  return t;
}
