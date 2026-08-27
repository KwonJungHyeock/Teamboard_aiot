"use client";

// 현황 분석 (파트 2) — 서버 집계값만 렌더. 경량 인라인 SVG/CSS, 토큰 색만, chartjunk 없음.
import type { HomeSummary } from "@/lib/home";
import SectionEmpty from "./SectionEmpty";

// 주간 완료 추이 — 최근 8주 단색(green) area+line, tabular 축, 이번 주 강조
function WeeklyTrend({ data }: { data: HomeSummary["weeklyDone"] }) {
  const W = 340, H = 128, L = 8, R = 10, T = 14, B = 24;
  const n = data.length;
  const max = Math.max(1, ...data.map((d) => d.count));
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(n - 1, 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const pts = data.map((d, i) => `${x(i).toFixed(1)},${y(d.count).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `M${x(0).toFixed(1)},${(H - B).toFixed(1)} L${pts.join(" L")} L${x(n - 1).toFixed(1)},${(H - B).toFixed(1)} Z`;
  const last = data[n - 1];
  return (
    <section className="card an-card" aria-label="주간 완료 추이">
      <div className="ch"><h2>주간 완료 추이</h2><span className="sub">최근 8주</span></div>
      <svg viewBox={`0 0 ${W} ${H}`} className="an-svg" role="img" aria-label={`최근 8주 완료 추이, 이번 주 ${last.count}건`}>
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} className="an-axis" />
        <path d={area} className="an-area" />
        <path d={line} className="an-line" />
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.count)} r={i === n - 1 ? 3.6 : 2.2} className={i === n - 1 ? "an-dot cur" : "an-dot"} />
        ))}
        {data.map((d, i) =>
          i === n - 1 || i % 2 === 0 ? (
            <text key={i} x={x(i)} y={H - 8} className="an-xt" textAnchor="middle">
              {i === n - 1 ? "이번" : d.weekStart.slice(5).replace("-", "/")}
            </text>
          ) : null
        )}
        <text x={x(n - 1)} y={Math.max(y(last.count) - 8, 12)} className="an-cur-v" textAnchor="middle">{last.count}</text>
      </svg>
    </section>
  );
}

// 담당자별 부하 — 오픈 업무 stack(진행 blue · 대기 gray), 부하순
/* 「담당자별 부하」(LoadDist)는 §C 회신 1 에서 지웠다 —
   `components/AssigneeStatus.tsx` 가 같은 사람을 더 많은 사실로 말한다.
   한 화면에 사람별 블록이 둘이면 그게 §C 가 없애려던 중복이다. */

export default function AnalyticsCharts({
  weeklyDone,
}: {
  weeklyDone: HomeSummary["weeklyDone"];
}) {
  return (
    <div className="an-wrap">
      <WeeklyTrend data={weeklyDone} />
    </div>
  );
}
