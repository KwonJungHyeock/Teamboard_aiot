"use client";

// 링 게이지 (파트 3 홈 밀도 재배분) — 진행률 바 여러 줄을 한 줄 요약 + 링 하나로 압축.
// 토큰만 사용. percent null이면 대시로 표기.
export default function RingGauge({
  percent,
  colorKey = "edu",
  size = 56,
}: {
  percent: number | null;
  colorKey?: string;
  size?: number;
}) {
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const dash = (p / 100) * c;
  const color =
    colorKey === "play"
      ? "var(--play-hi)"
      : colorKey === "train"
      ? "var(--train-hi)"
      : "var(--edu-hi)";
  return (
    <svg
      className="ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--track-bg)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="ring-t"
      >
        {percent === null ? "–" : `${Math.round(p)}%`}
      </text>
    </svg>
  );
}
