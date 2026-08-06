// 목표 진척 바 — null(집계 대상 없음)은 "집계 없음" + 흐린 빈 바.
// 0%(집계했더니 0)와 반드시 다르게 보여야 한다 (MD-P-2026-009 §C · MD-P-2026-024 규칙 5).
// detail 은 분모 근거("업무 14건 기준") 자리다 — 지시 1.
export default function GoalProgress({
  progress,
  colorKey,
  detail,
}: {
  progress: number | null;
  colorKey?: string | null;
  detail?: string;
}) {
  return (
    <div className="gprog">
      <div className={`bar${progress === null ? " empty" : ""}`}>
        {progress !== null && (
          <i className={colorKey ?? "edu"} style={{ width: `${Math.min(progress, 100)}%` }} />
        )}
      </div>
      <span className={`gpv${progress === null ? " none" : ""}`}>
        {progress === null ? "집계 없음" : `${progress}%`}
        {detail && <em>{detail}</em>}
      </span>
    </div>
  );
}
