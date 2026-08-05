"use client";

// 속성 블록 (MD-P-2026-019 §F1) — 라벨(88px) + 값의 한 줄 그리드.
// 값은 그 자리에서 편집한다. 화면 이동 없음.
// 비어 있으면 빈칸이 아니라 "＋ 목표 연결" 같은 행동 문구를 보여준다.
import { useState, type ReactNode } from "react";

export interface PropRow {
  key: string;
  label: string;
  /** 값이 있으면 이 노드를 그린다 */
  value: ReactNode;
  /** 값이 비었는지 — true 면 action 문구를 대신 그린다 */
  empty?: boolean;
  /** 비었을 때 보여줄 행동 문구 (예: "＋ 목표 연결") */
  action?: string;
  /** 클릭 시 열리는 편집기. 없으면 읽기 전용 행 */
  editor?: (close: () => void) => ReactNode;
}

export default function PropertyBlock({
  rows,
  /** 이 개수를 넘는 분은 접을 수 있다 (MD-P-2026-020 §F1: 5개 초과분) */
  collapseAfter = 5,
  /** 기본 펼침 (§F1). false 면 처음부터 접힌 채로 시작한다 */
  defaultExpanded = true,
}: {
  rows: PropRow[];
  collapseAfter?: number;
  defaultExpanded?: boolean;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(defaultExpanded);

  const shown = expanded ? rows : rows.slice(0, collapseAfter);
  const hidden = rows.length - shown.length;

  return (
    <div className="prop">
      {shown.map((r) => (
        <div className={`prop-row${openKey === r.key ? " open" : ""}`} key={r.key}>
          <span className="prop-l">{r.label}</span>
          {r.editor ? (
            <button
              className={`prop-v${r.empty ? " empty" : ""}`}
              aria-expanded={openKey === r.key}
              onClick={() => setOpenKey(openKey === r.key ? null : r.key)}
            >
              {r.empty ? (r.action ?? "＋ 지정") : r.value}
            </button>
          ) : (
            <span className={`prop-v ro${r.empty ? " empty" : ""}`}>{r.empty ? (r.action ?? "—") : r.value}</span>
          )}
          {openKey === r.key && r.editor && (
            <div className="prop-pop" role="dialog" aria-label={`${r.label} 편집`}>
              {r.editor(() => setOpenKey(null))}
            </div>
          )}
        </div>
      ))}
      {hidden > 0 && (
        <button className="prop-more" onClick={() => setExpanded(true)}>속성 더보기 {hidden}개</button>
      )}
      {expanded && rows.length > collapseAfter && (
        <button className="prop-more" onClick={() => setExpanded(false)}>속성 접기</button>
      )}
    </div>
  );
}
