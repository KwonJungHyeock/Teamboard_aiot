"use client";

// 팀 타임라인 — 2층 레인 (Phase 3, 시그니처 컴포넌트)
// 상단 행: event 시간축 블록 (겹침 최대 2줄, 초과 +N)
// 하단 행: task 종일 칩 (5개까지, 초과 +N, 기한 임박 앞쪽 — 서버 정렬)
// 레인: actor(type=human, is_active) 동적. 일·주·월: 시간축↔날짜축 교체, 레인 구조 유지.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Lane, LaneEvent } from "@/lib/home";

export type TimelineView = "day" | "week" | "month";

const DAY_START_H = 9; // 프로토타입 시간축 09~19시
const DAY_HOURS = 10;
const TZ = "+09:00";

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekStartOf(dateStr: string): string {
  const dow = (new Date(`${dateStr}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(dateStr, -dow);
}

function monthStartOf(dateStr: string): string {
  return dateStr.slice(0, 8) + "01";
}

function daysInMonth(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function rangeFor(view: TimelineView, anchor: string): { from: string; to: string } {
  if (view === "day") return { from: anchor, to: addDays(anchor, 1) };
  if (view === "week") {
    const start = weekStartOf(anchor);
    return { from: start, to: addDays(start, 7) };
  }
  const start = monthStartOf(anchor);
  return { from: start, to: addDays(start, daysInMonth(anchor)) };
}

/** 기간 내 위치를 0~1 분율로 (KST 기준) */
function fracOf(iso: string, view: TimelineView, from: string): number {
  const t = new Date(iso).getTime();
  const base = new Date(`${from}T00:00:00${TZ}`).getTime();
  if (view === "day") {
    const dayStart = base + DAY_START_H * 3600000;
    return (t - dayStart) / (DAY_HOURS * 3600000);
  }
  const days = view === "week" ? 7 : daysInMonth(from);
  return (t - base) / (days * 86400000);
}

const AVATAR_GRADIENTS = [
  "linear-gradient(140deg,var(--edu),var(--play))",
  "linear-gradient(140deg,var(--play),#C084FC)",
  "linear-gradient(140deg,var(--train),var(--edu))",
  "linear-gradient(140deg,var(--team),var(--edu))",
];

interface Placed {
  event: LaneEvent;
  left: number;
  width: number;
  row: number;
}

function placeEvents(events: LaneEvent[], view: TimelineView, from: string) {
  const items = events
    .map((event) => {
      const l = Math.max(0, fracOf(event.startAt, view, from));
      const r = Math.min(1, fracOf(event.endAt, view, from));
      return { event, l, r };
    })
    .filter((x) => x.r > 0 && x.l < 1 && x.r > x.l)
    .sort((a, b) => a.l - b.l);

  const rowEnds: number[] = [];
  const placed: Placed[] = [];
  let overflow = 0;
  for (const item of items) {
    let row = rowEnds.findIndex((end) => end <= item.l + 0.001);
    if (row < 0) {
      if (rowEnds.length >= 2) {
        overflow += 1; // 최대 2줄, 초과분은 +N
        continue;
      }
      row = rowEnds.length;
      rowEnds.push(0);
    }
    rowEnds[row] = item.r;
    placed.push({
      event: item.event,
      left: item.l * 100,
      width: Math.max((item.r - item.l) * 100, 1.5),
      row,
    });
  }
  return { placed, overflow, twoRows: placed.some((p) => p.row === 1) };
}

function EventTrack({
  events,
  view,
  from,
}: {
  events: LaneEvent[];
  view: TimelineView;
  from: string;
}) {
  const { placed, overflow, twoRows } = placeEvents(events, view, from);
  return (
    <div className={`trk ${twoRows ? "two" : ""}`}>
      {placed.map((p) => (
        <div
          key={p.event.id}
          className={`blk ${p.event.isTeam ? "tm" : (p.event.colorKey ?? "tm")} ${p.row === 1 ? "r1" : ""}`}
          style={{ left: `${p.left}%`, width: `${p.width}%` }}
          title={p.event.title}
        >
          {p.event.title}
        </div>
      ))}
      {overflow > 0 && <span className="ovf">+{overflow}</span>}
    </div>
  );
}

export default function TeamTimeline({
  lanes,
  initialEvents,
  today,
  view,
  anchor,
  isLead,
  expanded = false,
}: {
  lanes: Lane[];
  initialEvents: LaneEvent[];
  today: string;
  view: TimelineView;
  anchor: string;
  isLead: boolean;
  expanded?: boolean;
}) {
  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const isInitialRange = view === "day" && anchor === today;
  const [fetched, setFetched] = useState<LaneEvent[] | null>(null);
  const [nowFrac, setNowFrac] = useState<number | null>(null);
  const [nowLabel, setNowLabel] = useState("");

  // 기간 변경 시 일정 재조회 (오늘 일 뷰는 서버 데이터 재사용)
  useEffect(() => {
    if (isInitialRange) {
      setFetched(null);
      return;
    }
    let alive = true;
    fetch(`/api/events?from=${range.from}&to=${range.to}`)
      .then((r) => r.json())
      .then((data) => alive && setFetched(data.events ?? []))
      .catch(() => alive && setFetched([]));
    return () => {
      alive = false;
    };
  }, [range.from, range.to, isInitialRange]);

  // 현재 시각 인디케이터 — 실시각 기준, 1분마다 갱신
  useEffect(() => {
    function update() {
      const now = new Date();
      const frac = fracOf(now.toISOString(), view, range.from);
      setNowFrac(frac >= 0 && frac <= 1 ? frac : null);
      setNowLabel(
        new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(now)
      );
    }
    update();
    const timer = setInterval(update, 60_000);
    return () => clearInterval(timer);
  }, [view, range.from]);

  const events = fetched ?? initialEvents;
  const teamEvents = events.filter((e) => e.isTeam);
  const personal = (actorId: number) =>
    events.filter((e) => !e.isTeam && e.participantIds.includes(actorId));

  // 축 라벨: 일=시각 / 주=요일 / 월=일자
  const axis = useMemo(() => {
    if (view === "day") {
      return Array.from({ length: DAY_HOURS }, (_, i) => String(DAY_START_H + i).padStart(2, "0"));
    }
    if (view === "week") {
      const names = ["월", "화", "수", "목", "금", "토", "일"];
      return names.map((n, i) => `${n} ${addDays(range.from, i).slice(8)}`);
    }
    const n = daysInMonth(range.from);
    return Array.from({ length: n }, (_, i) => (i % 3 === 0 ? String(i + 1) : ""));
  }, [view, range.from]);

  const chipLimit = expanded ? 8 : 5;

  return (
    <section className={`card cal`} aria-label="팀 타임라인">
      <div className="ch">
        <h2>팀 타임라인</h2>
        <span className="sub">
          일정 {events.length} · 업무 {lanes.reduce((s, l) => s + l.tasks.length, 0)}
        </span>
      </div>
      <div className="lg">
        <div></div>
        <div className="hrs" style={{ gridTemplateColumns: `repeat(${axis.length},1fr)` }}>
          {axis.map((label, i) => (
            <span key={i}>{label}</span>
          ))}
        </div>

        {/* 팀 공통 레인 */}
        <div className="ln">
          <div className="ln-n tm">
            <span className="w">팀 공통</span>
          </div>
          <div className="ln-b">
            <EventTrack events={teamEvents} view={view} from={range.from} />
          </div>
        </div>

        {/* 팀원 레인 — actor 기준 동적 */}
        {lanes.map((lane, index) => (
          <div className="ln" key={lane.actorId}>
            <div className="ln-n">
              <span
                className="av"
                style={{ background: AVATAR_GRADIENTS[index % AVATAR_GRADIENTS.length] }}
              >
                {lane.name.slice(0, 1)}
              </span>
              <span className="w">{lane.name}</span>
              {lane.assistantStatus !== "idle" && (
                <Link
                  href="/assistant"
                  className={`agdot ${lane.assistantStatus}`}
                  aria-label={
                    lane.assistantStatus === "working" ? "부사수 작동중" : "부사수 보고 대기"
                  }
                  title={lane.assistantStatus === "working" ? "부사수 작동중" : "부사수 보고 대기"}
                />
              )}
            </div>
            <div className="ln-b">
              <EventTrack events={personal(lane.actorId)} view={view} from={range.from} />
              <div className="chips">
                {lane.tasks.slice(0, chipLimit).map((task) => (
                  <span
                    key={task.id}
                    className={`chip ${task.late ? "late" : (task.colorKey ?? "")} ${task.origin === "agent" ? "ag" : ""}`}
                    title={task.dday ? `${task.title} · ${task.dday}` : task.title}
                  >
                    {task.origin === "agent" && <span className="mo" />}
                    {task.title}
                    {task.late && task.dday ? ` · ${task.dday}` : ""}
                  </span>
                ))}
                {lane.tasks.length > chipLimit && (
                  <span className="chip">+{lane.tasks.length - chipLimit}</span>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {nowFrac !== null && (
        <div
          className="nowl"
          data-time={nowLabel}
          style={{ left: `calc(80px + 11px + (100% - 91px) * ${nowFrac.toFixed(4)})` }}
        />
      )}

      <div className="cf">
        {isLead ? (
          <Link className="lk" href="/members">
            ＋ 팀원 추가
          </Link>
        ) : (
          <span />
        )}
        <button className="lk mu" disabled title="추후 제공">
          레인 설정
        </button>
      </div>
    </section>
  );
}
