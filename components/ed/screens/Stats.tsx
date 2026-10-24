"use client";

// 성과 분석 (DESIGN.md 5.8 · stats.dc.html) — 분석 관제. 숫자는 `/api/ed/stats` 가 센다.
// 색은 accent · accent 45% · faint · green · red 만. 지속 움직임은 「오늘」 점의 ping 하나.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, diffDays, md } from "@/lib/ed/core";
import { api } from "../ui";
import type { StatsData } from "@/lib/ed/stats";

const ST = [
  { k: "doing", label: "진행", color: "var(--accent)" },
  { k: "review", label: "검토", color: "var(--review)" },
  { k: "todo", label: "시작 전", color: "var(--faint)" },
  { k: "done", label: "완료", color: "var(--green)" },
] as const;
const RING_COLOR = ["var(--accent)", "color-mix(in oklch, var(--accent) 62%, var(--panel2))", "color-mix(in oklch, var(--accent) 34%, var(--panel2))"];
const LOAD_COLOR = ["var(--red)", "var(--accent)", "var(--review)", "color-mix(in oklch, var(--faint) 45%, var(--panel2))"];
const CAP = 8;

const shiftMonth = (m: string, n: number) => {
  const d = new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

interface Ai { expect: string; cause: string; suggest: string }

export default function Stats({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [data, setData] = useState<StatsData | null>(null);
  const [err, setErr] = useState("");
  const [mounted, setMounted] = useState(false);
  const [p, setP] = useState(0);
  const [mode, setMode] = useState<"cat" | "who">("cat");
  const [modeN, setModeN] = useState(0);
  const [hv, setHv] = useState<{ r: number; c: number } | null>(null);
  const [hd, setHd] = useState<number | null>(null);
  const [ai, setAi] = useState<Ai | null>(null);
  const raf = useRef(0);
  const chart = useRef<HTMLDivElement>(null);

  const countUp = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = (t: number) => { const x = Math.min(1, (t - t0) / 1100); setP(x); if (x < 1) raf.current = requestAnimationFrame(step); };
    raf.current = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    let alive = true;
    setErr("");
    api<StatsData>(`/api/ed/stats?month=${month}`).then((d) => {
      if (!alive) return;
      setData(d); countUp();
      setTimeout(() => alive && setMounted(true), 80);
    }).catch((e) => alive && setErr(e instanceof Error ? e.message : "불러오지 못했습니다"));
    setAi(null);
    api<Ai>(`/api/ed/stats/ai?month=${month}`).then((a) => alive && setAi(a)).catch(() => {});
    return () => { alive = false; };
  }, [month, countUp]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const move = (n: number) => { setMonth((m) => shiftMonth(m, n)); setModeN((x) => x + 1); };
  const ez = 1 - Math.pow(1 - p, 3);
  const cu = (v: number, dp = 0) => (v * ez).toFixed(dp);
  const title = `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;

  const head = (
    <div className="st-head">
      <div className="st-hl">
        <h1 className="ed-h1">성과 분석</h1>
        <div className="st-mon">
          <button type="button" onClick={() => move(-1)} aria-label="이전 달">‹</button>
          <span className="tn">{title}</span>
          <button type="button" onClick={() => move(1)} aria-label="다음 달">›</button>
        </div>
      </div>
      <div className="st-legend">{ST.map((s) => <span key={s.k}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  );
  if (err) return <>{head}<div className="ed-err">{err}</div></>;
  if (!data) return <>{head}<div className="ed-empty">불러오는 중</div></>;

  // ── KPI ─────────────────────────────────────────────
  const rings = data.rings.map((r, i) => {
    const pc = r.total ? r.done / r.total : 0, rad = [44, 32, 20][i], C = 2 * Math.PI * rad;
    return { ...r, rad, C, pc, color: RING_COLOR[i], dash: `${mounted ? C * pc : 0} ${C}`, delay: `${(0.15 + i * 0.18).toFixed(2)}s` };
  });
  const mRing = data.rings[2];
  const wmax = Math.max(1, ...data.weeks.map((w) => w.n));
  const wNow = data.weeks[7], wd = wNow.n - data.weeks[6].n;
  const lmax = Math.max(1, ...data.cycle.buckets);
  const agTot = data.aging.buckets.reduce((a, b) => a + b, 0);

  // ── 가오픈 추이 ─────────────────────────────────────
  const b = data.burn, N = b.days, TD = b.todayIdx, SC = Math.max(1, b.scope);
  const X = (d: number) => +(20 + (d / N) * 600).toFixed(1), Y = (r: number) => +(200 - (r / SC) * 180).toFixed(1);
  const rem = (d: number) => b.remaining[Math.min(d, TD)] ?? b.scope;
  const pts: [number, number][] = [[0, rem(0)]];
  for (let d = 1; d <= TD; d++) if (rem(d) !== rem(d - 1)) pts.push([d, rem(d)]);
  if (pts[pts.length - 1][0] !== TD) pts.push([TD, rem(TD)]);
  let act = `M${X(pts[0][0])} ${Y(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [d0, r0] = pts[i - 1], [d1, r1] = pts[i], mx = ((X(d0) + X(d1)) / 2).toFixed(1);
    act += ` C${mx} ${Y(r0)} ${mx} ${Y(r1)} ${X(d1)} ${Y(r1)}`;
  }
  const area = `${act} L${X(TD)} 200 L${X(0)} 200 Z`;
  const ideal = `M${X(0)} ${Y(b.scope)} L${X(N)} ${Y(0)}`;
  const fcEnd = Math.max(0, rem(TD) - b.rate * (N - TD));
  const fc = `M${X(TD)} ${Y(rem(TD))} L${X(N)} ${Y(fcEnd)}`;
  const dLeft = N - TD;
  const near = Math.max(3, N / 10);
  const ticks = [0, Math.round(N / 4), Math.round(N / 2)]
    .filter((d, i, a) => a.indexOf(d) === i && Math.abs(d - TD) >= near && N - d >= near)
    .map((d) => ({ d, label: md(addDays(b.start, d)), strong: false }));
  if (!b.past && N - TD >= near / 2) ticks.push({ d: TD, label: "오늘", strong: true });
  ticks.push({ d: N, label: `가오픈 ${md(b.open)}`, strong: true });
  const hoverPt = hd === null ? null : { x: X(hd), y: Y(rem(hd)), label: `${md(addDays(b.start, hd))} · ${rem(hd)}건 남음` };
  const onChart = (e: React.MouseEvent) => {
    const el = chart.current; if (!el) return;
    const rc = el.getBoundingClientRect();
    const d = Math.round((((e.clientX - rc.left) / rc.width) * 640 - 20) / 600 * N);
    const c = Math.max(0, Math.min(TD, d));
    if (c !== hd) setHd(c);
  };
  const bdStats = [
    { v: cu(rem(TD)), unit: "건", label: "남은 업무", dot: "var(--accent)" },
    { v: cu(b.rate, 1), unit: "건/일", label: "완료 속도", dot: "var(--green)" },
    { v: cu(b.need, 1), unit: "건/일", label: "필요 속도", dot: "var(--faint)" },
    { v: cu(fcEnd), unit: "건", label: "가오픈 때 남음", dot: "var(--red)" },
  ];

  // ── 이 달 기한 · 가오픈 구분 ────────────────────────
  const units: { color: string; ring: boolean; label: string }[] = [];
  ST.forEach((s) => { for (let n = 0; n < data.monthDue[s.k]; n++) units.push({ color: s.k === "todo" ? "transparent" : s.color, ring: s.k === "todo", label: s.label }); });
  const L = data.launch;
  const launch = [
    { label: "가오픈 이전", n: L.before, color: "var(--accent)" },
    { label: "가오픈 이후", n: L.after, color: "var(--review)" },
    { label: "기한 없음", n: L.none, color: "color-mix(in oklch, var(--faint) 45%, var(--panel2))" },
    { label: "완료", n: L.done, color: "var(--green)" },
  ];

  // ── 교차표 ──────────────────────────────────────────
  const rows = data.cross[mode];
  const colSum = ST.map((_, ci) => rows.reduce((a, r) => a + r.v[ci], 0));
  const grand = colSum.reduce((a, x) => a + x, 0);
  const maxCell = Math.max(1, ...rows.flatMap((r) => r.v));
  const maxTot = Math.max(1, ...rows.map((r) => r.v.reduce((a, x) => a + x, 0)));
  const mx = modeN % 2 ? "mxA" : "mxB";

  // ── 부하 ────────────────────────────────────────────
  const LMAX = Math.max(16, ...data.load.map((l) => l.v.reduce((a, x) => a + x, 0)));

  return (
    <div className="st">
      {head}

      <div className="st-kpi">
        <section className="st-card st-ring q" style={{ animationDelay: "0s" }}>
          <div className="st-rg">
            <svg width="104" height="104" viewBox="0 0 104 104">
              {rings.map((r) => (
                <g key={r.label}>
                  <circle cx="52" cy="52" r={r.rad} fill="none" className="st-rbg" />
                  <circle cx="52" cy="52" r={r.rad} fill="none" style={{ stroke: r.color, strokeDasharray: r.dash, opacity: r.pc ? 1 : 0, transitionDelay: r.delay }} className="st-rfg" />
                </g>
              ))}
            </svg>
            <span className="tn">{mRing.total ? `${cu(Math.round((mRing.done / mRing.total) * 100))}%` : "—"}</span>
          </div>
          <div className="st-rl">
            <span className="st-k">완료율</span>
            {rings.map((r) => (
              <div key={r.label}><i style={{ background: r.color }} /><span>{r.label} · {r.done}/{r.total}</span><b className="tn">{r.total ? `${Math.round(r.pc * 100)}%` : "—"}</b></div>
            ))}
          </div>
        </section>

        <section className="st-card q" style={{ animationDelay: ".05s" }}>
          <span className="st-k">주간 완료</span>
          <div className="st-big"><b className="tn">{cu(wNow.n)}<small>건</small></b>
            <em style={{ color: wd > 0 ? "var(--green)" : wd < 0 ? "var(--red)" : "var(--faint)" }}>{wd > 0 ? "▲" : wd < 0 ? "▼" : "±"}{Math.abs(wd)}</em>
            <span>{wNow.label === "이번" ? "이번 주" : wNow.label}</span></div>
          <div className="st-bars">
            {data.weeks.map((w, i) => (
              <div key={i}><div><i style={{ height: mounted ? `${(w.n / wmax) * 100}%` : "0%", background: i === 7 ? "var(--green)" : "color-mix(in oklch, var(--green) 32%, var(--panel2))", transitionDelay: `${(0.2 + i * 0.05).toFixed(2)}s` }} /></div><span className="tn">{w.label}</span></div>
            ))}
          </div>
        </section>

        <section className="st-card q" style={{ animationDelay: ".1s" }}>
          <span className="st-k">처리 기간</span>
          <div className="st-big"><b className="tn">{data.cycle.avg === null ? "—" : <>{cu(data.cycle.avg, 1)}<small>일</small></>}</b>
            <span>{data.cycle.median === null ? "완료 없음" : `평균 · 중앙값 ${data.cycle.median}일`}</span></div>
          <div className="st-bars lead">
            {["1일", "2–3", "4–7", "8–14", "15+"].map((label, i) => (
              <div key={label}><div><b className="tn">{data.cycle.buckets[i]}</b><i style={{ height: mounted ? `${(data.cycle.buckets[i] / lmax) * 78}%` : "0%", transitionDelay: `${(0.25 + i * 0.06).toFixed(2)}s` }} /></div><span>{label}</span></div>
            ))}
          </div>
        </section>

        <section className="st-card q" style={{ animationDelay: ".15s" }}>
          <span className="st-k">지연 노후도</span>
          <div className="st-big"><b className="tn">{cu(agTot)}<small>건</small></b><span>{data.aging.max ? `최장 ${data.aging.max}일` : "지연 없음"}</span></div>
          <div className={`st-split${agTot ? "" : " empty"}`} style={{ height: 12 }}>
            {agTot > 0 && data.aging.buckets.map((n, i) => (
              <i key={i} style={{ flexGrow: mounted ? Math.max(n, 0.001) : i ? 0.001 : 1, background: `color-mix(in oklch, var(--red) ${[30, 52, 76, 100][i]}%, var(--panel2))`, transitionDelay: `${(0.3 + i * 0.08).toFixed(2)}s` }} />
            ))}
          </div>
          <div className="st-ag">
            {["1–3일", "4–7일", "8–14일", "15일+"].map((label, i) => (
              <span key={label}><i style={{ background: `color-mix(in oklch, var(--red) ${[30, 52, 76, 100][i]}%, var(--panel2))` }} />{label}<b className="tn">{data.aging.buckets[i]}</b></span>
            ))}
          </div>
        </section>
      </div>

      <div className="st-mid">
        <section className="st-card st-bd q" style={{ animationDelay: ".2s" }}>
          <div className="st-bdh">
            <span className="st-t">가오픈 잔여 업무 추이</span>
            <span className="st-od tn">{md(b.open)}</span>
            <span className="st-dd tn">{b.past ? `D+${diffDays(data.today, b.open)}` : dLeft === 0 ? "D-day" : `D-${dLeft}`}</span>
            <div className="st-bdl">
              <span><i className="dot" />계획 잔여</span>
              <span><i className="ln" />실제 잔여</span>
              <span><i className="dot red" />현재 속도 예상</span>
            </div>
          </div>
          <div className="st-chart" ref={chart} onMouseMove={onChart} onMouseLeave={() => setHd(null)}>
            {ai && (
              <div className="st-ai">
                <span className="st-ait"><span>✦</span>AI 분석</span>
                {[ai.expect, ai.cause, ai.suggest].filter(Boolean).map((t, i) => <div key={i}><i />{t}</div>)}
              </div>
            )}
            {hoverPt && <div className="st-tip" style={{ left: `${(hoverPt.x / 640) * 100}%`, top: `${(hoverPt.y / 206) * 100}%` }}>{hoverPt.label}</div>}
            <svg viewBox="0 0 640 206">
              <defs>
                <linearGradient id="bdFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.26 }} /><stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} /></linearGradient>
                <linearGradient id="bdLine" x1="0" y1="0" x2="1" y2="0"><stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0.55 }} /><stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 1 }} /></linearGradient>
                <linearGradient id="bdToday" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} /><stop offset=".5" style={{ stopColor: "var(--accent)", stopOpacity: 0.35 }} /><stop offset="1" style={{ stopColor: "var(--accent)", stopOpacity: 0 }} /></linearGradient>
              </defs>
              {[0, Math.round(b.scope / 2), b.scope].map((r, i) => <line key={i} x1="20" x2="620" y1={Y(r)} y2={Y(r)} className="st-grid" />)}
              <rect x={X(TD)} y="20" width={Math.max(0, X(N) - X(TD))} height="180" rx="10" className="st-rest" />
              <path d={area} className="st-area" style={{ opacity: mounted ? 1 : 0 }} />
              <path d={ideal} className="st-ideal" />
              <path key={`a${month}`} d={act} pathLength={1} className="st-act" style={{ strokeDashoffset: mounted ? 0 : 1 }} />
              {!b.past && <path d={fc} className="st-fc" style={{ opacity: mounted ? 1 : 0 }} />}
              <line x1={X(TD)} x2={X(TD)} y1="20" y2="200" style={{ stroke: "url(#bdToday)", strokeWidth: 1.5 }} />
              {!b.past && <circle cx={X(TD)} cy={Y(rem(TD))} r="6" className="st-ping" style={{ opacity: mounted ? 1 : 0 }} />}
              <circle cx={X(TD)} cy={Y(rem(TD))} r="5" className="st-now" style={{ opacity: mounted ? 1 : 0 }} />
              {!b.past && <circle cx="620" cy={Y(fcEnd)} r="4" className="st-fce" style={{ opacity: mounted ? 1 : 0 }} />}
              <circle cx="620" cy="200" r="3.5" style={{ fill: "var(--faint)", opacity: 0.8 }} />
              <line x1={hoverPt?.x ?? 0} x2={hoverPt?.x ?? 0} y1="20" y2="200" className="st-cross" style={{ opacity: hoverPt ? 0.35 : 0 }} />
              <circle cx={hoverPt?.x ?? 0} cy={hoverPt?.y ?? 0} r="4.5" className="st-hdot" style={{ opacity: hoverPt ? 1 : 0 }} />
            </svg>
          </div>
          <div className="st-x">
            {ticks.map((t) => (
              <span key={t.label} style={{ left: `${(X(t.d) / 640) * 100}%`, transform: `translateX(${t.d === 0 ? "-20%" : t.d === N ? "-80%" : "-50%"})`,
                fontWeight: t.strong ? 700 : 500, color: t.label === "오늘" ? "var(--accent)" : t.d === N ? "var(--ink)" : "var(--faint)" }}>{t.label}</span>
            ))}
          </div>
          <div className="st-bds">
            {bdStats.map((s) => (
              <div key={s.label}><span><i style={{ background: s.dot }} />{s.label}</span><b className="tn">{s.v}<small>{s.unit}</small></b></div>
            ))}
          </div>
        </section>

        <section className="st-card st-due q" style={{ animationDelay: ".25s" }}>
          <div className="st-col">
            <div className="st-tt"><span className="st-t">이 달 기한 업무</span><span className="st-od tn">{units.length}건</span></div>
            <div className="st-units">
              {units.map((u, i) => <span key={`${month}-${i}`} title={u.label} style={{ background: u.color, boxShadow: u.ring ? "inset 0 0 0 1.5px var(--faint)" : "none", animationDelay: `${(0.25 + i * 0.045).toFixed(3)}s` }} />)}
              {!units.length && <span className="st-none">업무 없음</span>}
            </div>
            <div className="st-sc">{ST.map((s) => <span key={s.k}><i style={{ background: s.color }} />{s.label}<b className="tn">{data.monthDue[s.k]}</b></span>)}</div>
          </div>
          <div className="st-hr" />
          <div className="st-col" style={{ gap: 10 }}>
            <span className="st-t">가오픈 기준 구분</span>
            <div className={`st-split${launch.some((l) => l.n) ? "" : " empty"}`} style={{ height: 10 }}>
              {launch.some((l) => l.n) && launch.map((l, i) => <i key={l.label} style={{ flexGrow: mounted ? Math.max(l.n, 0.001) : i === 0 ? 1 : 0.001, background: l.color, transitionDelay: `${(0.2 + i * 0.1).toFixed(2)}s` }} />)}
            </div>
            <div className="st-lc">{launch.map((l) => <div key={l.label}><b className="tn">{l.n}</b><span>{l.label}</span></div>)}</div>
          </div>
        </section>
      </div>

      <div className="st-mid">
        <section className="st-card st-mx q" style={{ animationDelay: ".3s" }}>
          <div className="st-mxh">
            <div className="ed-seg">
              {(["cat", "who"] as const).map((k) => (
                <button key={k} type="button" className={mode === k ? "on" : undefined} onClick={() => { setMode(k); setModeN((x) => x + 1); setHv(null); }}>{k === "cat" ? "카테고리" : "담당자"}</button>
              ))}
            </div>
            <span className="st-od">× 상태</span>
          </div>
          <div className="st-mxw">
            <div className="st-grid6">
              <span />
              {ST.map((s, ci) => <span key={s.k} className="st-ch" style={{ color: hv?.c === ci ? "var(--ink)" : undefined, fontWeight: hv?.c === ci ? 700 : 600 }}><i style={{ background: s.color }} />{s.label}</span>)}
              <span className="st-ch l">합계</span>
              {rows.map((r, ri) => {
                const tot = r.v.reduce((a, x) => a + x, 0), rowHv = hv?.r === ri;
                return [
                  <span key={`l${ri}`} className="st-rl2" style={{ background: rowHv ? "var(--panel2)" : undefined, fontWeight: rowHv ? 700 : 500, color: rowHv || tot ? "var(--ink)" : "var(--faint)", opacity: tot ? 1 : 0.45 }}>{r.label}</span>,
                  ...r.v.map((n, ci) => {
                    const on = hv?.r === ri && hv?.c === ci, cross = hv && (hv.r === ri || hv.c === ci);
                    const pct = n ? 14 + Math.round((n / maxCell) * 44) : 0;
                    return (
                      <Link key={`c${ri}-${ci}-${modeN}`} href="/v3/tasks" className="st-cell tn"
                            onMouseEnter={() => setHv({ r: ri, c: ci })} onMouseLeave={() => setHv(null)}
                            style={{ color: n ? (pct > 40 ? "#fff" : "var(--ink)") : "var(--faint)",
                              background: n ? `color-mix(in oklch, ${ST[ci].color} ${pct}%, var(--panel2))` : cross ? "var(--panel2)" : "transparent",
                              boxShadow: on ? "inset 0 0 0 2px var(--ink)" : "none", pointerEvents: n ? "auto" : "none", opacity: tot ? 1 : 0.45,
                              animation: `${mx} .4s cubic-bezier(.2,.8,.2,1) ${(0.2 + (ri + ci) * 0.035).toFixed(3)}s backwards` }}>{n || "·"}</Link>
                    );
                  }),
                  <div key={`t${ri}`} className="st-tot" style={{ background: rowHv ? "var(--panel2)" : undefined, opacity: tot ? 1 : 0.45 }}>
                    <b className="tn">{tot}</b><span><i style={{ width: mounted ? `${(tot / maxTot) * 100}%` : "0%" }} /></span>
                  </div>,
                ];
              })}
              <span className="st-ft l">합계</span>
              {colSum.map((n, i) => <span key={i} className="st-ft tn">{n}</span>)}
              <span className="st-ft g tn">{grand}</span>
            </div>
          </div>
        </section>

        <section className="st-card q" style={{ animationDelay: ".35s", gap: 12 }}>
          <div className="st-ldh"><span className="st-t">담당자 부하</span><span className="st-cap"><i />적정 {CAP}건</span></div>
          <div className="st-loads">
            {data.load.map((l, i) => {
              const tot = l.v.reduce((a, x) => a + x, 0);
              return (
                <div key={l.name} className="st-ld" style={{ opacity: tot ? 1 : 0.45, animationDelay: `${(0.35 + i * 0.06).toFixed(2)}s` }}>
                  <span className="nm">{l.name}</span>
                  <div className="tr">
                    <div>{l.v.map((n, k) => n > 0 && <i key={k} style={{ width: mounted ? `${(n / LMAX) * 100}%` : "0%", background: LOAD_COLOR[k], transitionDelay: `${(0.35 + i * 0.06).toFixed(2)}s` }} />)}</div>
                    <em style={{ left: `${(CAP / LMAX) * 100}%` }} />
                  </div>
                  <b className="tn" style={{ color: tot ? "var(--ink)" : "var(--faint)" }}>{tot}</b>
                </div>
              );
            })}
          </div>
          <div className="st-lg2">{["지남", "진행", "검토", "시작 전"].map((label, k) => <span key={label}><i style={{ background: LOAD_COLOR[k] }} />{label}</span>)}</div>
        </section>
      </div>
    </div>
  );
}
