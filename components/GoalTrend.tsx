"use client";

// 목표 월별 추이 미니 차트 (MD-P-2026-011 §E)
// 스냅샷이 있는 달만 점으로 찍는다. 빈 달을 건너뛰고 선을 이으면 없던 값을 만들어낸 셈이 되므로,
// 연속한 달끼리만 선분을 그린다. 점이 하나뿐이면 선 없이 점만 남긴다.
import { useMemo } from "react";

export interface TrendPoint { ym: string; date: string; progress: number | null }

/** 'YYYY-MM' 두 개가 바로 이웃한 달인지 */
function isAdjacent(a: string, b: string): boolean {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return by * 12 + bm - (ay * 12 + am) === 1;
}

export default function GoalTrend({ points }: { points: TrendPoint[] }) {
  const W = 260, H = 64, PAD = 8;

  const { dots, segments, months } = useMemo(() => {
    const valid = points.filter((p) => p.progress !== null) as (TrendPoint & { progress: number })[];
    if (valid.length === 0) return { dots: [], segments: [] as string[], months: [] as string[] };
    const n = Math.max(valid.length - 1, 1);
    const x = (i: number) => PAD + (i * (W - PAD * 2)) / n;
    const y = (v: number) => H - PAD - (v / 100) * (H - PAD * 2);
    const dots = valid.map((p, i) => ({ ...p, cx: x(i), cy: y(p.progress) }));
    // 이웃한 달끼리만 선을 잇는다 (빈 구간을 가로지르지 않게)
    const segments: string[] = [];
    for (let i = 1; i < dots.length; i++) {
      if (isAdjacent(dots[i - 1].ym, dots[i].ym)) {
        segments.push(`M ${dots[i - 1].cx} ${dots[i - 1].cy} L ${dots[i].cx} ${dots[i].cy}`);
      }
    }
    return { dots, segments, months: valid.map((p) => p.ym.slice(5)) };
  }, [points]);

  if (dots.length === 0) {
    return (
      <p className="tdp-muted">
        아직 적립된 스냅샷이 없어요. 매일 자정 이후 자동으로 쌓이고, 여기에 월별 추이가 그려집니다.
      </p>
    );
  }

  const gapped = dots.length > 1 && segments.length < dots.length - 1;

  return (
    <div className="gtr">
      <svg viewBox={`0 0 ${W} ${H}`} className="gtr-svg" role="img"
        aria-label={`월별 진척 추이 ${dots.map((d) => `${d.ym} ${d.progress}%`).join(", ")}`}>
        {[0, 50, 100].map((v) => (
          <line key={v} x1={PAD} x2={W - PAD}
            y1={H - PAD - (v / 100) * (H - PAD * 2)} y2={H - PAD - (v / 100) * (H - PAD * 2)}
            className="gtr-grid" />
        ))}
        {segments.map((d, i) => <path key={i} d={d} className="gtr-line" />)}
        {dots.map((d) => (
          <g key={d.ym}>
            <circle cx={d.cx} cy={d.cy} r={3.5} className="gtr-dot" />
            <title>{d.ym} · {d.progress}% ({d.date} 기준)</title>
          </g>
        ))}
      </svg>
      <div className="gtr-x">
        {months.map((m, i) => <span key={i} className="num">{m}월</span>)}
      </div>
      {gapped && (
        <p className="gtr-note">스냅샷이 없는 달은 선을 잇지 않습니다 — 없는 값을 만들어내지 않기 위해서입니다.</p>
      )}
    </div>
  );
}
