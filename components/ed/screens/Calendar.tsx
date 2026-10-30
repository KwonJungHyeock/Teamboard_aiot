"use client";

// 일정 — 달/주 달력 + 날짜 패널 (calendar.dc.html · DESIGN.md 5.9).
//   칸: 날짜 원 · n건 · 업무 줄(담당자 색 점 + 제목, 박스 없음) · +n건 · 2px 부하 막대. 카테고리 색은 쓰지 않는다.
//   패널: 내 업무 요약(할 일 · 진행 · 오늘 기한 · 지남 + 지난 업무 빨강) · `24일(오늘)` + n건 · 체크로 완료 · `이 날 업무 · Enter`
//   막대: 일정(팀 = violet, 나만 = teal 점선) + 시작일~기한 업무(담당자 색). 일정이 먼저 줄을 차지하고,
//     달 보기는 주마다 두 줄까지, 넘치면 그 날 `+n건` 에 더한다(주 보기는 다).
//   등록: `+ 등록` · 칸의 `+` · 고른 날을 한 번 더 누르기 · 칸을 끌어 기간 고르기 → 등록 창(AddModal).
//   담당 거르기: 「모두」 또는 사람 여럿(색 견본 = 범례). 브라우저에 기억한다.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDays, diffDays, isEnter, isOnTask, md, personColors, todayKst, weekday, type EdTask } from "@/lib/ed/core";
import { createTask, patchTask, useMeta, useTasks } from "../data";
import { api, Drawer, emitChanged, useOnChanged, useToast } from "../ui";
import AddModal, { type AddPreset } from "../AddModal";

const WK = ["일", "월", "화", "수", "목", "금", "토"];
const pad = (n: number) => String(n).padStart(2, "0");
const ymOf = (iso: string) => iso.slice(0, 7);
function shiftYm(ym: string, by: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

// ── 일정 ──────────────────────────────────────────────────────
/** 팀 일정(`event`) · 내 일정(`personal_event`)을 한 모양으로. start · end 는 날짜(KST, 끝 포함) */
interface CalEvent {
  key: string; id: number; kind: "team" | "me"; title: string; start: string; end: string;
  time: string | null; allDay: boolean; isTeam: boolean; createdBy: number | null; createdByName: string | null; participantIds: number[];
}
interface TeamEventRow {
  id: number; title: string; startDate: string; endDate: string; allDay: boolean; startTime: string | null;
  isTeam: boolean; createdBy: number | null; createdByName: string | null; participantIds: number[];
}
interface PersonalEventRow { id: number; title: string; startDate: string; endDate: string }
const spanText = (e: { start: string; end: string }) => e.end === e.start ? md(e.start) : `${md(e.start)}~${md(e.end)}`;
const kindText = (e: CalEvent) => e.kind === "me" ? "나만" : e.isTeam ? "팀 일정" : "일정";

/** 막대 하나 — 일정이거나, 시작일~기한이 있는 업무 */
interface BarIt { key: string; start: string; end: string; ev?: CalEvent; task?: EdTask }
/** 시작일이 기한보다 앞선 업무 — 달력에 막대로 그린다(팀 피드백 2) */
const isSpan = (t: EdTask): t is EdTask & { startDate: string; dueDate: string } => !!t.startDate && !!t.dueDate && t.startDate < t.dueDate;

/** 한 주(ws~ws+6)에 걸친 막대를 줄(lane)에 앉힌다 — 일정 먼저, 그다음 먼저 시작하는 것 · 긴 것부터 */
function layWeek(items: BarIt[], ws: string) {
  const we = addDays(ws, 6);
  const xs = items.filter((e) => e.start <= we && e.end >= ws)
    .sort((a, b) => Number(!!a.task) - Number(!!b.task) || a.start.localeCompare(b.start) || diffDays(b.end, b.start) - diffDays(a.end, a.start) || a.key.localeCompare(b.key));
  const last: number[] = [];
  return xs.map((it) => {
    const c1 = Math.max(0, diffDays(it.start, ws)), c2 = Math.min(6, diffDays(it.end, ws));
    let lane = last.findIndex((c) => c < c1);
    if (lane < 0) { lane = last.length; last.push(c2); } else last[lane] = c2;
    return { it, c1, c2, lane, cl: it.start < ws, cr: it.end > we };
  });
}

/** 보이는 범위의 일정 — 팀 + 나만. `ed:changed` 가 오면 다시 읽는다 */
function useEvents(from: string, to: string): CalEvent[] {
  const [evs, setEvs] = useState<CalEvent[]>([]);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    const [t, p] = await Promise.all([
      api<{ events: TeamEventRow[] }>(`/api/events?from=${from}&to=${addDays(to, 1)}`).catch(() => ({ events: [] as TeamEventRow[] })),
      api<{ events: PersonalEventRow[] }>(`/api/personal-events?from=${from}&to=${to}`).catch(() => ({ events: [] as PersonalEventRow[] })),
    ]);
    if (n !== seq.current) return; // 그새 달을 넘겼다
    setEvs([
      ...t.events.map((e): CalEvent => ({
        key: `t${e.id}`, id: e.id, kind: "team", title: e.title, start: e.startDate, end: e.endDate, time: e.startTime, allDay: e.allDay,
        isTeam: e.isTeam, createdBy: e.createdBy, createdByName: e.createdByName, participantIds: e.participantIds,
      })),
      ...p.events.map((e): CalEvent => ({
        key: `p${e.id}`, id: e.id, kind: "me", title: e.title, start: e.startDate, end: e.endDate, time: null, allDay: true,
        isTeam: false, createdBy: null, createdByName: null, participantIds: [],
      })),
    ]);
  }, [from, to]);
  useEffect(() => { void load(); }, [load]);
  useOnChanged(() => { void load(); });
  return evs;
}

