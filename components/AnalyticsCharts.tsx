"use client";

// 현황 분석 (파트 2) — 서버 집계값만 렌더. 경량 인라인 SVG/CSS, 토큰 색만, chartjunk 없음.
import type { HomeSummary } from "@/lib/home";

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
function LoadDist({ data }: { data: HomeSummary["assigneeLoad"] }) {
  const max = Math.max(1, ...data.map((d) => d.doing + d.waiting));
  return (
    <section className="card an-card" aria-label="담당자별 부하">
      <div className="ch"><h2>담당자별 부하</h2><span className="sub">오픈 업무</span></div>
      {data.length === 0 ? (
        <p className="an-empty">오픈 업무가 없어요</p>
      ) : (
        <div className="an-load">
          {data.map((d) => {
            const total = d.doing + d.waiting;
            return (
              <div className="an-row" key={d.name}>
                <span className="an-name">{d.name}</span>
                <div className="an-track">
                  {d.doing > 0 && <i className="an-doing" style={{ width: `${(d.doing / max) * 100}%` }} title={`진행 ${d.doing}`} />}
                  {d.waiting > 0 && <i className="an-wait" style={{ width: `${(d.waiting / max) * 100}%` }} title={`대기 ${d.waiting}`} />}
                </div>
                <span className="an-n">{total}</span>
              </div>
            );
          })}
          <div className="an-legend">
            <span><i className="lg-doing" />진행</span>
            <span><i className="lg-wait" />대기</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default function AnalyticsCharts({
  weeklyDone, assigneeLoad,
}: {
  weeklyDone: HomeSummary["weeklyDone"];
  assigneeLoad: HomeSummary["assigneeLoad"];
}) {
  return (
    <div className="an-wrap">
      <WeeklyTrend data={weeklyDone} />
      <LoadDist data={assigneeLoad} />
    </div>
  );
}
