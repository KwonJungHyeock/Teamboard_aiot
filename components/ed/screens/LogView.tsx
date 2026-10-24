"use client";

// 업무일지 — 하루 한 줄 기록 + 월 히트맵 + 카테고리 분포 (DESIGN.md 5.4 · my-log.dc.html).
//   · 등록창: 한 줄 + Enter(조합 중 무시) · `#카테고리` · ⌁ 파일(붙여넣기도) · ··· 카테고리/날짜(오늘·어제·그제)
//   · 스트림: 날짜 머리(sticky) · 시간 · 점 · 내용 · 「완료」(내가 끝낸 업무, 자동) · 파일 칩 · hover ✕
//   · 오른쪽: 월 히트맵(누르면 그날만) · 카테고리 분포(누르면 그 카테고리만) · 이 달 정리 복사
// 기록은 나만 본다 — `/api/worklog` 가 쓴 사람 것만 돌려준다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { addDays, catColor, isEnter, todayKst, weekday } from "@/lib/ed/core";
import { blobSrc } from "@/lib/upload";
import { usePop, useToast } from "../ui";

interface FileRef { pathname: string; name: string; size: number; contentType: string }
interface Entry { id: number; loggedOn: string; body: string; categoryId: number | null; taskId: number | null; attachments: FileRef[]; createdAt: string }
interface Category { id: number; name: string; color: string; count: number }
interface Done { id: number; title: string; areaName: string; completedAt: string; loggedOn: string }
interface Row { key: string; id: number | null; day: string; time: string; text: string; cat: string; color: string; done: boolean; files: FileRef[]; sort: string }

