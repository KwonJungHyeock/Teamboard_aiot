"use client";

// 다중 선택 일괄 지정 줄 (MD-P-2026-024 지시 21 → 027 §D3 로 공용화).
//
// 목표 미연결 일괄 연결 화면(UnlinkedTaskPanel)이 쓰던 `.utp-bulk` 그대로다.
// §D3 이 "업무 목록 다중 선택 → 프로젝트 일괄 지정"을 요구하면서 같은 것이 두 번째로
// 필요해졌다. 두 벌을 만들면 선택 개수 표기·해제 버튼·비활성 조건이 갈린다.
// 시각 토큰을 새로 만들지 않는다 — 기존 규격을 컴포넌트로 꺼냈을 뿐이다.
import type { ReactNode } from "react";

export default function BulkBar({
  count, total, unit = "건", onClear, children,
}: {
  /** 선택된 개수 */
  count: number;
  /** 아무것도 안 골랐을 때 보여줄 전체 개수 */
  total: number;
  unit?: string;
  onClear: () => void;
  /** 실제 동작(셀렉트 + 실행 버튼). 화면마다 다른 것은 이것뿐이다. */
  children: ReactNode;
}) {
  return (
    <div className="utp-bulk">
      <span className="utp-n num">{count > 0 ? `${count}${unit} 선택` : `${total}${unit}`}</span>
      {children}
      {count > 0 && <button className="btn-ghost" onClick={onClear}>선택 해제</button>}
    </div>
  );
}
