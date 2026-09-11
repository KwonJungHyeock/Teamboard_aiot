"use client";

// v3 「집계」 그림 — 완료율 고리 셋 + 상태 분포 막대 (MD-P-2026-056 §B).
//
// ── 색을 값에 따라 바꾸지 않는다 ────────────────────────────────
//
// 고리 셋은 **같은 파랑**이다. 「몇 %부터 초록」의 기준선이 `config` 에도
// `goal` 에도 없다 — 없는 기준으로 칠한 색은 읽는 사람에게 없는 판단을 준다.
// 기준을 만드는 것은 이번 일이 아니다(지시 §C). **없으면 안 칠한다.**
//
// ── 색만으로 구분하지 않는다 ────────────────────────────────────
//
// 막대 조각마다 **숫자를 직접 적고** 사이를 띄운다. 색각 검사에서 한 쌍이
// 경계에 걸렸다고 지시서에 적혀 있다. 숫자가 있으면 색을 못 읽어도 읽힌다.
// 표로 보기(§B-4)가 그 자리를 한 번 더 받친다.
import { useState } from "react";
import {
  ringDash, ringHover, segHover, DIST_SEGMENTS,
  type Ring, type Segment,
} from "@/lib/v3/stats";

/** 고리 색 — 셋 다 같다. 값에 따라 안 바뀐다. */
const RING = "#2F6FED";
const TRACK = "#E7ECF4";
const R = 52;
const STROKE = 12;
const BOX = (R + STROKE) * 2;

export function RingChart({ ring }: { ring: Ring }) {
  const { dash, circumference } = ringDash(ring.pct, R);
  const title = ringHover(ring);
  return (
    <figure className="v3-ring" title={title}>
      {/* 호버 영역이 **조각보다 크다** — `title` 을 figure 에 달아서 고리 바깥
          여백에 올려도 잡힌다 (지시 §B-5). */}
      <svg viewBox={`0 0 ${BOX} ${BOX}`} role="img" aria-label={title}>
        <circle cx={BOX / 2} cy={BOX / 2} r={R} fill="none" stroke={TRACK} strokeWidth={STROKE} />
        {/* 12시에서 시작해 시계 방향. 0% 면 획이 없다 — 점 하나도 안 남긴다. */}
        {ring.pct > 0 && (
          <circle
            cx={BOX / 2} cy={BOX / 2} r={R} fill="none" stroke={RING} strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference - dash}`}
            transform={`rotate(-90 ${BOX / 2} ${BOX / 2})`}
          />
        )}
        <text className="v3-ring-p" x="50%" y="47%" textAnchor="middle">{ring.pct}%</text>
        <text className="v3-ring-n" x="50%" y="64%" textAnchor="middle">
          {ring.done} / {ring.total}건
        </text>
      </svg>
      <figcaption>
        <b>{ring.label}</b>
        {/* 「남은 것 34건 · 111일」 — 건수와 날짜를 함께 둔다.
            건수만 있으면 급한지 모르고, 날짜만 있으면 얼마나인지 모른다. */}
        <span>남은 것 {ring.left}건 · {ring.daysLeft}일</span>
      </figcaption>
    </figure>
  );
}

export function DistBar({ segments, total }: { segments: Segment[]; total: number }) {
  return (
    <>
      {/* 0건인 구간은 **안 그린다.** 폭 0짜리 조각은 사이 틈만 남겨서
          없는 것이 있는 것처럼 보인다. 범례에는 0으로 남는다. */}
      <div className="v3-bar2" role="img"
           aria-label={segments.map((s) => `${s.label} ${s.n}건`).join(", ")}>
        {segments.filter((s) => s.n > 0).map((s) => (
          <span key={s.key} className="v3-bar2-s" title={segHover(s, total)}
                style={{ width: `${s.pct}%`, background: s.color, color: s.ink }}>
            {/* 조각에 **숫자를 직접 적는다.** 좁아서 안 들어가면 넘치게 두지 않고
                감추되, 범례와 표에 같은 숫자가 있다. */}
            <b>{s.n}</b>
          </span>
        ))}
      </div>
      <ul className="v3-legend">
        {segments.map((s) => (
          <li key={s.key} title={segHover(s, total)}>
            <i style={{ background: s.color }} aria-hidden="true" />
            {s.label} <b>{s.n}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * 같은 숫자를 표로 (지시 §B-4).
 *
 * **색을 못 읽는 경우를 위한 자리다.** 그림과 다른 숫자를 내면 안 되므로
 * 같은 `Ring`·`Segment` 를 받아서 그린다 — 여기서 다시 세지 않는다.
 */
export function ChartTable({ rings, segments, total }: {
  rings: Ring[]; segments: Segment[]; total: number;
}) {
  return (
    <div className="v3-tw">
      <table className="v3-tbl">
        <thead>
          <tr>
            <th scope="col">기간</th>
            <th scope="col" className="n">완료</th>
            <th scope="col" className="n">전체</th>
            <th scope="col" className="n">완료율</th>
            <th scope="col" className="n">남은 것</th>
            <th scope="col" className="n">남은 날</th>
          </tr>
        </thead>
        <tbody>
          {rings.map((r) => (
            <tr key={r.key} className={r.total === 0 ? "zero" : ""}>
              <th scope="row">{r.label}</th>
              <td className="n">{r.done}</td>
              <td className="n">{r.total}</td>
              <td className="n">{r.pct}%</td>
              <td className="n">{r.left}</td>
              <td className="n">{r.daysLeft}일</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="v3-tbl v3-tbl-2">
        <thead>
          <tr>
            <th scope="col">상태</th>
            {DIST_SEGMENTS.map((s) => <th key={s.key} scope="col" className="n">{s.label}</th>)}
            <th scope="col" className="n sum">합계</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">건수</th>
            {segments.map((s) => <td key={s.key} className="n">{s.n}</td>)}
            <td className="n sum">{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** 그림 ↔ 표 토글. 기본은 그림이고, **주소에 안 담는다**(지시 §B-4). */
export function ChartToggle({ rings, segments, total }: {
  rings: Ring[]; segments: Segment[]; total: number;
}) {
  const [table, setTable] = useState(false);
  return (
    <>
      <div className="v3-charts">
        {table
          ? <ChartTable rings={rings} segments={segments} total={total} />
          : (<>
            <div className="v3-rings">
              {rings.map((r) => <RingChart key={r.key} ring={r} />)}
            </div>
            <DistBar segments={segments} total={total} />
          </>)}
      </div>
      <button type="button" className="v3-btn v3-btn-s v3-chartbtn"
              aria-pressed={table} onClick={() => setTable((v) => !v)}>
        {table ? "그림으로 보기" : "표로 보기"}
      </button>
    </>
  );
}
