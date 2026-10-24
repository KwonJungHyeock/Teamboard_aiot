"use client";

// 목표 관리 — 연간 → 분기 → 월 트리 + 오른쪽 상세 (DESIGN.md 5.7 · goals.dc.html).
//   기대치 = 오늘이 목표 기간 안에서 차지하는 위치(%). 진척 = 서버가 저장한 값(연결 업무 완료율).
//   상태: 100% 달성 · 진척−기대치 ≥ 0 앞서감 · −10%p 이내 조금 늦음 · 그보다 늦으면 뒤처짐 · 진척 없음 계획.
//   연결된 업무는 그 목표와 하위 목표에 걸린 업무 전부(`/api/tasks` 의 goalIds).
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { diffDays, lookOf, todayKst, wd, type EdTask, type Look } from "@/lib/ed/core";
import { patchTask, useTasks } from "../data";
import { api, Seg, useOnChanged, usePop, useToast } from "../ui";

interface GNode {
  id: number; parentId: number | null; periodType: "year" | "quarter" | "month"; periodStart: string; periodEnd: string;
  title: string; progress: number | null; ownerName: string | null; scope: string; children: GNode[];
}
interface Row { g: GNode; depth: number; group: string; pct: number | null; expect: number | null }

const SCOPE = { year: "연간", quarter: "분기", month: "월" } as const;
const PIPC = { year: "var(--ink)", quarter: "var(--accent)", month: "var(--faint)" } as const;
const ST_COLOR: Record<"done" | "doing" | "over" | "todo", string> = { done: "var(--green)", doing: "var(--accent)", over: "var(--red)", todo: "var(--faint)" };
const ST_LABEL: Record<"done" | "doing" | "over" | "todo", string> = { done: "완료", doing: "진행", over: "지남", todo: "시작 전" };

function expectOf(g: GNode, today: string): number | null {
  if (today < g.periodStart) return 0;
  if (today > g.periodEnd) return 100;
  const all = diffDays(g.periodEnd, g.periodStart) + 1;
  return Math.round(((diffDays(today, g.periodStart) + 1) / all) * 100);
}
function stateOf(pct: number | null, expect: number | null): { label: string; long: string; color: string } {
  if (pct == null) return { label: "계획", long: "아직 시작 전", color: "var(--faint)" };
  if (pct >= 100) return { label: "달성", long: "달성", color: "var(--green)" };
  const d = pct - (expect ?? 0);
  if (d >= 0) return { label: "앞서감", long: `기대보다 ${d}%p 앞섬`, color: "var(--green)" };
  if (d > -10) return { label: "조금 늦음", long: `기대보다 ${-d}%p 늦음`, color: "var(--amber)" };
  return { label: "뒤처짐", long: `기대보다 ${-d}%p 늦음`, color: "var(--red)" };
}
function periodLabel(g: GNode): string {
  const y = g.periodStart.slice(0, 4), m = Number(g.periodStart.slice(5, 7));
  if (g.periodType === "year") return y;
  if (g.periodType === "quarter") return `${y} Q${Math.floor((m - 1) / 3) + 1}`;
  return `${m}월`;
}
function Pips({ type, big }: { type: GNode["periodType"]; big?: boolean }) {
  const n = type === "year" ? 3 : type === "quarter" ? 2 : 1;
  return <span className={`gol-pips${big ? " lgp" : ""}`}>{[0, 1, 2].map((i) => <i key={i} style={{ background: i < n ? PIPC[type] : "var(--line)" }} />)}</span>;
}
function dueTxt(t: EdTask, look: Look, today: string): string {
  if (look === "done") return "완료";
  if (!t.dueDate) return "";
  const n = diffDays(t.dueDate, today);
  if (n < 0) return `${-n}일 지남`;
  if (n === 0) return "오늘";
  return `${Number(t.dueDate.slice(8, 10))}일(${wd(t.dueDate)})`;
}

