"use client";

// 모션 유틸 (MD-P-2026-027 §H 구현).
//
// §H 는 CSS 로 끝나지 않는 항목이 셋 있다:
//   ① 진척 숫자 카운트업 (--dur-4)
//   ② 목록 필터·정렬 변경 FLIP (--dur-3)
//   ③ 값이 바뀐 칸 하이라이트 (400ms 유지 + 400ms 페이드)
// 셋 다 여기 모은다. 화면마다 따로 쓰면 시간이 갈리고, 갈리면 §H 가 문서로만 남는다.
//
// **시간·곡선은 전부 CSS 토큰에서 읽는다.** JS 안에 260 이나 520 을 적지 않는다 —
// 토큰을 고쳤을 때 따라오지 않는 숫자가 하나라도 있으면 규격이 두 벌이 된다.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { CHAIN_WINDOW_MS, GOAL_CHAIN_EVENT } from "./goal-chain";

/** 사용자가 모션을 줄여 달라고 했는지. SSR 에서는 false 로 본다. */
export function prefersReduced(): boolean {
  return typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/** `--dur-4` 같은 토큰을 ms 숫자로 읽는다. 없으면 fallback. */
export function durToken(name: string, fallback = 0): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  if (raw.endsWith("ms")) return parseFloat(raw);
  if (raw.endsWith("s")) return parseFloat(raw) * 1000;
  return parseFloat(raw) || fallback;
}

/**
 * 숫자 카운트업 (§H3 "진척 숫자 변경", `--dur-4`).
 *
 * 첫 렌더에서는 재생하지 않는다 — 화면에 들어오자마자 모든 숫자가 굴러가면
 * 무엇이 **바뀐** 것인지 알 수 없다. 값이 바뀐 순간에만 움직인다.
 * reduce 에서는 즉시 최종값.
 */
export function useCountUp(target: number, enabled = true): number {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const first = useRef(true);
  const raf = useRef<number>();

  useEffect(() => {
    if (first.current) { first.current = false; from.current = target; setShown(target); return; }
    if (!enabled || prefersReduced()) { from.current = target; setShown(target); return; }
    const start = from.current;
    const delta = target - start;
    if (delta === 0) return;
    const dur = durToken("--dur-4", 520);
    const t0 = performance.now();
    // --ease-out cubic-bezier(.2,.8,.2,1) 의 근사 — 숫자는 곡선의 정확도보다
    // "빠르게 시작해 부드럽게 멈춘다"가 읽히는 게 중요하다.
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / dur);
      setShown(Math.round(start + delta * ease(t)));
      if (t < 1) raf.current = requestAnimationFrame(tick);
      else from.current = target;
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [target, enabled]);

  return shown;
}

/**
 * FLIP (§H3 "목록 필터·정렬 변경", `--dur-3`).
 *
 * 이전 위치를 기억했다가, 다시 그려진 뒤 **원래 있던 자리로 되돌려 놓고** 0 으로 푼다.
 * 그래야 브라우저가 레이아웃을 다시 계산하지 않고 transform 만 움직인다.
 *
 * `deps` 가 바뀔 때만 동작한다 — 아무 때나 돌면 스크롤·타이핑 중에도 행이 미끄러진다.
 */
export function useFlip(containerRef: React.RefObject<HTMLElement>, key: string, itemSelector = "[data-flip]") {
  const prev = useRef<Map<string, number>>(new Map());

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(itemSelector));
    const next = new Map<string, number>();
    for (const el of items) {
      const id = el.dataset.flip ?? "";
      next.set(id, el.getBoundingClientRect().top);
    }
    if (prev.current.size > 0 && !prefersReduced()) {
      // 한 번에 움직이는 요소는 최대 3개다 (§H2). 위에서부터 셋만 옮기고 나머지는 그냥 앉는다.
      let moved = 0;
      for (const el of items) {
        const id = el.dataset.flip ?? "";
        const before = prev.current.get(id);
        const after = next.get(id);
        if (before === undefined || after === undefined) continue;
        const dy = before - after;
        if (Math.abs(dy) < 1 || moved >= 3) continue;
        moved += 1;
        el.style.transform = `translateY(${dy}px)`;
        el.style.transition = "none";
        requestAnimationFrame(() => {
          el.style.transition = `transform var(--dur-3) var(--ease-in-out)`;
          el.style.transform = "";
        });
      }
    }
    prev.current = next;
  }, [key, containerRef, itemSelector]);
}

/**
 * 값이 바뀐 칸 하이라이트 (§H3, 400ms 유지 후 400ms 페이드).
 *
 * 시간을 JS 에 적지 않는다 — CSS 애니메이션 `hl-cell` 이 유지·페이드를 다 갖고 있고,
 * 여기서는 클래스를 붙였다 떼기만 한다. 떼는 시점은 animationend 가 알려 준다.
 */
