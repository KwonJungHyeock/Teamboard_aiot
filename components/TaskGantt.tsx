"use client";

// 업무 타임라인 렌즈 — 담당별 레인 · 월 범위 가로 바(라이트, 조용). 앵커 아님(다크 히어로 복제 금지).
// 바 색=상태 의미색(솔리드·무광택), 진행률만큼 더 진한 세그먼트. 오늘 세로선. 바 클릭 → 상세.
import { useMemo, useState } from "react";
import { openTaskPanel } from "@/lib/task-panel";
import { openQuickCreate } from "@/lib/quick";
import { type TaskItem, statusColor, STATUS_META, taskDays, dateAddDays as addDays, dateDiffDays as diffDays } from "@/lib/task-view";

function ymd(d: string) { return d.slice(0, 10); }
function monthStart(a: string) { return a.slice(0, 8) + "01"; }
function daysInMonth(a: string) { const [y, m] = a.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function addMonths(a: string, n: number) { const [y, m] = a.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10); }

export default function TaskGantt({
  tasks, today, actors,
}: {
  tasks: TaskItem[];
  today: string;
  actors: { id: number; name: string }[];
}) {
  const [anchor, setAnchor] = useState(today || "2026-01-01");
  const from = monthStart(anchor);
  const n = daysInMonth(anchor);
  const to = addDays(from, n);
  const label = `${anchor.slice(0, 4)}년 ${Number(anchor.slice(5, 7))}월`;
  const pct = (i: number) => (i / n) * 100;

  // 담당별 레인 — 범위 안에 걸치는 업무만. 겹치는 바는 서브행으로 패킹(1초 가독).
  const lanes = useMemo(() => {
    return actors
      .map((a) => {
        const bars = tasks
          .filter((t) => t.assigneeId === a.id)
          .map((t) => {
            const range = taskDays(t); // 공유 함수 — inclusive·정규화
            if (!range) return null;
            const { start: s, end: e } = range;
            if (e < from || s >= to) return null; // 범위 밖
            const cs = s < from ? from : s;
            const ce = e >= to ? addDays(to, -1) : e;
            const left = diffDays(cs, from);
            const span = Math.max(1, diffDays(ce, cs) + 1);
            const late = !!t.dueDate && today && ymd(t.dueDate) < today && t.status !== "done" && t.status !== "dropped";
            return { t, left, span, late, row: 0 };
          })
          .filter((b): b is NonNullable<typeof b> => !!b)
          .sort((x, y) => x.left - y.left || y.span - x.span);
        // 구간 패킹 — 겹치지 않는 첫 서브행에 배치
        const rowEnds: number[] = [];
        for (const b of bars) {
          let r = rowEnds.findIndex((end) => end <= b.left);
          if (r === -1) { r = rowEnds.length; rowEnds.push(0); }
          rowEnds[r] = b.left + b.span;
          b.row = r;
        }
        return { id: a.id, name: a.name, bars, rows: Math.max(1, rowEnds.length) };
      })
      .filter((l) => l.bars.length > 0);
  }, [tasks, actors, from, to, today]);

  const showToday = today >= from && today < to;

  return (
    <section className="tile tg-tile" aria-label="업무 타임라인">
      <div className="tg-head">
        <span className="tg-mo num">{label}</span>
        <div className="seg" role="group" aria-label="월 이동">
          <button onClick={() => setAnchor(addMonths(anchor, -1))} aria-label="이전">‹</button>
          <button aria-pressed={from === monthStart(today || "")} onClick={() => setAnchor(today)}>오늘</button>
          <button onClick={() => setAnchor(addMonths(anchor, 1))} aria-label="다음">›</button>
        </div>
        <span className="tg-legend">
          <i style={{ background: statusColor("todo") }} />대기
          <i style={{ background: statusColor("doing") }} />진행
          <i style={{ background: statusColor("review") }} />리뷰
          <i style={{ background: statusColor("done") }} />완료
        </span>
      </div>

      {lanes.length === 0 ? (
        <p className="tg-empty">이 달에 기간이 걸친 업무가 없어요. 시트·보드에서 마감일을 지정하면 여기에 나타납니다.</p>
      ) : (
        <div className="tg-body">
          {/* 날짜 축 (주 단위 눈금) */}
          <div className="tg-axis">
            <div className="tg-axis-l" />
            <div className="tg-axis-r">
              {Array.from({ length: n }, (_, i) => addDays(from, i)).map((d, i) =>
                (i === 0 || new Date(`${d}T00:00:00Z`).getUTCDay() === 1) ? (
                  <span key={d} className="tg-tick num" style={{ left: `${pct(i)}%` }}>{Number(d.slice(8))}</span>
                ) : null
              )}
              {showToday && <div className="tg-today" style={{ left: `${pct(diffDays(today, from) + 0.5)}%` }} aria-hidden="true" />}
            </div>
          </div>
          {lanes.map((lane) => (
            <div className="tg-lane" key={lane.id}>
              <div className="tg-lane-l">{lane.name}</div>
              <div
                className="tg-lane-r"
                style={{ height: lane.rows * 28 + 8 }}
                title={`${lane.name} 레인 빈 곳 클릭 → 그 날짜·담당으로 빠른 생성`}
                onClick={(e) => {
                  // 바 클릭은 상세 열기 — 빈 셀만 빠른 생성(그 날·담당 프리필)
                  if ((e.target as HTMLElement).closest(".tg-bar")) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const rel = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0;
                  const di = Math.max(0, Math.min(n - 1, Math.floor(rel * n)));
                  openQuickCreate({ x: e.clientX, y: e.clientY }, { dueDate: addDays(from, di), assigneeId: lane.id });
                }}
              >
                {showToday && <div className="tg-today soft" style={{ left: `${pct(diffDays(today, from) + 0.5)}%` }} aria-hidden="true" />}
                {lane.bars.map((b) => (
                  <button
                    key={b.t.id}
                    className={`tg-bar${b.late ? " late" : ""}${b.t.blocked ? " bkd" : ""}`}
                    style={{ left: `${pct(b.left)}%`, width: `${pct(b.span)}%`, top: b.row * 28 + 4, background: b.late ? "var(--coral-text)" : statusColor(b.t.status) }}
                    onClick={() => openTaskPanel(b.t.id)}
                    title={`${b.t.title} · ${STATUS_META[b.t.status]?.label ?? b.t.status} · ${b.t.progress}%${b.t.blocked && b.t.blockedReason ? ` · 막힘: ${b.t.blockedReason}` : ""}`}
                  >
                    <span className="tg-fill" style={{ width: `${b.t.progress}%` }} />
                    {b.t.blocked && <svg className="tg-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>}
                    <span className="tg-bar-t">{b.t.title}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <button className="tg-quick" onClick={(e) => openQuickCreate({ x: e.clientX, y: e.clientY }, {})}>＋ 새 업무</button>
    </section>
  );
}
