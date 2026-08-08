"use client";

// 섹션 빈 상태 (MD-P-2026-026 §A · 확정 B-7) — 화면의 **일부 블록**만 비었을 때.
//
// 전체 빈 상태(EmptyState)와 규격이 다르다. 화면 전체가 비었을 때만 그림과 버튼을 쓴다.
// 위젯 하나가 비었다고 88px 삽화와 코랄 버튼을 띄우면, 화면 하나에 CTA 가 여섯 개 생기고
// 어느 것이 지금 할 일인지 알 수 없게 된다.
//
// §G 규격:
//   · 아이콘 없음
//   · 한 줄 · 12.5px · var(--muted) · 높이 38~56px
//   · 행동 유도는 **텍스트 링크 하나**까지. 버튼 금지.
//
// action 을 ReactNode 로 받지 않는 것은 의도다. ReactNode 면 언젠가 누군가
// <button className="btn-primary"> 를 넣고, 규격은 조용히 깨진다.
// 받을 수 있으면 언젠가 쓰이게 된다 — 그래서 받지 않는다.
import Link from "next/link";

/** 텍스트 링크 하나. href 또는 onClick 중 하나만 의미가 있다. */
export interface SectionEmptyAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export default function SectionEmpty({
  text,
  action,
}: {
  /** 한 문장. 마침표는 붙이지 않는다 (§G). */
  text: string;
  action?: SectionEmptyAction;
}) {
  return (
    <div className="sec-empty">
      <p>{text}</p>
      {action &&
        (action.href ? (
          <Link className="sec-empty-a" href={action.href}>
            {action.label}
          </Link>
        ) : (
          <button className="sec-empty-a" type="button" onClick={action.onClick}>
            {action.label}
          </button>
        ))}
    </div>
  );
}
