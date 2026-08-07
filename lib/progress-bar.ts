// 진척 바 채움값 (MD-P-2026-027 §H2 · H3).
//
// §H2: **진척 바는 `width` 가 아니라 `transform: scaleX()`, `transform-origin: left`.**
// width 를 애니메이션하면 매 프레임 레이아웃을 다시 계산한다. scaleX 는 합성만 한다.
//
// 채움 요소는 항상 폭 100% 로 앉아 있고, 실제로 보이는 길이는 `--p`(0~1) 가 정한다.
// 인라인으로 `transform` 을 직접 쓰지 않는 이유: 그러면 `transition` 을 어디에 걸지
// 화면마다 갈리고, reduce 예외도 화면마다 따로 써야 한다. 값 하나만 넘기고
// 나머지는 CSS 한 곳(`app/design.css` §H)이 정한다.
import type { CSSProperties } from "react";

/** 0~100 을 받아 채움 요소에 그대로 넘길 style 을 만든다. 범위 밖 값은 잘라 낸다. */
export function pfill(percent: number | null | undefined): CSSProperties {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return { "--p": p / 100 } as CSSProperties;
}
