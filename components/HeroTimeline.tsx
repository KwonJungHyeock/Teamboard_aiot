"use client";

// 히어로 팀 타임라인 (테마 재편 §4) — 홈 전용 다크 앵커 패널. [요약 ⇄ 상세] 클라이언트 토글.
//  · 요약: 영역별 그룹 롤업(바 1개=영역, min(start)~max(end), 라벨 "N개 · 평균%").
//  · 상세: 개별 업무 바(#ID 제목, start~end, 담당·%·T+nd).
// 날짜는 공용 taskDays()(KST date-only, inclusive) 단일 소스 — 요약/상세/캘린더 동일. 오프바이원 금지.
import { Fragment, useEffect, useMemo, useState } from "react";
import type { Lane, LaneEvent } from "@/lib/home";
import { openTaskPanel } from "@/lib/task-panel";
import { taskDays, dateDiffDays } from "@/lib/task-view";

export type TimelineMode = "summary" | "detail";

const DOW = ["월", "화", "수", "목", "금", "토", "일"];
const diffDays = dateDiffDays;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthStartOf(dateStr: string): string { return dateStr.slice(0, 8) + "01"; }
function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function addMonths(dateStr: string, n: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}
function monthDot(anchor: string): string { const [y, m] = anchor.split("-"); return `${y}.${m}`; }

interface DayMeta { date: string; dowIdx: number; weekend: boolean; isToday: boolean; label: string | null }
function buildDays(from: string, n: number, today: string): DayMeta[] {
  return Array.from({ length: n }, (_, i) => {
    const date = addDays(from, i);
    const dowIdx = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
    const label = dowIdx === 0 || i === 0 ? `${Number(date.slice(5, 7))}/${date.slice(8)}` : null;
    return { date, dowIdx, weekend: dowIdx >= 5, isToday: date === today, label };
  });
}

/**
 * 바 색과 글자색 (MD-P-2026-019 §D "바 내부 글자는 대비 확보한 색").
 * 중성 팔레트로 바뀌면서 파랑·초록은 흰 글씨도 잉크 글씨도 4.5:1 을 못 넘는다
 * (파랑 흰 4.49/잉크 3.93, 초록 흰 4.27/잉크 4.13).
 * 그 둘만 같은 색조의 접근성 변형을 면으로 쓴다 — 색상 정체성은 유지된다.
 *   파랑 --blue-d  #1F5FE0 + 흰 글씨 5.57
 *   초록 --green-text #0F7A4C + 흰 글씨 5.37
 *   보라 --purple  #7C5CE0 + 흰 글씨 4.70
 *   틸·앰버·슬레이트는 잉크 글씨가 5.3~6.3 으로 통과 → 그대로
 */
function areaFill(ck: string | null): string {
  switch (ck) {
    case "play": case "purple": return "var(--purple)";
    case "train": case "teal": return "var(--teal)";
    case "green": return "var(--green-text)";
    case "amber": return "var(--amber)";
    case "team": return "var(--slate)";
    case "edu": case "blue": default: return "var(--blue-d)";
  }
}
function areaOnColor(ck: string | null): string {
  switch (ck) {
    case "train": case "teal": case "amber": case "team": return "var(--ink)";
    default: return "#fff";   // 파랑·초록·보라는 흰 글씨가 이긴다
  }
}

