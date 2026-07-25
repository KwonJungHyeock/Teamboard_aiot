"use client";

// 빈 상태 (파트 B) — 실데이터 초기의 빈 화면이 고장처럼 보이지 않게 안내 + 첫 행동 유도.
// 일러스트 슬롯은 파일이 있을 때만 표시(없으면 숨김), 문구는 항상 표시한다.
import type { ReactNode } from "react";

export default function EmptyState({
  illustration,
  title,
  hint,
  action,
  compact = false,
}: {
  /** public/ 기준 이미지 경로. 파일이 없으면(onError) 자동으로 숨김. */
  illustration?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? "es-compact" : ""}`}>
      {illustration && (
        // 파일 부재 시 onError로 슬롯을 접는다 — 일러스트 도착 전까지 문구만 노출.
        <img
          className="es-illust"
          src={illustration}
          alt=""
          aria-hidden="true"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <p className="es-title">{title}</p>
      {hint && <p className="es-hint">{hint}</p>}
      {action && <div className="es-action">{action}</div>}
    </div>
  );
}
