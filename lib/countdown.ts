// 오픈까지 남은 시간 — **순수 함수다.** (MD-P-2026-033 §A)
//
// DB 도 `Date.now()` 도 안 쓴다. `now` 를 인자로 받는다. 그래야
//   · 검사기가 **아무 시각이나 만들어** 부를 수 있고 (경계·지난 뒤·1초 전)
//   · 서버와 클라이언트가 같은 함수로 같은 답을 낸다
//
// 시간을 함수 안에서 읽으면 「오픈 1초 전」을 시험하려고 시스템 시계를 돌려야 한다.
// 그건 시험이 아니라 곡예다.

export interface Remain {
  /** 남은 밀리초. 지났으면 0 이하 */
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** 목표 시각을 지났는가. **`days === 0` 과 다르다** — 오픈 당일도 아직 안 지났을 수 있다. */
  past: boolean;
}

const SEC = 1000, MIN = 60 * SEC, HOUR = 60 * MIN, DAY = 24 * HOUR;

export function remainUntil(targetMs: number, nowMs: number): Remain {
  const totalMs = targetMs - nowMs;
  if (totalMs <= 0) {
    return { totalMs, days: 0, hours: 0, minutes: 0, seconds: 0, past: true };
  }
  return {
    totalMs,
    days: Math.floor(totalMs / DAY),
    hours: Math.floor((totalMs % DAY) / HOUR),
    minutes: Math.floor((totalMs % HOUR) / MIN),
    seconds: Math.floor((totalMs % MIN) / SEC),
    past: false,
  };
}

/**
 * D-표기. **오늘이 D-0 이다.**
 *
 * 자료의 「D-55」는 09-08 기준 11-02 까지다. 그 값이 나오려면 **달력 날짜 차이**를
 * 세야 한다 — 남은 밀리초를 86400000 으로 나누면 시각에 따라 하루가 어긋난다
 * (11-02 00:00 목표일 때 09-08 09:00 이면 54.6일 → 54가 되어 D-54 로 적힌다).
 *
 * 그래서 **자정 기준으로 날짜만 빼서** 센다. 사람이 달력을 보고 세는 방식과 같다.
 */
export function dDay(targetMs: number, nowMs: number, timeZone = "Asia/Seoul"): number {
  const day = (ms: number) => {
    // 해당 시간대의 달력 날짜를 뽑아 UTC 자정으로 정규화한다.
    const [y, m, d] = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(ms)).split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((day(targetMs) - day(nowMs)) / DAY);
}

/** 두 자리 고정. `9` 가 아니라 `09` — 자릿수가 흔들리면 숫자가 춤춘다. */
export const pad2 = (n: number) => String(Math.max(0, n)).padStart(2, "0");