function NowClock() {
  const [t, setT] = useState("--:--");
  useEffect(() => {
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
    const tick = () => setT(fmt.format(new Date()));
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);
  return <span className="hh-now num"><i className="hh-now-dot" aria-hidden="true" />NOW {t} KST</span>;
}

interface FlatTask {
  id: number; title: string; start: string; end: string; status: string;
  late: boolean; progress: number; assignee: string; areaName: string; areaColorKey: string | null;
}
interface Bar { id: string; taskId: number | null; label: string; color: string; on: string; late: boolean; startIdx: number; span: number; sub: string }
interface GLane { key: string; name: string; color: string; bars: Bar[] }

export default function HeroTimeline({
  lanes, today, anchor, onAnchorChange, compact,
}: {
  lanes: Lane[];
  initialEvents?: LaneEvent[];
  today: string;
  anchor: string;
  onAnchorChange?: (a: string) => void;
  /** 홈 축소형 (MD-P-2026-020 §D2-1) — 트랙 17px·간격 5px. 규격은 .hm-hero CSS 가 강제한다 */
  compact?: boolean;
}) {
  const [mode, setMode] = useState<TimelineMode>("summary");
  const from = monthStartOf(anchor);
  const n = daysInMonth(anchor);
  const to = addDays(from, n);
  const lastIdx = n - 1;
  const pct = (i: number) => (i / n) * 100;
  const days = useMemo(() => buildDays(from, n, today), [from, n, today]);

  const flat: FlatTask[] = useMemo(() => {
    const out: FlatTask[] = [];
    for (const l of lanes) {
      for (const t of l.tasks) {
        const d = taskDays({ startDate: t.startDate, dueDate: t.dueDate });
        if (!d) continue;
        out.push({
          id: t.id, title: t.title, start: d.start, end: d.end, status: t.status,
          late: t.late, progress: t.progress, assignee: l.name,
          areaName: t.areaName ?? "기타", areaColorKey: t.areaColorKey ?? t.colorKey,
        });
      }
    }
    return out;
  }, [lanes]);

  function place(s: string, e: string): { startIdx: number; span: number } | null {
    const si = diffDays(s, from), ei = diffDays(e, from);
    if (ei < 0 || si > lastIdx) return null;
    const startIdx = Math.max(0, si), endIdx = Math.min(lastIdx, ei);
    return { startIdx, span: endIdx - startIdx + 1 };
  }

  const groups = useMemo(() => {
    const m = new Map<string, FlatTask[]>();
    for (const t of flat) { const a = m.get(t.areaName) ?? []; a.push(t); m.set(t.areaName, a); }
    return Array.from(m.entries());
  }, [flat]);

  const gridLanes: GLane[] = useMemo(() => {
    if (mode === "summary") {
      return groups.map(([area, tasks]) => {
        const col = areaFill(tasks[0]?.areaColorKey ?? null);
        const on = areaOnColor(tasks[0]?.areaColorKey ?? null);
        const anyLate = tasks.some((t) => t.late);
        const minS = tasks.reduce((a, t) => (t.start < a ? t.start : a), tasks[0].start);
        const maxE = tasks.reduce((a, t) => (t.end > a ? t.end : a), tasks[0].end);
        const p = place(minS, maxE);
        const avg = Math.round(tasks.reduce((a, t) => a + (t.status === "done" ? 100 : t.progress), 0) / tasks.length);
        // A2: 롤업 바는 항상 영역색. 지연은 우측 코랄 캡으로만 표기(영역 정체성 유지).
        const bars: Bar[] = p ? [{ id: `g${area}`, taskId: null, label: `${tasks.length}개 · 평균 ${avg}%`, color: col, on, late: anyLate, startIdx: p.startIdx, span: p.span, sub: "" }] : [];
        return { key: area, name: area, color: col, bars };
      }).filter((g) => g.bars.length > 0);
    }
    return groups.map(([area, tasks]) => {
      const col = areaFill(tasks[0]?.areaColorKey ?? null);
      const on = areaOnColor(tasks[0]?.areaColorKey ?? null);
      const bars: Bar[] = [];
      for (const t of tasks) {
        const p = place(t.start, t.end);
        if (!p) continue;
        const tplus = Math.max(0, diffDays(today, t.start));
        // A2/A3: 영역색 유지 + 지연은 코랄 캡. 좁은 바 텍스트는 CSS 컨테이너 쿼리로 숨김.
        bars.push({ id: `t${t.id}`, taskId: t.id, label: `#${t.id} ${t.title}`, color: col, on, late: t.late, startIdx: p.startIdx, span: p.span, sub: `${t.assignee} · ${t.progress}%` });
      }
      return { key: area, name: area, color: col, bars };
    }).filter((g) => g.bars.length > 0);
  }, [mode, groups, from, n, today]);

  const nowIdx = today >= from && today < to ? diffDays(today, from) + 0.5 : null;

  return (
    <section className={`tile hero gt2${compact ? " hm-hero" : ""}`} aria-label="팀 타임라인">
      {/* §D2-1: 헤더 한 줄 — 제목 · YYYY.MM · [요약|상세] · (기간 이동) · 우측 ● NOW */}
      <div className="hh2">
        <h2>팀 타임라인</h2>
        <span className="hh-mo num">{monthDot(anchor)}</span>
        {!compact && nowIdx !== null && <NowClock />}
        <span className="hh-toggle" role="group" aria-label="보기 전환">
          <button className={mode === "summary" ? "on" : ""} aria-pressed={mode === "summary"} onClick={() => setMode("summary")}>요약</button>
          <button className={mode === "detail" ? "on" : ""} aria-pressed={mode === "detail"} onClick={() => setMode("detail")}>상세</button>
        </span>
        {onAnchorChange && (
          <span className="hh-nav" role="group" aria-label="기간 이동">
            <button className="nb" onClick={() => onAnchorChange(addMonths(anchor, -1))} aria-label="이전">‹</button>
            <button className="tbtn" onClick={() => onAnchorChange(today)}>오늘</button>
            <button className="nb" onClick={() => onAnchorChange(addMonths(anchor, 1))} aria-label="다음">›</button>
          </span>
        )}
        <span className="hh-sp" />
        {compact && nowIdx !== null && <NowClock />}
      </div>

      <div className="gt-wrap">
        <div className="gt-grid">
          <div className="gt-corner" />
          <div className="gt-axis">
            {days.map((d, i) => (
              <div key={d.date} className={`gt-acol${d.weekend ? " wknd" : ""}${d.isToday ? " today" : ""}`} style={{ left: `${pct(i)}%`, width: `${100 / n}%` }}>
                {d.label && <span className="gt-alabel">{d.label}</span>}
              </div>
            ))}
            {nowIdx !== null && <div className="gt-nowline" style={{ left: `${pct(nowIdx)}%` }} aria-hidden="true" />}
          </div>

          {gridLanes.length === 0 ? (
            <div className="gt2-empty">이 기간에 표시할 업무가 없어요. ‹ › 로 다른 달을 보거나 업무에 기간을 지정하세요.</div>
          ) : gridLanes.map((lane) => (
            <Fragment key={lane.key}>
              <div className="gt-lane-l">
                <span className="gt-swatch" style={{ background: lane.color }} aria-hidden="true" />
                <span className="gt-lane-n">{lane.name}</span>
              </div>
              <div className="gt-track">
                <div className="gt-bg" aria-hidden="true">
                  {days.map((d, i) => (
                    <div key={d.date} className={`gt-bgcol${d.weekend ? " wknd" : ""}${d.isToday ? " today" : ""}`} style={{ left: `${pct(i)}%`, width: `${100 / n}%` }} />
                  ))}
                  {nowIdx !== null && <div className="gt-nowline" style={{ left: `${pct(nowIdx)}%` }} />}
                </div>
                {lane.bars.map((b) => (
                  <div className="gt-line" key={b.id}>
                    <button
                      className={`gt2-bar${b.late ? " late" : ""}`}
                      style={{ left: `${pct(b.startIdx)}%`, width: `calc(${(b.span / n) * 100}% - 3px)`, background: b.color, color: b.on }}
                      onClick={b.taskId ? () => openTaskPanel(b.taskId as number) : undefined}
                      disabled={!b.taskId}
                      title={`${b.label}${b.sub ? ` · ${b.sub}` : ""}${b.late ? " · ⚠ 지연" : ""}`}
                    >
                      <span className="gt2-bar-in">
                        {b.late && <span className="gt2-warn" aria-hidden="true">⚠</span>}
                        <span className="gt2-bar-t">{b.label}</span>
                        {b.sub && <span className="gt2-bar-s">{b.sub}</span>}
                      </span>
                      {b.late && <i className="gt2-cap" aria-hidden="true" />}
                    </button>
                  </div>
                ))}
              </div>
            </Fragment>
          ))}
        </div>
      </div>

      <div className="gt2-foot">
        <span className="gt2-hint">{mode === "summary" ? "영역별 롤업 · 바 = 기간" : "개별 업무 · 코랄 = 지연"} · 세로선 = 오늘</span>
        <span className="gt2-c num">영역 {gridLanes.length} · 업무 {flat.length}</span>
      </div>
    </section>
  );
}
