"use client";

// 한 줄 등록창 — `@담당 ~마감 #목표` 문법 + Enter (DESIGN.md 3.5).
//   variant="chips"  업무 현황: 담당 · 마감 · 목표 드롭다운 칩 + 추가
//   variant="tokens" 내 업무: 인식된 값 토큰 알약 + `···` 옵션(담당 · 카테고리 고르거나 적기 · 기한 달력 · 목표) + 추가
// 맨 앞 [업무 | 일정] — 일정은 제목 · 시작일~종료일 · [팀 | 나만] (팀 → /api/events, 나만 → /api/personal-events).
// `자세히` — 기간 · 카테고리 · 공개 · 메모까지 한 번에 채우는 등록 창(AddModal)을 연다.
// 조합 중(한글) Enter 는 무시한다.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { catColor, dueFromWord, isEnter, md, parseLine, todayKst, wd, addDays, weekday, mondayOf } from "@/lib/ed/core";
import { areaOpts, createTask, goalOpts, makeArea, useMeta, type GoalLite } from "./data";
import Combo from "./Combo";
import { api, emitChanged, Seg, usePop, useToast } from "./ui";
import AddModal, { DateIn, type AddPreset } from "./AddModal";

const DUE_OPTS = (today: string) => [
  { label: "오늘", v: today },
  { label: "내일", v: addDays(today, 1) },
  { label: "금요일", v: addDays(today, (5 - weekday(today) + 7) % 7) },
  { label: "다음 주", v: addDays(mondayOf(today), 7) },
];
const goalShort = (g: GoalLite) => g.title.length > 14 ? `${g.title.slice(0, 14)}…` : g.title;

export interface ComposerHandle { setWho: (id: number) => void; focus: () => void }