export function useHighlight(): [Set<string>, (key: string) => void] {
  const [hot, setHot] = useState<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const flash = useCallback((key: string) => {
    if (prefersReduced()) return;
    setHot((s) => new Set(s).add(key));
    const old = timers.current.get(key);
    if (old) clearTimeout(old);
    // 유지 + 페이드. 길이는 --dur-hl 에서 읽는다 — CSS 의 hl-cell 과 같은 출처여야
    // 토큰을 고쳤을 때 한쪽만 따라가는 일이 없다.
    timers.current.set(key, setTimeout(() => {
      setHot((s) => { const n = new Set(s); n.delete(key); return n; });
      timers.current.delete(key);
    }, durToken("--dur-hl", 400) * 2));
  }, []);

  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);
  return [hot, flash];
}

/**
 * 나가는 행 (§H3 "행 제거", `--dur-2`).
 *
 * 목록에서 사라진 항목을 **한 사이클만** 붙잡아 둔다. 붙잡지 않으면 사라지는 순간이
 * 없어서 애니메이션할 대상 자체가 없다. reduce 에서는 붙잡지 않고 그냥 사라진다.
 */
export function useExiting<T extends { id: number }>(rows: T[]): { rows: T[]; exiting: Set<number> } {
  const [held, setHeld] = useState<T[]>([]);
  const [exiting, setExiting] = useState<Set<number>>(new Set());
  const prev = useRef<T[]>(rows);

  useEffect(() => {
    const now = new Set(rows.map((r) => r.id));
    const gone = prev.current.filter((r) => !now.has(r.id));
    prev.current = rows;
    if (gone.length === 0 || prefersReduced()) { setHeld([]); setExiting(new Set()); return; }
    // 한 번에 움직이는 요소는 최대 3개 (§H2)
    const keep = gone.slice(0, 3);
    setHeld(keep);
    setExiting(new Set(keep.map((r) => r.id)));
    const t = setTimeout(() => { setHeld([]); setExiting(new Set()); }, durToken("--dur-2", 180));
    return () => clearTimeout(t);
  }, [rows]);

  return { rows: held.length ? [...rows, ...held] : rows, exiting };
}

/**
 * 목표 트리 연쇄 카운트업 (§H4-②).
 *
 * 층(월 0 · 분기 1 · 연간 2)마다 `--stagger-2` 만큼 늦게 시작하고, 각 층은 `--dur-4` 동안 오른다.
 * 순서가 보여야 하므로 `--stagger-1`(20ms)이 아니라 `--stagger-2`(60ms)를 쓴다.
 *
 * 재생 조건은 셋 다 만족해야 한다:
 *   ① 사용자가 직접 값을 바꿨다 — GOAL_CHAIN_EVENT 가 최근에 왔다
 *   ② 값이 실제로 바뀌었다
 *   ③ 그 행이 **지금 화면에 보인다**
 *
 * ③ 이 없으면 스크롤 아래에서 혼자 재생되고 끝난다. 사용자는 아무것도 못 본다.
 * 그리고 **나중에 보일 때도 재생하지 않는다** — 그때는 "방금 내가 한 일"이 아니다.
 *
 * 연달아 바꾸면 세대가 올라간다. 진행 중이던 연쇄는 타이머·RAF 를 끊고 최신 값으로 다시 시작한다 —
 * 겹쳐 쌓이면 숫자가 두 방향으로 동시에 굴러간다.
 */
export function useGoalChainCountUp(
  target: number | null,
  level: number,
  ref: React.RefObject<HTMLElement>,
): number | null {
  const [shown, setShown] = useState<number | null>(target);
  const from = useRef<number | null>(target);
  const armed = useRef(0);          // 사용자가 값을 바꾼 시각
  const raf = useRef<number>();
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    const onChain = () => { armed.current = performance.now(); };
    window.addEventListener(GOAL_CHAIN_EVENT, onChain);
    return () => window.removeEventListener(GOAL_CHAIN_EVENT, onChain);
  }, []);

  useEffect(() => {
    const stop = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      if (timer.current) clearTimeout(timer.current);
    };
    stop();                                   // 진행 중이던 연쇄를 먼저 끊는다

    const start = from.current;
    from.current = target;
    if (target === null || start === null || start === target) { setShown(target); return; }

    const fresh = performance.now() - armed.current < CHAIN_WINDOW_MS;
    const el = ref.current;
    const visible = !!el && (() => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0;
    })();

    if (!fresh || !visible || prefersReduced()) { setShown(target); return; }

    setShown(start);
    const dur = durToken("--dur-4", 520);
    const gap = durToken("--stagger-2", 60) * level;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    timer.current = setTimeout(() => {
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        setShown(Math.round(start + (target - start) * ease(t)));
        if (t < 1) raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    }, gap);

    return stop;
  }, [target, level, ref]);

  return shown;
}
