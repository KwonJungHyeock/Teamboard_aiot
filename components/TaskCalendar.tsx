"use client";

// 업무 캘린더 렌즈 — 필터된 업무를 마감일 기준 월 달력에 배치(라이트, 조용).
// 날짜 클릭 → 그 날짜로 빠른 생성. pill 클릭 → 노션식 상세. (앵커 아님 = 라이트 유지)
import { useMemo, useState } from "react";
import { openTaskPanel } from "@/lib/task-panel";
import { openQuickCreate } from "@/lib/quick";
import type { TaskItem } from "@/lib/task-view";

const DOW = ["일", "월", "화", "수", "목", "금", "토"];
const MAX_PILL = 3;

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateStr: string, months: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}
function monthMatrix(anchor: string): string[] {
  const first = anchor.slice(0, 8) + "01";
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const start = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export default function TaskCalendar({ tasks, today }: { tasks: TaskItem[]; today: string }) {
  const [anchor, setAnchor] = useState(today || "2026-01-01");

  // 다일 업무는 시작일→마감일 전 구간에 연속 표시(구간 세그먼트로 모서리 연결).
  // 시작일 없는 업무는 마감일 단일 처리(P1 fallback).
  const byDate = useMemo(() => {
    const map = new Map<string, { t: TaskItem; seg: "single" | "start" | "mid" | "end" }[]>();
    for (const t of tasks) {
      const rawS = t.startDate ? t.startDate.slice(0, 10) : t.dueDate ? t.dueDate.slice(0, 10) : null;
      const rawE = t.dueDate ? t.dueDate.slice(0, 10) : t.startDate ? t.startDate.slice(0, 10) : null;
      if (!rawS || !rawE) continue;
      const s = rawS <= rawE ? rawS : rawE;
      const e = rawS <= rawE ? rawE : rawS;
      let d = s;
      let guard = 0;
      while (d <= e && guard < 400) {
        const seg = s === e ? "single" : d === s ? "start" : d === e ? "end" : "mid";
        const arr = map.get(d) ?? [];
        arr.push({ t, seg });
        map.set(d, arr);
        d = addDays(d, 1);
        guard++;
      }
    }
    return map;
  }, [tasks]);

  const cells = useMemo(() => monthMatrix(anchor), [anchor]);
  const curMonth = anchor.slice(0, 7);
  const label = `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`;

  return (
    <section className="tile cal-tile" aria-label="업무 월 달력">
      <div className="cal-head2">
        <span className="cal-mo num">{label}</span>
        <div className="seg" role="group" aria-label="월 이동">
          <button onClick={() => setAnchor(addMonths(anchor, -1))} aria-label="이전">‹</button>
          <button aria-pressed={anchor.slice(0, 7) === (today || "").slice(0, 7)} onClick={() => setAnchor(today)}>오늘</button>
          <button onClick={() => setAnchor(addMonths(anchor, 1))} aria-label="다음">›</button>
        </div>
      </div>
      <div className="cal-dow">
        {DOW.map((d, i) => <div key={d} className={`cal-dowc${i === 0 ? " sun" : i === 6 ? " sat" : ""}`}>{d}</div>)}
      </div>
      <div className="cal-grid">
        {cells.map((date) => {
          const inMonth = date.slice(0, 7) === curMonth;
          const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
          const isToday = date === today;
          const pills = byDate.get(date) ?? [];
          const shown = pills.slice(0, MAX_PILL);
          return (
            <div
              key={date}
              className={`cal-cell${inMonth ? "" : " out"}${dow === 0 || dow === 6 ? " wknd" : ""}${isToday ? " today" : ""}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest(".cal-pill")) return;
                openQuickCreate({ x: e.clientX, y: e.clientY }, { dueDate: date });
              }}
            >
              <div className="cal-cell-h">
                <span className="cal-dnum num">{Number(date.slice(8))}</span>
                <button className="cal-add" aria-label="이 날짜에 업무 추가" onClick={(e) => { e.stopPropagation(); openQuickCreate({ x: e.clientX, y: e.clientY }, { dueDate: date }); }}>＋</button>
              </div>
              <div className="cal-pills">
                {shown.map(({ t: p, seg }) => {
                  const late = !!p.dueDate && !!today && p.dueDate.slice(0, 10) < today && p.status !== "done" && p.status !== "dropped";
                  // 제목은 시작/단일/주 시작(일요일)에만 — 그 외 구간은 연속 바
                  const showTitle = seg === "single" || seg === "start" || dow === 0;
                  return (
                    <button
                      key={p.id}
                      className={`cal-pill st-${p.status}${late ? " late" : ""}${p.blocked ? " bkd" : ""} seg-${seg}${showTitle ? "" : " cont"}`}
                      onClick={(e) => { e.stopPropagation(); openTaskPanel(p.id); }}
                      title={`${p.title}${p.blocked && p.blockedReason ? ` · 막힘: ${p.blockedReason}` : ""}${p.startDate && p.dueDate ? ` · ${p.startDate.slice(5, 10)}~${p.dueDate.slice(5, 10)}` : ""}`}
                    >
                      {showTitle ? <>{p.blocked ? <svg className="cal-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg> : <i className={`cal-pdot ${p.colorKey ?? "team"}`} />}{p.title}</> : <span className="cal-cont-t" aria-hidden="true">·</span>}
                    </button>
                  );
                })}
                {pills.length > MAX_PILL && <span className="cal-more">+{pills.length - MAX_PILL}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