export default function Goals() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const today = todayKst();
  const { tasks } = useTasks();
  const [tree, setTree] = useState<GNode[] | null>(null);
  const [err, setErr] = useState("");
  const [filter, setFilter] = useState<"all" | "doing" | "done">("all");
  const [sel, setSel] = useState<number | null>(() => Number(sp.get("g")) || null);
  const [flip, setFlip] = useState(0);
  const [mounted, setMounted] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try { setTree((await api<{ tree: GNode[] }>("/api/goals")).tree); }
    catch (e) { setErr(e instanceof Error ? e.message : "불러오지 못했습니다"); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useOnChanged(() => { void load(); });
  useEffect(() => { const t = setTimeout(() => setMounted(true), 80); return () => clearTimeout(t); }, []);

  // 트리 → 줄(깊이 우선, 기간 순). 연도 묶음: 시작 전인 해는 「n 계획」
  const all = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const walk = (g: GNode, depth: number, group: string) => {
      out.push({ g, depth, group, pct: g.progress, expect: expectOf(g, today) });
      [...g.children].sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.id - b.id).forEach((c) => walk(c, depth + 1, group));
    };
    [...(tree ?? [])].sort((a, b) => a.periodStart.localeCompare(b.periodStart) || a.id - b.id).forEach((g) => {
      const y = g.periodStart.slice(0, 4);
      walk(g, 0, g.periodStart > today ? `${y} 계획` : y);
    });
    return out;
  }, [tree, today]);
  const rows = all.filter((r) => filter === "all" || (filter === "doing" ? r.pct != null && r.pct < 100 : r.pct != null && r.pct >= 100));
  const byId = useMemo(() => new Map(all.map((r) => [r.g.id, r])), [all]);

  useEffect(() => { if (all.length && (sel == null || !byId.has(sel))) setSel(all[0].g.id); }, [all, sel, byId]);
  const pick = (id: number) => {
    setSel(id); setFlip((n) => n + 1);
    const q = new URLSearchParams(sp.toString()); q.set("g", String(id));
    router.replace(`${path}?${q}`, { scroll: false });
  };

  const cur = sel != null ? byId.get(sel) : undefined;

  return (
    <div className="gol">
      <div className="gol-head">
        <div className="l">
          <h1 className="ed-h1">목표 관리</h1>
          <Seg value={filter} onChange={setFilter} className="gol-seg"
               options={[{ v: "all", label: "전체" }, { v: "doing", label: "진행 중" }, { v: "done", label: "달성" }]} />
        </div>
        <div className="r">
          <span className="gol-legend"><i />오늘 기준 기대치</span>
          <NewGoal selected={cur?.g ?? null} onMade={(id) => { void load().then(() => pick(id)); showToast("목표를 만들었습니다"); }} onErr={showToast} />
        </div>
      </div>
      <div className="gol-main">
        <section className="gol-tree">
          <div className="in ed-scroll">
            {err && <div className="ed-err" style={{ padding: 12 }}>{err}</div>}
            {tree && rows.length === 0 && <div className="ed-empty" style={{ padding: "14px 10px" }}>목표 없음</div>}
            {rows.map((r, i) => {
              const st = stateOf(r.pct, r.expect);
              const on = r.g.id === sel;
              const first = i === 0 || rows[i - 1].group !== r.group;
              const delay = `${(0.15 + Math.min(i, 12) * 0.07).toFixed(2)}s`;
              const gap = r.pct != null && r.pct < 100 ? r.pct - (r.expect ?? 0) : null;
              return (
                <div key={r.g.id} className="gol-rw">
                  {first && <div className="gol-grp" style={{ paddingTop: i === 0 ? 6 : 18, animationDelay: delay }}><span>{r.group}</span><i /></div>}
                  <div role="button" tabIndex={0} className={`gol-row${on ? " on" : ""}${r.pct == null ? " plan" : ""}`}
                       style={{ ["--ind" as string]: `${r.depth * 26}px`, animationDelay: delay } as React.CSSProperties}
                       onClick={() => pick(r.g.id)} onKeyDown={(e) => { if (e.key === "Enter") pick(r.g.id); }}>
                    <div className="br">{r.depth > 0 && <span style={{ animationDelay: delay }} />}</div>
                    <div className="nm">
                      <div className="t1">
                        <span className="sc" style={{ color: r.g.periodType === "year" ? "var(--ink)" : r.g.periodType === "quarter" ? "var(--accent)" : "var(--sub)" }}>
                          <Pips type={r.g.periodType} />{SCOPE[r.g.periodType]}
                        </span>
                        <span className={`tt${r.depth === 0 ? " top" : ""}`}>{r.g.title}</span>
                      </div>
                      <div className="mt">{periodLabel(r.g)}{r.g.ownerName ? ` · ${r.g.ownerName}` : ""}</div>
                    </div>
                    <div className="ga">
                      <div className="bar">
                        <div className="tr"><div className="fl" style={{ width: mounted && r.pct != null ? `${r.pct}%` : "0%", background: st.color, transitionDelay: delay }} /></div>
                        {r.expect != null && r.pct != null && r.pct < 100 && <span className="ex" style={{ left: `${r.expect}%` }} />}
                      </div>
                      <span className="st" style={{ color: st.color }}>{st.label}{gap != null ? ` · ${gap >= 0 ? "+" : "−"}${Math.abs(gap)}%p` : ""}</span>
                    </div>
                    <span className="pc" style={{ color: r.pct == null ? "var(--faint)" : "var(--ink)" }}>{r.pct == null ? "—" : `${r.pct}%`}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
        {cur ? <Detail key={cur.g.id} row={cur} byId={byId} tasks={tasks} today={today} flip={flip} mounted={mounted} onPick={pick} toast={showToast} /> : <aside className="gol-det" />}
      </div>
      {toast}
    </div>
  );
}

function Detail({ row, byId, tasks, today, flip, mounted, onPick, toast }: {
  row: Row; byId: Map<number, Row>; tasks: EdTask[] | null; today: string; flip: number; mounted: boolean; onPick: (id: number) => void; toast: (t: string) => void;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const g = row.g;
  const st = stateOf(row.pct, row.expect);
  const par = g.parentId != null ? byId.get(g.parentId)?.g : undefined;
  const sub = useMemo(() => { const s = new Set<number>(); const w = (n: GNode) => { s.add(n.id); n.children.forEach(w); }; w(g); return s; }, [g]);
  const linked = useMemo(() => (tasks ?? []).filter((t) => t.goalIds.some((id) => sub.has(id)) && ["todo", "doing", "review", "done"].includes(t.status))
    .map((t) => { const l = lookOf(t, today); return { t, look: l, k: (l === "review" ? "doing" : l) as "done" | "doing" | "over" | "todo" }; }), [tasks, sub, today]);
  const order = ["over", "doing", "todo", "done"];
  const sorted = [...linked].sort((a, b) => order.indexOf(a.k) - order.indexOf(b.k) || (a.t.dueDate ?? "9999").localeCompare(b.t.dueDate ?? "9999"));
  const cnt = (k: string) => linked.filter((x) => x.k === k).length;
  const segs = (["done", "doing", "over", "todo"] as const).map((k) => ({ k, n: cnt(k) })).filter((x) => x.n);
  const open = (id: number) => { const q = new URLSearchParams(sp.toString()); q.set("task", String(id)); router.push(`${path}?${q}`, { scroll: false }); };

  return (
    <aside className="gol-det" style={{ background: `radial-gradient(420px 220px at 100% 0%,color-mix(in oklch, ${st.color} 10%, transparent),transparent 70%),var(--surface)` }}>
      <div className={`in ed-scroll det${flip % 2 ? "A" : "B"}`}>
        <div className="hd">
          <div className="mt">
            <span className="sc" style={{ color: g.periodType === "year" ? "var(--ink)" : g.periodType === "quarter" ? "var(--accent)" : "var(--sub)" }}><Pips type={g.periodType} big />{SCOPE[g.periodType]}</span>
            {periodLabel(g)}{g.ownerName && <span>· 담당 {g.ownerName}</span>}
          </div>
          <div className="tt">{g.title}</div>
          {par && <button type="button" className="up" onClick={() => onPick(par.id)}>↑ {par.title}</button>}
        </div>
        <div className="pg">
          <div className="big"><span className="tn" style={{ color: st.color }}>{row.pct == null ? "—" : `${row.pct}%`}</span><em style={{ color: st.color }}>{st.long}</em></div>
          <div className="sbar">
            {segs.map((s) => <span key={s.k} style={{ flexGrow: mounted ? s.n : 0, background: ST_COLOR[s.k] }} />)}
            {row.expect != null && row.pct != null && row.pct < 100 && <i style={{ left: `${row.expect}%` }} />}
          </div>
          {segs.length > 0 && <div className="lg">{segs.map((s) => <span key={s.k}><i style={{ background: ST_COLOR[s.k] }} />{ST_LABEL[s.k]}<b className="tn">{s.n}</b></span>)}</div>}
        </div>
        {g.children.length > 0 && (
          <div className="kids">
            <span className="ed-label">하위 목표</span>
            {[...g.children].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).map((c) => {
              const r = byId.get(c.id); const s = stateOf(c.progress, r?.expect ?? null);
              return (
                <button key={c.id} type="button" onClick={() => onPick(c.id)}>
                  <span className="t">{c.title}</span>
                  <span className="b"><span style={{ width: `${c.progress ?? 0}%`, background: s.color }} /></span>
                  <span className="p tn">{c.progress == null ? "—" : `${c.progress}%`}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="tasks">
          <div className="th"><span className="ed-label">연결된 업무 {linked.length}</span><LinkTask goalId={g.id} tasks={tasks} linkedIds={new Set(linked.map((x) => x.t.id))} toast={toast} /></div>
          {sorted.map(({ t, look, k }, i) => (
            <div key={t.id} role="button" tabIndex={0} className="tk" style={{ animationDelay: `${(0.1 + Math.min(i, 14) * 0.03).toFixed(2)}s` }}
                 onClick={() => open(t.id)} onKeyDown={(e) => { if (e.key === "Enter") open(t.id); }}>
              <i style={{ background: ST_COLOR[k] }} />
              <span className={`t${k === "done" ? " done" : ""}`}>{t.title}</span>
              <span className="w">{t.assigneeName ?? ""}</span>
              <span className="d tn" style={{ color: k === "over" ? "var(--red)" : "var(--faint)" }}>{dueTxt(t, look, today)}</span>
            </div>
          ))}
          {tasks && linked.length === 0 && <div className="ed-empty" style={{ padding: "14px 6px" }}>연결된 업무 없음</div>}
        </div>
      </div>
    </aside>
  );
}

/** + 업무 연결 — 아직 이 목표에 안 걸린 업무(상위 업무만)를 골라 goalIds 에 더한다 */
function LinkTask({ goalId, tasks, linkedIds, toast }: { goalId: number; tasks: EdTask[] | null; linkedIds: Set<number>; toast: (t: string) => void }) {
  const [open, setOpen, ref] = usePop<"link">();
  const [q, setQ] = useState("");
  const cands = (tasks ?? []).filter((t) => t.parentTaskId === null && !linkedIds.has(t.id) && ["todo", "doing", "review"].includes(t.status)
    && (!q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 40);
  const link = async (t: EdTask) => {
    setOpen(null); setQ("");
    try { await patchTask(t.id, { goalIds: Array.from(new Set([...t.goalIds, goalId])) }); toast("업무를 연결했습니다"); }
    catch (e) { toast(e instanceof Error ? e.message : "연결하지 못했습니다"); }
  };
  return (
    <div className="ed-rel" ref={ref}>
      <button type="button" className="gol-link" onClick={() => setOpen(open ? null : "link")}>+ 업무 연결</button>
      {open && (
        <div className="ed-pop gol-linkpop">
          <input className="ed-input" placeholder="업무 찾기" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {cands.length === 0 ? <div className="ed-empty" style={{ padding: "8px 10px" }}>없음</div>
            : cands.map((t) => <button key={t.id} type="button" onClick={() => void link(t)}><span className="t">{t.title}</span><em>{t.assigneeName ?? ""}</em></button>)}
        </div>
      )}
    </div>
  );
}

/** + 목표 — 제목 + 주기. 기간은 이번 해 · 분기 · 달로 시작한다. 고른 목표가 바로 위 단계면 그 아래에 만든다 */
function NewGoal({ selected, onMade, onErr }: { selected: GNode | null; onMade: (id: number) => void; onErr: (t: string) => void }) {
  const [open, setOpen, ref] = usePop<"new">();
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"year" | "quarter" | "month">("month");
  const [busy, setBusy] = useState(false);
  const today = todayKst();
  const y = today.slice(0, 4), m = Number(today.slice(5, 7));
  const start = type === "year" ? `${y}-01-01` : type === "quarter" ? `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01` : `${today.slice(0, 7)}-01`;
  const parentType = type === "month" ? "quarter" : type === "quarter" ? "year" : null;
  const placed = selected && parentType && selected.periodType === parentType ? selected.id : null;
  const make = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    const body = { title: t, periodType: type, periodStart: start, placedParentId: placed, scope: "team" };
    try {
      let d: { id?: number; goal?: { id: number } };
      try { d = await api("/api/goals", { method: "POST", body }); }
      catch (e) {
        if (!(e instanceof Error) || !e.message.includes("팀장만")) throw e;
        d = await api("/api/goals", { method: "POST", body: { ...body, scope: "personal", placedParentId: null } });
      }
      setTitle(""); setOpen(null);
      onMade(d.id ?? d.goal?.id ?? 0);
    } catch (e) { onErr(e instanceof Error ? e.message : "만들지 못했습니다"); }
    finally { setBusy(false); }
  };
  return (
    <div className="ed-rel" ref={ref}>
      <button type="button" className="ed-btn pri gol-new" onClick={() => setOpen(open ? null : "new")}>+ 목표</button>
      {open && (
        <div className="ed-optpop gol-newpop">
          <input className="ed-input" placeholder="목표 이름" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
                 onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void make(); }} />
          <Seg full value={type} onChange={setType} options={[{ v: "year", label: "연간" }, { v: "quarter", label: "분기" }, { v: "month", label: "월" }]} />
          <div className="ft">
            <span>{type === "year" ? y : type === "quarter" ? `${y} Q${Math.floor((m - 1) / 3) + 1}` : `${m}월`}{placed && selected ? ` · ${selected.title}` : ""}</span>
            <button type="button" className="ed-btn pri sm" disabled={!title.trim() || busy} onClick={() => void make()}>만들기</button>
          </div>
        </div>
      )}
    </div>
  );
}
