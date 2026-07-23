// 목표 진척 바 (Phase 4) — null(산출 불가)은 "-" 표시 (검수 포인트 5)
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
      <div className="bar">
        <i
          className={colorKey ?? "edu"}
          style={{ width: `${Math.min(progress ?? 0, 100)}%` }}
        />
      </div>
      <span className="gpv">
        {progress === null ? "-" : `${progress}%`}
        {detail && <em>{detail}</em>}
      </span>
    </div>
  );
}
