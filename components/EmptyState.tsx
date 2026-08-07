"use client";

// 빈 상태 (파트 B) — 실데이터 초기의 빈 화면이 고장처럼 보이지 않게 안내 + 첫 행동 유도.
//
// §G 규격: **설명 + CTA + 아이콘 3요소.**
//
// 예전에는 `illustration="/empty/foo.svg"` 처럼 **자유 문자열 경로**를 받았고,
// 파일이 없으면 onError 로 슬롯을 조용히 숨겼다. 그 결과 앱 전체에 이미지가
// 하나도 없는 채로 **모든 화면이 2요소로 돌아가면서도 아무도 몰랐다**
// (MD-P-2026-025 지시 29). 조용히 규격을 어기는 코드가 가장 나쁘다.
//
// 그래서 두 가지를 바꿨다:
//   ① 경로 대신 **정해진 이름**(EmptyIcon)만 받는다 — 오타가 타입 오류가 된다.
//   ② 파일이 없으면 숨기지 않고 **콘솔에 오류를 남기고 자리를 비워둔 채 표시**한다.
//      추가로 `npm run build` 전에 scripts/check-empty-icons.mjs 가 파일 존재를 검사한다.
import type { ReactNode } from "react";

/** 공용 선화 5종 (지시 29-3). 화면마다 새로 만들지 않고 이 안에서 고른다. */
export const EMPTY_ICONS = ["tasks", "notes", "inbox", "chat", "handover"] as const;
export type EmptyIcon = (typeof EMPTY_ICONS)[number];

export default function EmptyState({
  icon = "tasks",
  title,
  hint,
  action,
  compact = false,
}: {
  /** 공용 아이콘 이름. 경로를 직접 넘기지 않는다 — 없는 파일을 가리킬 수 없게 하려는 것이다. */
  icon?: EmptyIcon;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "es-compact" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="es-illust"
        src={`/empty/${icon}.svg`}
        alt=""
        aria-hidden="true"
        onError={() => {
          // 숨기지 않는다. 숨기면 규격 위반이 조용히 지나간다 (지시 29-4).
          console.error(`[EmptyState] 아이콘 누락: /empty/${icon}.svg — public/empty/ 를 확인하세요.`);
        }}
      />
      <p className="es-title">{title}</p>
      {hint && <p className="es-hint">{hint}</p>}
      {action && <div className="es-action">{action}</div>}
    </div>
  );
}
