// 지표 카드 5종 + 스파크라인 (Mission Deck 재편) — 값·시계열 모두 서버 집계 결과만 렌더.
// 완료·달성·리스크는 코랄 액센트. "막힌 업무"는 placeholder(자리만) — 다음 단계에서 활성화.
import type { Metric } from "@/lib/home";

const SPARK_COLOR: Record<string, string> = {
  doing: "var(--edu)",
  done: "var(--coral)",
  myTurn: "var(--amber)",
  stalled: "var(--coral)",
  blocked: "var(--muted)",
};

function sparkPoints(series: number[]): string {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min;
  return series
    .map((v, i) => {
      const x = 2 + (58 / Math.max(series.length - 1, 1)) * i;
      const y = span === 0 ? 21 : 37 - ((v - min) / span) * 33; // y범위 4~37 (높이 42)
      return `${Math.round(x)},${Math.round(y * 10) / 10}`;
    })
    .join(" ");
}

export default function MetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metrics">
      {metrics.map((m) => (
        <div key={m.key} className={`mc mc-${m.key} ${m.alert ? "alert" : ""} ${m.placeholder ? "ph" : ""}`}>
          <div className="l">{m.label}</div>
          <div className="r">
            <div>
              <div className="v">
                {m.value}
                {m.em && <em>{m.em}</em>}
              </div>
              <div className={`d ${m.deltaTone}`}>{m.deltaText}</div>
            </div>
            {m.placeholder ? (
              <span className="ph-tag">다음 단계</span>
            ) : (
              <svg viewBox="0 0 62 42" aria-hidden="true">
                <polyline
                  fill="none"
                  style={{ stroke: SPARK_COLOR[m.key] ?? "var(--ink-soft)" }}
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={sparkPoints(m.spark)}
                />
              </svg>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
