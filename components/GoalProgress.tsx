// 목표 진척 바 — null(집계 대상 없음)은 "집계 없음" + 흐린 빈 바.
// 0%(집계했더니 0)와 반드시 다르게 보여야 한다 (MD-P-2026-009 §C · MD-P-2026-024 규칙 5).
// detail 은 분모 근거("업무 14건 기준") 자리다 — 지시 1.
// 기간이 끝난 목표는 closing 을 넘긴다 — "57% · 7/31 마감 기준" 또는
// "기간 종료 · 마감 기록 없음". 수동 배지는 붙이지 않는다(손으로 넣은 값이 아니다).
"use client";

import { useRef } from "react";
import { closingLabel, progressDisplay, type GoalClosing } from "@/lib/progress";
import { pfill } from "@/lib/progress-bar";
import { useGoalChainCountUp } from "@/lib/motion";

/** §H4-② 연쇄 순서 — 월이 먼저 오르고, 그다음 분기, 마지막이 연간. */
const CHAIN_LEVEL: Record<string, number> = { month: 0, quarter: 1, year: 2 };
export default function GoalProgress({
  progress,
  colorKey,
  detail,
  closing,
  counted,
  periodType,
}: {
  progress: number | null;
  colorKey?: string | null;
  detail?: string;
  /** 기간이 끝난 목표면 넘긴다 — 지금 집계 대신 마감 기록을 보여준다 (지시 7) */
  closing?: GoalClosing;
  /** 집계 대상 업무 수. 3건 미만이면 막대를 그리지 않는다 (지시 16) */
  counted?: number;
  /** §H4-② 연쇄에서 이 목표가 몇 번째 층인지 정한다. 없으면 카운트업하지 않는다. */
  periodType?: "month" | "quarter" | "year";
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 기간이 끝났으면 "지금 얼마"가 아니라 "끝났을 때 얼마"다.
  // 마감 기록이 없으면 값을 만들지 않는다 — 없다고 말한다.
  const ended = closing?.ended === true;
  const shown = ended ? closing!.progress : progress;
  const label = ended ? closingLabel(closing!) : null;
  // 표시 결정은 lib/progress.ts 한 곳에서 나온다 (지시 30-5) — 연간 카드와 같은 함수다.
  // 기간이 끝난 목표의 마감 기록은 실제 기록이므로 표본 가드를 적용하지 않는다.
  const d = progressDisplay(shown, ended ? undefined : counted);
  const drawBar = d.drawBar;

  // 사용자가 업무 값을 바꿨을 때만, 그리고 이 행이 화면에 보일 때만 굴러간다 (§H4-②).
  // 그 밖에는 늘 최종값 그대로다 — 재진입·폴링·필터 변경에서 숫자가 뛰면 서사가 아니라 소음이다.
  const anim = useGoalChainCountUp(shown, CHAIN_LEVEL[periodType ?? ""] ?? 0, ref);
  const live = periodType ? anim : shown;

  return (
    <div className="gprog" ref={ref}>
      <div className={`bar${drawBar ? "" : " empty"}`}>
        {drawBar && (
          <i className={colorKey ?? "edu"} style={pfill(live ?? shown!)} />
        )}
      </div>
      <span className={`gpv${d.hasValue ? (d.lowConfidence ? " low" : "") : " none"}`}>
        {ended ? label : d.hasValue ? `${live ?? shown}%` : "집계 없음"}
        {/* 30-1 — 표본 부족이어도 값을 감추지 않는다. 근거를 옆에 붙여 신뢰도를 말한다:
            "100% · 업무 1건 — 표본 부족". 값을 감추면 상세를 열어야 확인이 된다. */}
        {!ended && d.hasValue && (d.lowConfidence ? <em>{d.basis}</em> : detail && <em>{detail}</em>)}
      </span>
    </div>
  );
}
