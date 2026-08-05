"use client";

// 목록 = 행(row) (MD-P-2026-019 §C). 카드 금지.
// 행 38px 고정 · 12.5px · 좌우 13px · 구분선 --hair · hover --surface-2 120ms.
// 승인 대기·논의·활동 등 기존 카드형 목록도 Phase 2에서 이 컴포넌트로 전환한다.
import type { ReactNode } from "react";

export interface Col {
  key: string;
  label: string;
  /** 폭. 생략하면 남는 공간을 나눠 갖는다(제목 컬럼용) */
  w?: string;
  /** 숫자·기한·%는 우측 정렬 + mono (§C·§G) */
  num?: boolean;
}

export function DataHead({ cols }: { cols: Col[] }) {
  return (
    <div className="dl-head" role="row">
      {cols.map((c) => (
        <span key={c.key} role="columnheader" className={`dl-c${c.num ? " num" : ""}`} style={c.w ? { width: c.w, flex: "0 0 auto" } : undefined}>
          {c.label}
        </span>
      ))}
    </div>
  );
}

export function DataRow({
  cols, cells, onClick, selected, tone,
}: {
  cols: Col[];
  /** cols 와 같은 길이. 셀 내용 */
  cells: ReactNode[];
  onClick?: () => void;
  selected?: boolean;
  /** 좌측 3px 강조선 — 지연 등 (코랄은 지연·리스크에만) */
  tone?: "risk" | null;
}) {
  return (
    <div
      role="row"
      tabIndex={onClick ? 0 : undefined}
      className={`dl-row${onClick ? " click" : ""}${selected ? " on" : ""}${tone === "risk" ? " risk" : ""}`}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") { e.preventDefault(); onClick(); } } : undefined}
    >
      {cols.map((c, i) => (
        <span key={c.key} role="cell" className={`dl-c${c.num ? " num" : ""}`} style={c.w ? { width: c.w, flex: "0 0 auto" } : undefined}>
          {cells[i]}
        </span>
      ))}
    </div>
  );
}

/** 상태 = LED 점(6px) + 라벨. 발광·애니 금지 (§C) */
export function Led({ tone, label }: { tone: string; label: string }) {
  return (
    <span className="dl-led">
      <i style={{ background: `var(${tone})` }} aria-hidden="true" />
      {label}
    </span>
  );
}

/** 진행률 = 폭 52px 바 + 우측 % (§C) */
export function Bar({ value }: { value: number | null }) {
  if (value == null) return <span className="dl-bar-na num" title="연결된 데이터가 없어 계산할 수 없습니다">—</span>;
  return (
    <span className="dl-bar">
      <i><b style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></i>
      <em className="num">{value}%</em>
    </span>
  );
}

/** 빈 상태 3요소 — 한 줄 설명 + 다음 행동 CTA (§G). 빈 박스 금지 */
export function DataEmpty({ text, action }: { text: string; action?: ReactNode }) {
  return (
    <div className="dl-empty">
      <p>{text}</p>
      {action}
    </div>
  );
}

/** 스켈레톤 — 스피너 대신. 행 높이를 그대로 잡아 CLS 를 만들지 않는다 (§G) */
export function DataSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="dl-skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => <span key={i} />)}
    </div>
  );
}