const WHO_KEY = "ed:cal-who";
const readWho = (): number[] => { try { const v = JSON.parse(localStorage.getItem(WHO_KEY) ?? "[]"); return Array.isArray(v) ? v.filter((x) => Number.isInteger(x)) : []; } catch { return []; } };

export default function Calendar({ meId, launch }: { meId: number; launch: string | null }) {
  const today = todayKst();
  const router = useRouter();
  const { tasks, setTasks } = useTasks();
  const meta = useMeta();
  const [ym, setYm] = useState(ymOf(today));
  const [sel, setSel] = useState(today);
  const [view, setView] = useState<"month" | "week">("month");
  // 담당자 거르기 — 비면 모두. 고른 사람의 업무 · 일정만(팀 전체 일정은 늘 보인다)
  const [who, setWhoRaw] = useState<number[]>([]);
  useEffect(() => { setWhoRaw(readWho()); }, []);
  const setWho = (xs: number[]) => { setWhoRaw(xs); try { localStorage.setItem(WHO_KEY, JSON.stringify(xs)); } catch { /* 저장 못 해도 이번 화면에선 걸러진다 */ } };
  const [n, setN] = useState(0);
  const [sn, setSn] = useState(0);
  const [text, setText] = useState("");
  const [newId, setNewId] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const [toast, showToast] = useToast();
  const [openEv, setOpenEv] = useState<CalEvent | null>(null);
  const [adding, setAdding] = useState<AddPreset | null>(null);
  const [drag, setDrag] = useState<{ a: string; b: string } | null>(null);
  const dragged = useRef(false);
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1400); return () => clearTimeout(t); }, []);

  const colors = useMemo(() => personColors(meta?.people ?? []), [meta]);
  const colorOf = (id: number | null) => (id !== null && colors.get(id)) || "var(--sub)";

  const [Y, M] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  const dim = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const rowsN = Math.ceil((weekday(first) + dim) / 7);
  const start = addDays(first, -weekday(first));
  const ws = addDays(sel, -weekday(sel));
  const maxLanes = 2; // 달 보기 — 한 주에 막대 두 줄까지(넘치면 `+n건`, 주 보기에선 다 보인다)

  const evAll = useEvents(view === "month" ? start : ws, view === "month" ? addDays(start, rowsN * 7 - 1) : addDays(ws, 6));
  const evs = useMemo(() => evAll.filter((e) => !who.length || e.isTeam
    || (e.kind === "me" ? who.includes(meId) : (e.createdBy !== null && who.includes(e.createdBy)) || e.participantIds.some((p) => who.includes(p)))), [evAll, who, meId]);
  const evOn = (d: string) => evs.filter((e) => e.start <= d && e.end >= d);
  const canEdit = (e: CalEvent) => e.kind === "me" || e.createdBy === meId || !!meta?.me.lead;

  const vis = useMemo(() => (tasks ?? []).filter((t) => t.parentTaskId === null && t.status !== "dropped" && t.status !== "proposed"
    && (!who.length || who.some((w) => isOnTask(t, w)))), [tasks, who]);
  const spans = useMemo(() => vis.filter(isSpan), [vis]);
  const items = useMemo<BarIt[]>(() => [
    ...evs.map((ev) => ({ key: ev.key, start: ev.start, end: ev.end, ev })),
    ...spans.map((t) => ({ key: `k${t.id}`, start: t.startDate, end: t.dueDate, task: t })),
  ], [evs, spans]);

  // 달 보기 — 주마다 줄을 앉히고, 넘치는 막대는 그 날 `+n건` 에 센다
  const monthBars = useMemo(() => {
    if (view !== "month") return { bars: [], lanes: [] as number[], hidden: new Map<string, number>() };
    const bars: (ReturnType<typeof layWeek>[number] & { row: number })[] = [];
    const lanes: number[] = [];
    const hidden = new Map<string, number>();
    for (let r = 0; r < rowsN; r++) {
      const wsR = addDays(start, r * 7);
      const xs = layWeek(items, wsR);
      lanes.push(Math.min(maxLanes, xs.reduce((m, x) => Math.max(m, x.lane + 1), 0)));
      for (const x of xs) {
        if (x.lane < maxLanes) { bars.push({ ...x, row: r }); continue; }
        for (let c = x.c1; c <= x.c2; c++) { const d = addDays(wsR, c); hidden.set(d, (hidden.get(d) ?? 0) + 1); }
      }
    }
    return { bars, lanes, hidden };
  }, [view, items, rowsN, start, maxLanes]);
  const weekBars = useMemo(() => view === "week" ? layWeek(items, ws) : [], [view, items, ws]);
  const weekLanes = weekBars.reduce((m, x) => Math.max(m, x.lane + 1), 0);

  const past = (d: string) => d < today;
  const look = (t: EdTask) => t.status === "done" ? "done" : past(t.dueDate ?? today) ? "over" : "open";
  const openTask = (id: number) => router.push(`/v3/calendar?task=${id}`, { scroll: false });

  const Bar = ({ x, row }: { x: ReturnType<typeof layWeek>[number]; row: number }) => {
    const pos = { gridRow: row + 1, gridColumn: `${x.c1 + 1} / ${x.c2 + 2}`, ["--lane" as string]: x.lane };
    const edge = `${x.cl ? " cl" : ""}${x.cr ? " cr" : ""}`;
    const t = x.it.task;
    if (t) {
      return (
        <button type="button" className={`cal-ev tk ${look(t)}${edge}`} title={`${t.title} · ${t.assigneeName ?? "담당 없음"}${t.memberIds?.length ? ` 외 ${t.memberIds.length}명` : ""} · ${spanText({ start: t.startDate!, end: t.dueDate! })}`}
                style={{ ...pos, ["--pc" as string]: colorOf(t.assigneeId) }}
                onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openTask(t.id); }}>
          <span>{t.title}</span>
        </button>
      );
    }
    const ev = x.it.ev!;
    return (
      <button type="button" className={`cal-ev ${ev.kind}${edge}`} title={`${ev.title} · ${spanText(ev)}`} style={pos}
              onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); setOpenEv(ev); }}>
        {ev.kind === "me" && <b>나만</b>}{ev.time && <em>{ev.time}</em>}<span>{ev.title}</span>
      </button>
    );
  };

  // 칸에는 기한 날에 한 줄 — 막대로 그린 업무(시작일~기한)는 빼고
  const byDay = useMemo(() => {
    const m = new Map<string, EdTask[]>();
    for (const t of vis) if (t.dueDate && !isSpan(t)) m.set(t.dueDate, [...(m.get(t.dueDate) ?? []), t]);
    for (const [k, xs] of Array.from(m.entries())) m.set(k, xs.sort((a, b) => Number(a.status === "done") - Number(b.status === "done") || a.id - b.id));
    return m;
  }, [vis]);
  const noDue = vis.filter((t) => !t.dueDate && t.status !== "done").length;
  const on = (d: string) => byDay.get(d) ?? [];

  // ── 내 업무 요약(팀 피드백 1) — 거르기와 상관없이 내 것 ──────────────
  const mineSum = useMemo(() => {
    const xs = (tasks ?? []).filter((t) => t.parentTaskId === null && isOnTask(t, meId) && !["done", "dropped", "proposed"].includes(t.status));
    const over = xs.filter((t) => t.dueDate && t.dueDate < today).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    return {
      todo: xs.filter((t) => t.status === "todo" || t.status === "hold").length,
      doing: xs.filter((t) => t.status === "doing" || t.status === "review").length,
      dueToday: xs.filter((t) => t.dueDate === today).length,
      over,
    };
  }, [tasks, meId, today]);

  const move = (dir: number) => {
    setIntro(false);
    if (view === "week") { const s = addDays(sel, dir * 7); setSel(s); setYm(ymOf(s)); }
    else setYm((x) => shiftYm(x, dir));
    setN((x) => x + 1);
  };
  const goToday = () => { setIntro(false); setYm(ymOf(today)); setSel(today); setN((x) => x + 1); setSn((x) => x + 1); };
  const pick = (d: string) => { setIntro(false); setSel(d); setSn((x) => x + 1); };
  // 칸 누르기 — 처음엔 고르고, 고른 날을 한 번 더 누르면 등록 창. 끌고 지나간 기간은 시작일~기한으로 연다
  const tapDay = (d: string) => {
    if (dragged.current) { dragged.current = false; return; }
    if (d === sel) setAdding({ start: d }); else pick(d);
  };
  useEffect(() => {
    if (!drag) return;
    const up = () => {
      setDrag(null);
      if (drag.a === drag.b) return;
      dragged.current = true;
      const [a, b] = drag.a < drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
      setTimeout(() => { dragged.current = false; }, 0);
      pick(a); setAdding({ start: a, end: b });
    };
    document.addEventListener("pointerup", up);
    return () => document.removeEventListener("pointerup", up);
  }, [drag]); // eslint-disable-line react-hooks/exhaustive-deps
  const inDrag = (d: string) => !!drag && drag.a !== drag.b && d >= (drag.a < drag.b ? drag.a : drag.b) && d <= (drag.a < drag.b ? drag.b : drag.a);

  const toggle = async (t: EdTask) => {
    const next = t.status === "done" ? "todo" : "done";
    setTasks((xs) => xs && xs.map((x) => (x.id === t.id ? { ...x, status: next } : x)));
    try { await patchTask(t.id, { status: next }); } catch (e) { showToast(e instanceof Error ? e.message : "저장하지 못했습니다"); }
  };
  const add = async () => {
    const title = text.trim();
    if (!title) return;
    setText("");
    try { const { id } = await createTask({ title, dueDate: sel, assigneeId: meId, status: "todo" }); setNewId(id); }
    catch (e) { setText(title); showToast(e instanceof Error ? e.message : "추가하지 못했습니다"); }
  };

  // ── 칸 ────────────────────────────────────────────────────────
  const cellBase = (d: string, inMonth: boolean) => {
    const isToday = d === today, isSel = d === sel, wk = weekday(d), isLaunch = d === launch;
    const inRun = !!launch && d > today && d < launch, weekend = wk === 0 || wk === 6;
    const cls = ["cal-c", isToday && "today", isLaunch && "launch", !isToday && !isLaunch && inRun && "run", !isToday && !isLaunch && !inRun && weekend && "wkend", isSel && "sel", inDrag(d) && "rng"]
      .filter(Boolean).join(" ");
    const num = ["cal-n", isToday ? "today" : isLaunch ? "launch" : !inMonth ? "out" : wk === 0 ? "sun" : wk === 6 ? "sat" : ""].filter(Boolean).join(" ");
    return { cls, num, isLaunch };
  };
  const cap = rowsN > 5 ? 2 : 3;
  const slide = n ? `${n % 2 ? "calA" : "calB"} .38s var(--ease) backwards` : undefined;

  const Item = ({ t }: { t: EdTask }) => {
    const l = look(t);
    return <div className={`cal-it ${l}`} style={{ ["--pc" as string]: colorOf(t.assigneeId) }}><i /><span>{t.title}</span></div>;
  };
  const AddBtn = ({ d }: { d: string }) => (
    <button type="button" className="cal-add" aria-label={`${md(d)} 등록`} title="등록"
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); pick(d); setAdding({ start: d }); }}>+</button>
  );

  // 날짜 패널 — 기한이 그 날인 업무 + 그 날을 지나는 기간 업무
  const dayList = [...on(sel), ...spans.filter((t) => t.startDate <= sel && t.dueDate >= sel)];
  const dayEvs = evOn(sel);
  const selDate = new Date(`${sel}T00:00:00Z`);
  const dayTitle = `${selDate.getUTCMonth() + 1}월 ${selDate.getUTCDate()}일(${sel === today ? "오늘" : WK[weekday(sel)]})`;
  const title = view === "week"
    ? `${Number(ws.slice(5, 7))}월 ${Number(ws.slice(8, 10))}일 주`
    : `${Y}년 ${M}월`;
  const people = meta?.people ?? [];
  const toggleWho = (id: number) => setWho(who.includes(id) ? who.filter((x) => x !== id) : [...who, id]);

  return (
    <>
      <div className="cal-head">
        <div className="cal-hl">
          <h1 className="ed-h1">일정</h1>
          <div className="cal-mv">
            <button type="button" onClick={() => move(-1)} aria-label="이전">‹</button>
            <span className="tn">{title}</span>
            <button type="button" onClick={() => move(1)} aria-label="다음">›</button>
          </div>
          <button type="button" className="cal-today" onClick={goToday}>오늘</button>
        </div>
        <div className="cal-hl">
          <div className="cal-vw" role="tablist">
            {(["month", "week"] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? "on" : undefined}
                      onClick={() => { setIntro(false); setView(v); setN((x) => x + 1); }}>{v === "month" ? "달" : "주"}</button>
            ))}
          </div>
          <button type="button" className="ed-btn pri sm cal-new" onClick={() => setAdding({ start: sel })}>+ 등록</button>
        </div>
      </div>
      {people.length > 0 && (
        <div className="cal-who" role="group" aria-label="담당자 거르기">
          <span className="lb">담당</span>
          <button type="button" className={`cal-wc all${who.length ? "" : " on"}`} aria-pressed={!who.length} onClick={() => setWho([])}>모두</button>
          {[...people].sort((a, b) => Number(b.id === meId) - Number(a.id === meId)).map((p) => (
            <button key={p.id} type="button" className={`cal-wc${who.includes(p.id) ? " on" : ""}`} aria-pressed={who.includes(p.id)}
                    style={{ ["--pc" as string]: colorOf(p.id) }} onClick={() => toggleWho(p.id)}>
              <i />{p.id === meId ? `나 · ${p.name}` : p.name}
            </button>
          ))}
        </div>
      )}

      <div className="cal-main">
        <section className="cal-sec">
          <div className="cal-wh">{WK.map((w, i) => <span key={w} className={i === 0 ? "sun" : i === 6 ? "sat" : undefined}>{w}</span>)}</div>
          {view === "month" ? (
            <div className={`cal-grid${drag ? " dragging" : ""}`} key={`m${n}`} style={{ gridTemplateRows: `repeat(${rowsN},minmax(0,1fr))`, animation: slide }}>
              {Array.from({ length: rowsN * 7 }, (_, i) => {
                const d = addDays(start, i);
                const inMonth = ymOf(d) === ym;
                const xs = on(d);
                const open = xs.filter((t) => t.status !== "done").length;
                const over = past(d) && open > 0;
                const b = cellBase(d, inMonth);
                const op = inMonth ? (past(d) && d !== today ? 0.85 : 1) : 0.4;
                const lanes = monthBars.lanes[Math.floor(i / 7)] ?? 0;
                const capD = Math.max(1, cap - lanes);
                const more = Math.max(0, xs.length - capD) + (monthBars.hidden.get(d) ?? 0);
                return (
                  <div key={d} className={b.cls} onClick={() => tapDay(d)} role="button" tabIndex={0}
                       onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button === 0) setDrag({ a: d, b: d }); }}
                       onPointerEnter={() => { if (drag) setDrag({ ...drag, b: d }); }}
                       onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapDay(d); } }}
                       style={{ gridRow: Math.floor(i / 7) + 1, gridColumn: (i % 7) + 1, opacity: op,
                                animation: intro ? `rowIn .35s var(--ease) ${(0.1 + (Math.floor(i / 7) + (i % 7)) * 0.03).toFixed(2)}s backwards` : undefined }}>
                    <div className="cal-ct">
                      <span className={b.num}>{Number(d.slice(8, 10))}</span>
                      {xs.length > 0 && <span className="cal-cnt tn">{xs.length}건</span>}
                      {b.isLaunch && <span className="cal-lt">가오픈</span>}
                      {over && <span className="cal-od" />}
                      <AddBtn d={d} />
                    </div>
                    {lanes > 0 && <span className="cal-evsp" style={{ ["--lanes" as string]: lanes }} />}
                    {xs.slice(0, capD).map((t) => <Item key={t.id} t={t} />)}
                    {more > 0 && <span className="cal-more">+{more}건</span>}
                    <span className="cal-load" style={{ opacity: xs.length ? 1 : 0 }}>
                      <i style={{ width: `${Math.min(100, (xs.length / 3) * 100)}%`, background: over ? "var(--red)" : open ? "var(--accent)" : "var(--green)" }} />
                    </span>
                  </div>
                );
              })}
              {monthBars.bars.map((x) => <Bar key={`${x.it.key}-${x.row}`} x={x} row={x.row} />)}
            </div>
          ) : (
            <div className="cal-week" key={`w${n}`} style={{ animation: slide }}>
              {Array.from({ length: 7 }, (_, i) => {
                const d = addDays(ws, i);
                const b = cellBase(d, true);
                return (
                  <div key={d} className={`${b.cls} wk`} onClick={() => tapDay(d)} style={{ gridRow: 1, gridColumn: i + 1 }}>
                    <div className="cal-ct"><span className={b.num}>{Number(d.slice(8, 10))}</span>{b.isLaunch && <span className="cal-lt">가오픈</span>}<AddBtn d={d} /></div>
                    {weekLanes > 0 && <span className="cal-evsp" style={{ ["--lanes" as string]: weekLanes }} />}
                    {on(d).map((t) => {
                      const l = look(t);
                      return (
                        <div key={t.id} className={`cal-card ${l}`} style={{ ["--pc" as string]: colorOf(t.assigneeId) }}
                             onClick={(e) => { e.stopPropagation(); openTask(t.id); }}>
                          <span className="tt">{t.title}</span>
                          <span className="mt"><i />{t.assigneeName ?? "담당 없음"} · {t.areaName}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {weekBars.map((x) => <Bar key={x.it.key} x={x} row={0} />)}
            </div>
          )}
        </section>

        <aside className="cal-day">
          <div className="cal-my">
            <div className="cal-myh">
              <b>내 업무</b>
              <Link href="/v3/my" className="cal-myl">모두 보기 →</Link>
            </div>
            <div className="cal-mys">
              <span><em className="tn">{mineSum.todo}</em>할 일</span>
              <span><em className="tn">{mineSum.doing}</em>진행</span>
              <span className={mineSum.dueToday ? "amb" : undefined}><em className="tn">{mineSum.dueToday}</em>오늘 기한</span>
              <span className={mineSum.over.length ? "red" : undefined}><em className="tn">{mineSum.over.length}</em>지남</span>
            </div>
            {mineSum.over.length > 0 && (
              <div className="cal-myo">
                {mineSum.over.slice(0, 3).map((t) => (
                  <Link key={t.id} href={`/v3/calendar?task=${t.id}`} scroll={false} className="cal-myr">
                    <span className="tt">{t.title}</span><em className="tn">{diffDays(today, t.dueDate!)}일 지남</em>
                  </Link>
                ))}
                {mineSum.over.length > 3 && <Link href="/v3/my" className="cal-mym">지난 업무 {mineSum.over.length - 3}건 더 →</Link>}
              </div>
            )}
          </div>
          <div className="cal-dh" key={`d${sn}`} style={{ animation: sn ? `${sn % 2 ? "detA" : "detB"} .3s var(--ease) backwards` : undefined }}>
            <span className="tt">{dayTitle}</span><span className="ct">{dayList.length + dayEvs.length}건</span>
            {sel === launch && <span className="lt">가오픈</span>}
          </div>
          <div className="cal-dl">
            {dayEvs.map((e) => (
              <button key={e.key} type="button" className={`cal-row cal-er ${e.kind}`} onClick={() => setOpenEv(e)}>
                <span className="cal-esw"><i /></span>
                <span className="cal-rb">
                  <span className="tt">{e.title}</span>
                  <span className="mt">{e.time ? `${e.time} · ` : ""}{spanText(e)} · {kindText(e)}{e.kind === "team" && e.createdByName ? ` · ${e.createdByName}` : ""}</span>
                </span>
              </button>
            ))}
            {dayList.map((t, i) => {
              const l = look(t);
              return (
                <div key={t.id} className={`cal-row ${l}`} style={{ ["--pc" as string]: colorOf(t.assigneeId), animation: `rowIn ${t.id === newId ? ".35s" : `.3s var(--ease) ${(i * 0.04).toFixed(2)}s`} backwards` }}>
                  <button type="button" className={`ed-check${t.status === "done" ? " on" : ""}`} aria-pressed={t.status === "done"}
                          aria-label={t.status === "done" ? "완료 취소" : "완료"} onClick={() => void toggle(t)}>{t.status === "done" ? "✓" : ""}</button>
                  <Link href={`/v3/calendar?task=${t.id}`} scroll={false} className="cal-rb">
                    <span className="tt">{t.title}</span>
                    <span className="mt"><i />{t.assigneeName ?? "담당 없음"} · {t.areaName}{isSpan(t) ? ` · ${spanText({ start: t.startDate, end: t.dueDate })}` : ""}</span>
                  </Link>
                </div>
              );
            })}
            {!dayList.length && !dayEvs.length && <div className="cal-empty">일정 없음</div>}
          </div>
          <div className="cal-df">
            <div className="cal-in">
              <span>+</span>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="이 날 업무 · Enter" aria-label="이 날 업무"
                     onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void add(); } }} />
              <button type="button" className="cal-more-in" onClick={() => { setAdding({ start: sel, title: text.trim() }); setText(""); }}>자세히</button>
            </div>
            <Link href="/v3/tasks?due=none" className="cal-nd">기한 없음 {noDue}건<span>→</span></Link>
          </div>
        </aside>
      </div>
      {openEv && <EventDrawer key={openEv.key} ev={openEv} canEdit={canEdit(openEv)} onClose={() => setOpenEv(null)} onToast={showToast} />}
      {adding && <AddModal preset={adding} onClose={() => setAdding(null)}
                           onDone={(msg, id) => { if (id) setNewId(id); showToast(msg, id ? { label: "열기", run: () => openTask(id) } : undefined); }} />}
      {toast}
    </>
  );
}

/** 일정 드로어 — 제목 · 시작일 · 종료일 고치기, 지우기. 고칠 수 없는 사람에게는 읽기만 */
function EventDrawer({ ev, canEdit, onClose, onToast }: { ev: CalEvent; canEdit: boolean; onClose: () => void; onToast: (t: string) => void }) {
  const [title, setTitle] = useState(ev.title);
  const [start, setStart] = useState(ev.start);
  const [end, setEnd] = useState(ev.end);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [arm, setArm] = useState(false);
  const url = ev.kind === "me" ? `/api/personal-events/${ev.id}` : `/api/events/${ev.id}`;
  const datesMoved = start !== ev.start || end !== ev.end;
  const dirty = title.trim() !== ev.title || datesMoved;
  const ok = !!title.trim() && !!start && !!end && end >= start;

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true); setErr("");
    try { await fn(); emitChanged(); onToast(done); onClose(); }
    catch (e) { setErr(e instanceof Error ? e.message : "저장하지 못했습니다"); setBusy(false); }
  };
  const save = () => {
    const body: Record<string, unknown> = { title: title.trim() };
    if (datesMoved) { body.startDate = start; body.endDate = end; }
    return run(() => api(url, { method: ev.kind === "me" ? "PUT" : "PATCH", body }), "일정을 고쳤습니다");
  };
  const del = () => { if (!arm) { setArm(true); return; } void run(() => api(url, { method: "DELETE" }), "일정을 지웠습니다"); };

  return (
    <Drawer onClose={onClose} width={420} label="일정">
      <div className="dh">
        <textarea className="tt" rows={2} value={title} maxLength={120} readOnly={!canEdit} aria-label="일정 이름"
                  onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); if (dirty && ok && !busy) void save(); } }} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="db">
        <div className="cal-evhd">
          <span className={`cal-evk ${ev.kind}`}>{kindText(ev)}</span>
          {ev.createdByName && <span>{ev.createdByName} 등록</span>}
          {ev.time && <span>{ev.time} 시작</span>}
        </div>
        <div className="cal-evd">
          <label className="ed-field"><span>시작일</span>
            <input type="date" className="ed-input" value={start} disabled={!canEdit}
                   onChange={(e) => { const v = e.target.value; setStart(v); if (v && end < v) setEnd(v); }} /></label>
          <label className="ed-field"><span>종료일</span>
            <input type="date" className="ed-input" value={end} min={start} disabled={!canEdit} onChange={(e) => setEnd(e.target.value)} /></label>
        </div>
        {canEdit && !ev.allDay && datesMoved && <div className="cal-evro">종일 일정으로 바뀝니다</div>}
        {!canEdit && <div className="cal-evro">보기 전용</div>}
        {err && <div className="ed-err">{err}</div>}
      </div>
      <div className="df">
        {canEdit && <button type="button" className="ed-btn sm red" onClick={del} disabled={busy}>{arm ? "한 번 더 누르면 삭제" : "삭제"}</button>}
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn sm" onClick={onClose}>{canEdit ? "취소" : "닫기"}</button>
        {canEdit && <button type="button" className="ed-btn sm pri" onClick={() => void save()} disabled={!dirty || !ok || busy}>저장</button>}
      </div>
    </Drawer>
  );
}