const WK = ["일", "월", "화", "수", "목", "금", "토"];
const DATE_OPTS: [string, number][] = [["오늘", 0], ["어제", -1], ["그제", -2]];
const EXT_TYPE: Record<string, string> = {
  hwp: "application/x-hwp", hwpx: "application/vnd.hancom.hwpx", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", txt: "text/plain", csv: "text/csv", md: "text/markdown", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
const typeOf = (f: File) => f.type || EXT_TYPE[(f.name.split(".").pop() ?? "").toLowerCase()] || "application/octet-stream";
const hhmm = (iso: string) => {
  const t = Date.parse(iso.replace(" ", "T").replace(/\+00(:00)?$/, "Z"));
  return Number.isNaN(t) ? "" : new Date(t + 9 * 3600 * 1000).toISOString().slice(11, 16);
};
const shiftMonth = (m: string, d: number) => {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
};
/** 카테고리 색 — 팀 카테고리 이름이면 시안 색, 아니면 그 카테고리에 저장된 색 */
const colorOf = (name: string, own?: string) => (catColor(name) !== "var(--sub)" ? catColor(name) : own ?? "var(--sub)");

export default function LogView({ meId }: { meId: number }) {
  const today = todayKst();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [done, setDone] = useState<Done[]>([]);
  const [text, setText] = useState("");
  const [catPick, setCatPick] = useState<string | null>(null);
  const [dateOff, setDateOff] = useState(0);
  const [file, setFile] = useState<{ name: string; ref?: FileRef; up: boolean } | null>(null);
  const [fDay, setFDay] = useState<string | null>(null);
  const [fCat, setFCat] = useState<string | null>(null);
  const [leaving, setLeaving] = useState<number[]>([]);
  const [newId, setNewId] = useState<number | null>(null);
  const [pulse, setPulse] = useState<Record<string, number>>({});
  const [copied, setCopied] = useState(false);
  const [intro, setIntro] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen, popRef] = usePop<"opts">();
  const [toast, show] = useToast();
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async (m: string) => {
    const r = await fetch(`/api/ed/log?month=${m}`, { cache: "no-store" }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { show(d.error ?? "불러오지 못했습니다"); setEntries([]); return; }
    setEntries(d.entries); setCats(d.categories); setDone(d.done ?? []);
  }, [show]);
  useEffect(() => { void load(month); }, [month, load]);
  useEffect(() => { const t = setTimeout(() => setIntro(false), 1400); return () => clearTimeout(t); }, []);

  const catById = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const e of entries ?? []) {
      const c = e.categoryId ? catById.get(e.categoryId) : undefined;
      const name = c?.name ?? "기타";
      out.push({ key: `w${e.id}`, id: e.id, day: e.loggedOn, time: hhmm(e.createdAt), text: e.body || e.attachments[0]?.name || "", cat: name,
        color: colorOf(name, c?.color), done: false, files: e.attachments, sort: e.createdAt });
    }
    for (const t of done) {
      out.push({ key: `t${t.id}`, id: null, day: t.loggedOn, time: hhmm(t.completedAt), text: t.title, cat: t.areaName, color: colorOf(t.areaName), done: true, files: [], sort: t.completedAt });
    }
    return out;
  }, [entries, done, catById]);

  const shown = rows.filter((r) => (!fDay || r.day === fDay) && (!fCat || r.cat === fCat));
  const days = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of shown) m.set(r.day, [...(m.get(r.day) ?? []), r]);
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]))
      .map(([d, xs]) => [d, xs.sort((a, b) => b.time.localeCompare(a.time) || b.sort.localeCompare(a.sort))] as const);
  }, [shown]);

  // 히트맵
  const [y, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1)).getUTCDay();
  const dim = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const countBy = useMemo(() => { const c: Record<string, number> = {}; rows.forEach((r) => { c[r.day] = (c[r.day] ?? 0) + 1; }); return c; }, [rows]);
  // 카테고리 분포 — 이름으로 묶는다(내 기록 카테고리 + 끝낸 업무의 영역)
  const catCount = useMemo(() => {
    const m = new Map<string, { label: string; color: string; count: number }>();
    for (const r of rows) { const x = m.get(r.cat) ?? { label: r.cat, color: r.color, count: 0 }; x.count++; m.set(r.cat, x); }
    return Array.from(m.values()).sort((a, b) => b.count - a.count);
  }, [rows]);

  // 등록창 — `#이름` 이 고른 카테고리보다 앞선다
  const tag = (text.match(/(^|\s)#(\S+)/) ?? [])[2] ?? null;
  const optCats = useMemo(() => {
    const names = new Map<string, string>();
    cats.forEach((c) => names.set(c.name, colorOf(c.name, c.color)));
    ["R&D", "플랫폼", "교육자료", "디자인", "연구소", "현장실습교육"].forEach((n) => { if (!names.has(n)) names.set(n, catColor(n)); });
    return Array.from(names.entries());
  }, [cats]);
  const tagMatch = tag ? optCats.find(([n]) => n === tag || n.startsWith(tag))?.[0] ?? tag : null;
  // 고른 것이 없으면 이 달 가장 많이 쓴 카테고리가 기본(시안: 토큰으로 보인다)
  const topCat = useMemo(() => {
    const n = new Map<string, number>();
    (entries ?? []).forEach((e) => { const c = e.categoryId ? catById.get(e.categoryId)?.name : null; if (c) n.set(c, (n.get(c) ?? 0) + 1); });
    return Array.from(n.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [entries, catById]);
  const effCat = tagMatch ?? catPick ?? topCat;
  const clean = text.replace(/(^|\s)#\S+/g, " ").replace(/\s+/g, " ").trim();
  const ready = (!!clean || !!file?.ref) && !file?.up && !busy;

  const upload = (f: File) => {
    const name = f.name || "붙여넣은 이미지";
    setFile({ name, up: true });
    const qs = new URLSearchParams({ kind: "worklog", id: String(meId), name });
    fetch(`/api/blob/upload?${qs}`, { method: "POST", headers: { "content-type": typeOf(f) }, body: f })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "올리지 못했습니다");
        setFile({ name, up: false, ref: { pathname: d.pathname, name: d.name ?? name, size: d.size ?? f.size, contentType: d.contentType ?? typeOf(f) } });
      })
      .catch((e: Error) => { setFile(null); show(e.message); });
  };

  const add = async () => {
    if (!ready) return;
    setBusy(true);
    const existing = effCat ? cats.find((c) => c.name === effCat) : undefined;
    const body = existing || !effCat ? clean : `${clean} #${effCat}`;
    const loggedOn = addDays(today, dateOff);
    const r = await fetch("/api/worklog", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, categoryId: existing?.id ?? null, loggedOn, attachments: file?.ref ? [file.ref] : [] }),
    }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) { show(d.error ?? "기록하지 못했습니다"); return; }
    setText(""); setFile(null); setDateOff(0); setOpen(null);
    setNewId(d.entry.id);
    setPulse((p) => ({ ...p, [d.entry.loggedOn]: (p[d.entry.loggedOn] ?? 0) + 1 }));
    window.dispatchEvent(new Event("ed:changed"));
    if (d.entry.loggedOn.slice(0, 7) !== month) setMonth(d.entry.loggedOn.slice(0, 7)); else await load(month);
    input.current?.focus();
  };

  const remove = async (id: number) => {
    setLeaving((l) => [...l, id]);
    const r = await fetch(`/api/worklog/${id}`, { method: "DELETE" }).catch(() => null);
    setTimeout(async () => {
      if (r?.ok) setEntries((es) => (es ?? []).filter((e) => e.id !== id));
      else show("지우지 못했습니다");
      setLeaving((l) => l.filter((x) => x !== id));
    }, 450);
  };

  const copy = async () => {
    const lines = [`${mo}월 기록`];
    for (const c of catCount) {
      const es = rows.filter((r) => r.cat === c.label).sort((a, b) => a.day.localeCompare(b.day));
      lines.push("", `## ${c.label}`);
      es.forEach((e) => lines.push(`- ${mo}.${e.day.slice(8)} ${e.text}${e.done ? " (완료)" : ""}`));
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { show("복사하지 못했습니다"); }
  };

  const isCur = month === today.slice(0, 7);
  const dateLabel = DATE_OPTS.find(([, v]) => v === dateOff)?.[0];

  return (
    <div className="log-page">
      <div className="log-head">
        <div className="l">
          <h1 className="ed-h1">업무일지</h1>
          <div className="log-mon">
            <button type="button" onClick={() => { setMonth(shiftMonth(month, -1)); setFDay(null); }} aria-label="이전 달">‹</button>
            <span className="tn">{y}년 {mo}월</span>
            <button type="button" onClick={() => { setMonth(shiftMonth(month, 1)); setFDay(null); }} aria-label="다음 달">›</button>
          </div>
        </div>
        <Link href={`/v3/report?m=${month}`} className="log-rep">월간 보고 →</Link>
      </div>

      <div className="log-comp" ref={popRef}>
        <span className="plus">+</span>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="오늘 한 일 한 줄 · Enter" aria-label="오늘 한 일"
               onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void add(); } }}
               onPaste={(e) => { const f = e.clipboardData?.files?.[0]; if (f) { e.preventDefault(); upload(f); } }} />
        <div className="toks">
          {effCat && <span className={`tkn${tagMatch ? " acc" : ""}`}><i style={{ background: optCats.find(([n]) => n === effCat)?.[1] ?? "var(--sub)" }} />{effCat}</span>}
          {dateOff !== 0 && <span className="tkn amb">{dateLabel}</span>}
          {file && <span className="tkn">⌁ {file.up ? "올리는 중" : file.name}<button type="button" onClick={() => setFile(null)} aria-label="파일 빼기">✕</button></span>}
        </div>
        <label className="ico" title="파일">⌁<input type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} /></label>
        <div className="ed-rel">
          <button type="button" className={`ico${open === "opts" ? " on" : ""}`} title="옵션" onClick={() => setOpen(open === "opts" ? null : "opts")}>···</button>
          {open === "opts" && (
            <div className="ed-optpop" style={{ width: 320 }}>
              <div className="og"><span>카테고리</span><div>
                {optCats.map(([n, col]) => (
                  <button key={n} type="button" className={effCat === n ? "on" : undefined} onClick={() => setCatPick(catPick === n ? null : n)}><i style={{ background: col }} />{n}</button>
                ))}
              </div></div>
              <div className="og"><span>날짜</span><div>
                {DATE_OPTS.map(([l, v]) => <button key={l} type="button" className={dateOff === v ? "on" : undefined} onClick={() => setDateOff(v)}>{l}</button>)}
              </div></div>
            </div>
          )}
        </div>
        <button type="button" className={`go${ready ? "" : " off"}`} onClick={() => void add()} disabled={!ready}>기록</button>
      </div>

      <div className="log-grid">
        <section className="log-stream">
          {(fDay || fCat) && (
            <div className="log-filt">
              {fDay && <button type="button" onClick={() => setFDay(null)}>{mo}월 {Number(fDay.slice(8))}일<span>✕</span></button>}
              {fCat && <button type="button" onClick={() => setFCat(null)}>{fCat}<span>✕</span></button>}
            </div>
          )}
          <div className="log-scroll ed-scroll">
            {entries === null ? null : days.length === 0 ? <div className="log-empty">기록 없음</div> : days.map(([d, items], gi) => {
              const isToday = d === today;
              return (
                <div key={d} className={intro ? "log-day in" : "log-day"} style={intro ? { animationDelay: `${(0.15 + gi * 0.05).toFixed(2)}s` } : undefined}>
                  <div className="log-dh"><span className={isToday ? "t" : undefined}>{Number(d.slice(8))}일({isToday ? "오늘" : WK[weekday(d)]})</span><small className="tn">{items.length}줄</small></div>
                  <div className="log-rows">
                    <i className="rail" />
                    {items.map((e) => (
                      <div key={e.key} className={`log-row${e.id && leaving.includes(e.id) ? " lv" : ""}${e.id === newId ? " nw" : ""}`}>
                        <span className="tm tn">{e.time}</span>
                        <span className="pt" style={{ background: e.color }} />
                        <div className="tx">
                          <span>{e.text}</span>
                          {e.done && <em className="dn">완료</em>}
                          {e.files.map((f) => <a key={f.pathname} className="fl" href={blobSrc(f.pathname)} target="_blank" rel="noreferrer">⌁ {f.name}</a>)}
                        </div>
                        <span className="ct">{e.cat}</span>
                        {e.id !== null && <button type="button" className="rm" onClick={() => void remove(e.id!)} aria-label="기록 삭제">✕</button>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="log-side ed-scroll">
          <section className="log-card q1">
            <div className="log-ch"><b>{mo}월</b><small className="tn">{rows.length}줄 · {Object.keys(countBy).length}일</small></div>
            <div className="log-heat">
              {WK.map((w) => <span key={w} className="wh">{w}</span>)}
              {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
              {Array.from({ length: dim }, (_, k) => {
                const dd = k + 1;
                const iso = `${month}-${String(dd).padStart(2, "0")}`;
                const c = countBy[iso] ?? 0;
                const lvl = c === 0 ? 0 : c === 1 ? 22 : c === 2 ? 38 : 58;
                const isToday = isCur && iso === today;
                const future = iso > today;
                const anim = pulse[iso] ? `cell${pulse[iso] % 2 ? "A" : "B"} .5s var(--ease)` : intro ? `cellIn .35s var(--ease) ${(0.2 + k * 0.012).toFixed(3)}s backwards` : undefined;
                return (
                  <button key={iso} type="button" title={c ? `${dd}일 · ${c}줄` : undefined} className={`hc${c ? " has" : ""}`}
                          onClick={() => { if (c) setFDay(fDay === iso ? null : iso); }}
                          style={{
                            background: lvl ? `color-mix(in oklch, var(--accent) ${lvl}%, var(--panel2))` : "var(--panel2)",
                            color: lvl >= 38 ? "#fff" : isToday ? "var(--accent)" : "var(--sub)",
                            boxShadow: fDay === iso ? "inset 0 0 0 2px var(--ink)" : isToday ? "inset 0 0 0 1.5px var(--accent)" : "none",
                            opacity: future ? 0.45 : 1, animation: anim,
                          }}>{dd}</button>
                );
              })}
            </div>
          </section>

          <section className="log-card q2 cat">
            <b className="t">카테고리</b>
            <div className="log-bar">{catCount.map((c) => <span key={c.label} style={{ flexGrow: c.count, background: c.color }} />)}</div>
            <div className="log-cats">
              {catCount.length === 0 ? <div className="ed-empty">비어 있음</div> : catCount.map((c) => (
                <button key={c.label} type="button" className={fCat === c.label ? "on" : undefined} onClick={() => setFCat(fCat === c.label ? null : c.label)}>
                  <i style={{ background: c.color }} /><span>{c.label}</span><b className="tn">{c.count}</b>
                </button>
              ))}
            </div>
          </section>

          <button type="button" className={`log-copy q3${copied ? " ok" : ""}`} onClick={() => void copy()}>{copied ? "복사됨 ✓" : "이 달 정리 복사"}</button>
        </aside>
      </div>
      {toast}
    </div>
  );
}
