// 지표 카드 4종 + 스파크라인 (Phase 3) — 값·시계열 모두 서버 집계 결과만 렌더
import type { Metric } from "@/lib/home";

const SPARK_COLOR: Record<string, string> = {
  doing: "var(--edu)",
  done: "var(--train)",
  decision: "var(--play)",
  stalled: "var(--danger)",
};

function sparkPoints(series: number[]): string {
  const max = Math.max(...series);
  const min = Math.min(...series);
  const span = max - min;
  return series
    .map((v, i) => {
      const x = 2 + (58 / Math.max(series.length - 1, 1)) * i;
      const y = span === 0 ? 17 : 29 - ((v - min) / span) * 25; // y범위 4~29 (높이 34)
      return `${Math.round(x)},${Math.round(y * 10) / 10}`;
    })
    .join(" ");
}

export default function MetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="metrics">
      {metrics.map((m) => (
        <div key={m.key} className={`mc ${m.alert ? "alert" : ""}`}>
          <div className="l">{m.label}</div>
          <div className="r">
            <div>
              <div className="v">
                {m.value}
                {m.em && <em>{m.em}</em>}
              </div>
              <div className={`d ${m.deltaTone}`}>{m.deltaText}</div>
            </div>
            <svg viewBox="0 0 62 34" aria-hidden="true">
              <polyline
                fill="none"
                style={{ stroke: SPARK_COLOR[m.key] ?? "var(--edu)" }}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                points={sparkPoints(m.spark)}
              />
            </svg>
          </div>
        </div>
      ))}
    </div>
  );
}