export default function Composer({ variant = "chips", placeholder, presetWho, onAdded, autoFocusKey }: {
  variant?: "chips" | "tokens"; placeholder?: string; presetWho?: number | null; onAdded?: (id: number, title: string) => void; autoFocusKey?: number;
}) {
  const meta = useMeta();
  const today = todayKst();
  const [text, setText] = useState("");
  const [pick, setPick] = useState<{ who?: number; due?: string | null; goal?: number | null; area?: number }>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen, ref] = usePop<"who" | "goal" | "opts">();
  const input = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"task" | "event">("task");
  const [ev, setEv] = useState<{ start: string; end: string; scope: "team" | "me" }>({ start: today, end: today, scope: "team" });
  const [toast, showToast] = useToast();
  const router = useRouter();
  const [detail, setDetail] = useState<AddPreset | null>(null);
  const openDetail = () => { setDetail({ title: parsed.title || text.trim(), kind: mode, start: mode === "task" ? (due ?? undefined) : ev.start, end: mode === "event" ? ev.end : undefined }); setText(""); };
  const detailNode = detail && <AddModal preset={detail} onClose={() => setDetail(null)} onDone={(msg, id) => { showToast(msg); if (id) onAdded?.(id, ""); }} />;
  const detailBtn = <button type="button" className="ed-comp-more" onClick={openDetail} title="기간 · 카테고리 · 공개까지 등록 창에서">자세히</button>;

  useEffect(() => { if (presetWho) { setPick((p) => ({ ...p, who: presetWho })); input.current?.focus(); } }, [presetWho, autoFocusKey]);

  const parsed = useMemo(() => parseLine(text), [text]);
  // 문법으로 인식한 값 — 직접 고른 값보다 뒤에 온다(타이핑하면 덮는다)
  const auto = useMemo(() => {
    const r: { who?: number; due?: string; goal?: number } = {};
    if (!meta) return r;
    if (parsed.who) {
      const w = parsed.who === "나" ? meta.me : meta.people.find((p) => p.name === parsed.who || p.name.startsWith(parsed.who!));
      if (w) r.who = w.id;
    }
    if (parsed.due) { const d = dueFromWord(parsed.due, today); if (d) r.due = d; }
    if (parsed.tag) { const g = meta.goals.find((x) => x.title.includes(parsed.tag!)); if (g) r.goal = g.id; }
    return r;
  }, [parsed, meta, today]);
  const areaByTag = meta && parsed.tag ? meta.areas.find((a) => a.name === parsed.tag || a.name.startsWith(parsed.tag!)) : undefined;

  const who = auto.who ?? pick.who ?? meta?.me.id;
  const due = auto.due ?? (pick.due === undefined ? null : pick.due);
  const goal = auto.goal ?? pick.goal ?? null;
  const area = areaByTag?.id ?? pick.area;
  const whoName = meta?.people.find((p) => p.id === who)?.name;
  const goalObj = meta?.goals.find((g) => g.id === goal);
  const dueLabel = (d: string | null) => {
    if (!d) return "마감 없음";
    const o = DUE_OPTS(today).find((x) => x.v === d);
    return o ? o.label : `${md(d)}(${wd(d)})`;
  };

  const ready = parsed.title.length > 0 && !busy;
  const add = async () => {
    if (!ready || !meta) return;
    setBusy(true); setErr("");
    try {
      const body: Record<string, unknown> = { title: parsed.title, assigneeId: who, dueDate: due, status: "todo" };
      if (area) body.areaId = area;
      const { id } = await createTask(body);
      if (goal && id) await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goalIds: [goal] }) }).catch(() => {});
      setText(""); setPick({}); onAdded?.(id, parsed.title);
    } catch (e) { setErr(e instanceof Error ? e.message : "추가하지 못했습니다"); }
    finally { setBusy(false); input.current?.focus(); }
  };

  // ── 일정 ──────────────────────────────────────────────────────
  const evTitle = text.trim();
  const evReady = evTitle.length > 0 && !!ev.start && !!ev.end && ev.end >= ev.start && !busy;
  const addEvent = async () => {
    if (!evReady) return;
    setBusy(true); setErr("");
    try {
      const body = { title: evTitle, startDate: ev.start, endDate: ev.end };
      await api(ev.scope === "team" ? "/api/events" : "/api/personal-events", { method: "POST", body });
      emitChanged();
      setText("");
      showToast(`일정 추가 · ${md(ev.start)}${ev.end !== ev.start ? `~${md(ev.end)}` : ""}${ev.scope === "me" ? " · 나만" : ""}`,
        { label: "달력 보기", run: () => router.push("/v3/calendar") });
    } catch (e) { setErr(e instanceof Error ? e.message : "추가하지 못했습니다"); }
    finally { setBusy(false); input.current?.focus(); }
  };
  const modeSw = (
    <Seg className="ev-sw" value={mode} onChange={(m) => { setMode(m); setErr(""); setOpen(null); input.current?.focus(); }}
         options={[{ v: "task", label: "업무" }, { v: "event", label: "일정" }]} />
  );

  if (mode === "event") {
    const onKey = (e: React.KeyboardEvent) => { if (isEnter(e)) { e.preventDefault(); void addEvent(); } };
    return (
      <div className={`ed-comp ev${variant === "tokens" ? " tk" : ""}`}>
        {modeSw}
        <input ref={input} value={text} maxLength={120} onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
               placeholder="일정 이름 (박람회 · 교육 …)" aria-label="새 일정" />
        <div className="ev-opts">
          <div className="ev-when">
            <input type="date" className="ev-d" value={ev.start} aria-label="시작일" onKeyDown={onKey}
                   onChange={(e) => { const v = e.target.value; setEv((x) => ({ ...x, start: v, end: v && x.end < v ? v : x.end })); }} />
            <span>~</span>
            <input type="date" className="ev-d" value={ev.end} min={ev.start} aria-label="종료일" onKeyDown={onKey}
                   onChange={(e) => { const v = e.target.value; setEv((x) => ({ ...x, end: v })); }} />
          </div>
          <Seg className="ev-sc" value={ev.scope} onChange={(v) => setEv((x) => ({ ...x, scope: v }))}
               options={[{ v: "team", label: "팀" }, { v: "me", label: "나만" }]} />
          {detailBtn}
          <button type="button" className={`add${evReady ? "" : " off"}`} onClick={() => void addEvent()} disabled={!evReady}>추가</button>
        </div>
        {err && <div className="cerr">{err}</div>}
        {toast}{detailNode}
      </div>
    );
  }

  const opt = (on: boolean, label: React.ReactNode, fn: () => void, key: string | number) => (
    <button key={key} type="button" className={on ? "on" : undefined} onClick={() => { fn(); setOpen(null); }}>{label}</button>
  );

  if (variant === "tokens") {
    const tokens: { label: string; cls: string; dot?: string }[] = [];
    if (who && who !== meta?.me.id && whoName) tokens.push({ label: `@${whoName}`, cls: "acc" });
    const areaName = meta?.areas.find((a) => a.id === area)?.name;
    if (areaName) tokens.push({ label: areaName, cls: "", dot: catColor(areaName) });
    if (due) tokens.push({ label: dueLabel(due), cls: "amb" });
    if (goalObj) tokens.push({ label: `${goalShort(goalObj)} 목표`, cls: "" });
    return (
      <div className="ed-comp tk" ref={ref}>
        {modeSw}
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void add(); } }}
               placeholder={placeholder ?? "할 일을 적고 Enter"} aria-label="새 업무" />
        <div className="toks">{tokens.map((t) => <span key={t.label} className={`tkn ${t.cls}`}>{t.dot && <i style={{ background: t.dot }} />}{t.label}</span>)}</div>
        <div className="ed-rel">
          <button type="button" className={`more${open === "opts" ? " on" : ""}`} title="옵션" onClick={() => setOpen(open === "opts" ? null : "opts")}>···</button>
          {open === "opts" && meta && (
            <div className="ed-optpop cp-opts">
              <label className="cp-f"><span>담당</span>
                <select className="ed-input" value={who ?? ""} onChange={(e) => setPick((x) => ({ ...x, who: Number(e.target.value) }))}>
                  {meta.people.map((p) => <option key={p.id} value={p.id}>{p.id === meta.me.id ? `나 · ${p.name}` : p.name}</option>)}
                </select>
              </label>
              <div className="cp-f"><span>카테고리</span>
                <Combo label="카테고리" value={area ?? null} options={areaOpts(meta)} none="기타" onPick={(id) => setPick((x) => ({ ...x, area: id ?? undefined }))}
                       onCreate={async (name) => { try { const id = await makeArea(name); setPick((x) => ({ ...x, area: id })); } catch (e) { setErr(e instanceof Error ? e.message : "만들지 못했습니다"); } }} />
              </div>
              <div className="cp-f"><span>기한</span>
                <DateIn label="기한" value={due ?? ""} onChange={(v) => setPick((x) => ({ ...x, due: v || null }))} />
              </div>
              <div className="cp-f"><span>목표</span>
                <Combo label="목표" value={goal} options={goalOpts(meta, false)} none="없음" onPick={(id) => setPick((x) => ({ ...x, goal: id }))} />
              </div>
            </div>
          )}
        </div>
        {detailBtn}
        <button type="button" className={`add${ready ? "" : " off"}`} onClick={() => void add()} disabled={!ready}>추가</button>
        {err && <div className="cerr">{err}</div>}
        {toast}{detailNode}
      </div>
    );
  }

  return (
    <div className="ed-comp" ref={ref}>
      {modeSw}
      <input ref={input} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void add(); } }}
             placeholder={placeholder ?? "새 업무   @담당  ~마감  #목표"} aria-label="새 업무" />
      <div className="opts">
        <div className="ed-rel">
          <button type="button" className={`tok${who && who !== meta?.me.id ? " set" : ""}`} onClick={() => setOpen(open === "who" ? null : "who")}>
            {who === meta?.me.id ? "나" : whoName ?? "나"}<span className="cv">▼</span></button>
          {open === "who" && meta && <div className="ed-pop">{meta.people.map((p) => opt(who === p.id, p.id === meta.me.id ? `나 · ${p.name}` : p.name, () => setPick((x) => ({ ...x, who: p.id })), p.id))}</div>}
        </div>
        <label className={`tok tok-date${due ? " set" : ""}`} onClick={(e) => { const el = e.currentTarget.querySelector("input"); try { el?.showPicker(); } catch { el?.focus(); } }}>
          {dueLabel(due)}<span className="cv">▼</span>
          <input type="date" tabIndex={-1} aria-label="마감" value={due ?? ""} onChange={(e) => setPick((x) => ({ ...x, due: e.target.value || null }))} />
        </label>
        <div className="ed-rel">
          <button type="button" className={`tok${goal ? " set" : ""}`} onClick={() => setOpen(open === "goal" ? null : "goal")}>{goalObj ? goalShort(goalObj) : "목표 없음"}<span className="cv">▼</span></button>
          {open === "goal" && meta && <div className="ed-pop">
            {opt(!goal, "목표 없음", () => setPick((x) => ({ ...x, goal: null })), "none")}
            {meta.goals.filter((g) => g.periodType !== "year").map((g) => opt(goal === g.id, g.title, () => setPick((x) => ({ ...x, goal: g.id })), g.id))}
          </div>}
        </div>
        {detailBtn}
        <button type="button" className={`add${ready ? "" : " off"}`} onClick={() => void add()} disabled={!ready}>추가</button>
      </div>
      {err && <div className="cerr">{err}</div>}
      {toast}{detailNode}
    </div>
  );
}
