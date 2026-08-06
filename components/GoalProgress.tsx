// 목표 진척 바 — null(집계 대상 없음)은 "집계 없음" + 흐린 빈 바.
// 0%(집계했더니 0)와 반드시 다르게 보여야 한다 (MD-P-2026-009 §C · MD-P-2026-024 규칙 5).
// detail 은 분모 근거("업무 14건 기준") 자리다 — 지시 1.
// 기간이 끝난 목표는 closing 을 넘긴다 — "57% · 7/31 마감 기준" 또는
// "기간 종료 · 마감 기록 없음". 수동 배지는 붙이지 않는다(손으로 넣은 값이 아니다).
import { closingLabel, type GoalClosing } from "@/lib/progress";
export default function GoalProgress({
  progress,
  colorKey,
  detail,
  closing,
}: {
  progress: number | null;
  colorKey?: string | null;
  detail?: string;
  /** 기간이 끝난 목표면 넘긴다 — 지금 집계 대신 마감 기록을 보여준다 (지시 7) */
  closing?: GoalClosing;
}) {
  // 기간이 끝났으면 "지금 얼마"가 아니라 "끝났을 때 얼마"다.
  // 마감 기록이 없으면 값을 만들지 않는다 — 없다고 말한다.
  const ended = closing?.ended === true;
  const shown = ended ? closing!.progress : progress;
  const label = ended ? closingLabel(closing!) : null;

  return (
    <div className="gprog">
      <div className={`bar${shown === null ? " empty" : ""}`}>
        {shown !== null && (
          <i className={colorKey ?? "edu"} style={{ width: `${Math.min(shown, 100)}%` }} />
        )}
      </div>
      <span className={`gpv${shown === null ? " none" : ""}`}>
        {ended ? label : shown === null ? "집계 없음" : `${shown}%`}
        {!ended && detail && <em>{detail}</em>}
      </span>
    </div>
  );
}
