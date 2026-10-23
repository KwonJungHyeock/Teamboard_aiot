"use client";

// 내 기록 — 한 줄 쓰고, 붙여넣고, 엔터 (0037 · 2026-10 업무기록).
//
// ── 「일하는 시간을 뺏지 않는다」가 첫째다 ───────────────────────
//
//   · 입력칸 **하나.** 제목 · 본문 · 분류 칸을 따로 두지 않는다
//   · 엔터 = 저장. 줄바꿈은 Shift+엔터
//   · `#이름` 을 치면 그 카테고리로 간다(없으면 생긴다 — 서버 `lib/worklog.ts`)
//   · 이미지·파일은 붙여넣기 · 끌어다 놓기 · 버튼 셋 다 된다. 올라가는 동안에도 계속 쓴다
//   · 날짜는 오늘이 기본. 어제 일이면 날짜 칸만 바꾼다
//
// ── 남에게는 안 보인다 ──────────────────────────────────────────
// API 가 쓴 사람 것만 돌려준다. 팀장도 못 본다. 팀에 내는 것은 사람이 「정리 복사」로
// 골라 보낼 때뿐이다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blobSrc, type UploadedImage } from "@/lib/upload";
import { Card, Button } from "./parts";

interface FileRef { pathname: string; name: string; size: number; contentType: string }
interface Entry {
  id: number; loggedOn: string; body: string; categoryId: number | null;
  attachments: FileRef[]; createdAt: string;
}
interface Category { id: number; name: string; color: string; count: number }
interface Pending { key: number; name: string; local: string | null; state: "up" | "ok" | "bad"; why?: string; file?: FileRef }

/** 브라우저가 형식을 비워 보내는 파일(한글 · 일부 오피스) — 확장자로 채운다 */
const EXT_TYPE: Record<string, string> = {
  hwp: "application/x-hwp", hwpx: "application/vnd.hancom.hwpx", pdf: "application/pdf",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip", txt: "text/plain", csv: "text/csv", md: "text/markdown",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
};
function typeOf(f: File): string {
  if (f.type) return f.type;
  const ext = (f.name.split(".").pop() ?? "").toLowerCase();
  return EXT_TYPE[ext] ?? "application/octet-stream";
}
const isImage = (t: string) => t.startsWith("image/");

function today(): string {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return k.toISOString().slice(0, 10);
}
function shiftMonth(m: string, d: number): string {
  const [y, mo] = m.split("-").map(Number);
  const t = new Date(Date.UTC(y, mo - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function dayLabel(d: string): string {
  const t = today();
  const y = new Date(Date.parse(`${t}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const w = WEEK[new Date(`${d}T00:00:00Z`).getUTCDay()];
  if (d === t) return `오늘 · ${d.slice(5)} (${w})`;
  if (d === y) return `어제 · ${d.slice(5)} (${w})`;
  return `${d.slice(5)} (${w})`;
}
/** 적은 시각 — 서울 HH:MM */
function hhmm(createdAt: string): string {
  const t = Date.parse(createdAt.replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(t)) return "";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(11, 16);
}
function kb(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

export default function WorklogView({ me }: { me: { id: number; name: string } }) {
  const [month, setMonth] = useState<string>(today().slice(0, 7));
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [day, setDay] = useState(today());
  const [catId, setCatId] = useState<number | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<number | "none" | null>(null);
  const [newCat, setNewCat] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: number; body: string } | null>(null);
  const [drag, setDrag] = useState(false);
  const [note, setNote] = useState("");
  const keyRef = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);

  const load = useCallback(async (m: string) => {
    setErr("");
    const r = await fetch(`/api/worklog?month=${m}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(d.error ?? `불러오지 못했습니다 (${r.status})`); setEntries([]); return; }
    setEntries(d.entries); setCats(d.categories);
  }, []);
  useEffect(() => { setEntries(null); void load(month); }, [month, load]);

  // 잠깐 뜨는 안내 — 저장 · 복사 · 실패. 3초 뒤 사라진다.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(""), 3000);
    return () => clearTimeout(t);
  }, [note]);

  /* ── 올리기 — 고르자마자 올라간다. 저장은 기다리지 않는다 ─────── */
  const upload = useCallback((files: File[]) => {
    for (const f of files.slice(0, 10)) {
      const key = ++keyRef.current;
      const type = typeOf(f);
      const local = isImage(type) ? URL.createObjectURL(f) : null;
      setPending((p) => [...p, { key, name: f.name || "file", local, state: "up" }]);
      const qs = new URLSearchParams({ kind: "worklog", id: String(me.id), name: f.name || "file" });
      fetch(`/api/blob/upload?${qs}`, { method: "POST", headers: { "content-type": type }, body: f })
        .then(async (r) => {
          const d = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(d.error ?? `올리지 못했습니다 (${r.status})`);
          const up = d as UploadedImage;
          setPending((p) => p.map((x) => (x.key === key ? { ...x, state: "ok", file: up } : x)));
        })
        .catch((e: Error) => setPending((p) => p.map((x) => (x.key === key ? { ...x, state: "bad", why: e.message } : x))));
    }
  }, [me.id]);
  const dropPending = (key: number) => setPending((p) => {
    const x = p.find((y) => y.key === key);
    if (x?.local) URL.revokeObjectURL(x.local);
    return p.filter((y) => y.key !== key);
  });

  const uploading = pending.some((p) => p.state === "up");
  const ready = pending.filter((p) => p.state === "ok" && p.file).map((p) => p.file as FileRef);

  const save = async () => {
    if (busy || uploading) return;
    if (!text.trim() && ready.length === 0) { input.current?.focus(); return; }
    setBusy(true);
    const r = await fetch("/api/worklog", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text, categoryId: catId, loggedOn: day, attachments: ready }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setNote(d.error ?? `기록하지 못했습니다 (${r.status})`); return; }
    pending.forEach((p) => p.local && URL.revokeObjectURL(p.local));
    setText(""); setPending([]);
    setNote(`기록했습니다${ready.length ? ` · 첨부 ${ready.length}` : ""}`);
    if (d.entry.loggedOn.slice(0, 7) !== month) setMonth(d.entry.loggedOn.slice(0, 7));
    else await load(month);
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중의 엔터는 글자를 끝내는 엔터다 — 저장하면 마지막 글자가 잘린다.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length) { e.preventDefault(); upload(files); }
  };

  const addCat = async () => {
    const name = (newCat ?? "").trim();
    if (!name) { setNewCat(null); return; }
    const r = await fetch("/api/worklog/categories", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setNote(d.error ?? "만들지 못했습니다"); return; }
    setNewCat(null); setCatId(d.category.id);
    await load(month);
  };
  const hideCat = async (c: Category) => {
    if (!window.confirm(`「${c.name}」 카테고리를 숨길까요? 그 기록 ${c.count}줄은 「분류 없음」으로 남습니다.`)) return;
    const r = await fetch(`/api/worklog/categories/${c.id}`, { method: "DELETE" });
    if (!r.ok) { setNote("숨기지 못했습니다"); return; }
    if (catId === c.id) setCatId(null);
    if (filter === c.id) setFilter(null);
    await load(month);
  };

  const saveEdit = async () => {
    if (!editing) return;
    const r = await fetch(`/api/worklog/${editing.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: editing.body }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setNote(d.error ?? "고치지 못했습니다"); return; }
    setEditing(null);
    await load(month);
  };
  const remove = async (e: Entry) => {
    if (!window.confirm("이 기록을 지울까요?")) return;
    const r = await fetch(`/api/worklog/${e.id}`, { method: "DELETE" });
    if (!r.ok) { setNote("지우지 못했습니다"); return; }
    await load(month);
  };

  const catOf = useMemo(() => new Map(cats.map((c) => [c.id, c])), [cats]);
  const shown = useMemo(() => (entries ?? []).filter((e) =>
    filter === null ? true : filter === "none" ? e.categoryId === null : e.categoryId === filter), [entries, filter]);
  const days = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of shown) m.set(e.loggedOn, [...(m.get(e.loggedOn) ?? []), e]);
    return Array.from(m.entries());
  }, [shown]);
  const total = entries?.length ?? 0;
  const files = (entries ?? []).reduce((a, e) => a + e.attachments.length, 0);
  const imgs = (entries ?? []).reduce((a, e) => a + e.attachments.filter((f) => isImage(f.contentType)).length, 0);
  const uncategorized = (entries ?? []).filter((e) => e.categoryId === null).length;
  const maxCount = Math.max(1, ...cats.map((c) => c.count), uncategorized);
  const [y, mo] = month.split("-");

  /** 이 달을 카테고리별로 묶어 글로 — 월간 보고에 그대로 붙인다 */
  const copyMonth = async () => {
    const groups = [...cats.filter((c) => c.count > 0).map((c) => ({ name: c.name, id: c.id as number | null })),
      ...(uncategorized ? [{ name: "분류 없음", id: null }] : [])];
    const lines = [`# ${me.name} · ${Number(y)}년 ${Number(mo)}월 업무기록 (${total}줄)`, ""];
    for (const g of groups) {
      const es = (entries ?? []).filter((e) => e.categoryId === g.id).slice().reverse();
      lines.push(`## ${g.name} (${es.length})`);
      for (const e of es) lines.push(`- ${e.loggedOn.slice(5)} ${e.body}${e.attachments.length ? ` [첨부 ${e.attachments.length}]` : ""}`);
      lines.push("");
    }
    try { await navigator.clipboard.writeText(lines.join("\n")); setNote("이 달 정리를 복사했습니다 — 보고서에 붙여넣으세요"); }
    catch { setNote("복사하지 못했습니다 — 브라우저가 막았습니다"); }
  };

  return (
    <div className="v3-log">
      <h1 className="v3-h1">내 기록</h1>
      <p className="v3-lede">
        {Number(y)}년 {Number(mo)}월 · {total}줄 · 이미지 {imgs} · 파일 {files - imgs} — 나만 봅니다
      </p>

      {/* ── 한 줄 기록 ─────────────────────────────────────────── */}
      <Card className={`v3-log-cap${drag ? " drag" : ""}`}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); upload(Array.from(e.dataTransfer.files ?? [])); }}>
        <div className="v3-log-row">
          <textarea ref={input} className="v3-log-in" rows={1} value={text} autoFocus
                    aria-label="오늘 한 일 한 줄"
                    placeholder="오늘 한 일 한 줄 — #카테고리 · 이미지는 붙여넣기(⌘V)나 끌어다 놓기"
                    onChange={(e) => setText(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
          <input type="date" className="v3-log-day" aria-label="한 날" value={day} max={today()}
                 onChange={(e) => setDay(e.target.value || today())} />
          <Button type="button" onClick={() => fileIn.current?.click()}>＋ 이미지·파일</Button>
          <input ref={fileIn} type="file" multiple hidden
                 onChange={(e) => { upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
          <Button primary type="button" onClick={() => void save()} disabled={busy || uploading}
                  title={uploading ? "올라가는 중 — 끝나면 저장됩니다" : "엔터로도 저장됩니다"}>
            {uploading ? "올리는 중…" : "기록 ↵"}
          </Button>
        </div>

        {pending.length > 0 && (
          <ul className="v3-log-pend" aria-label="올리는 파일">
            {pending.map((p) => (
              <li key={p.key} className={`v3-log-pf ${p.state}`}>
                {p.local ? <img src={p.local} alt="" /> : <span className="v3-log-fi" aria-hidden="true">📄</span>}
                <span className="v3-log-pn">
                  <b>{p.name}</b>
                  <em>{p.state === "up" ? "올리는 중…" : p.state === "ok" ? "올라감" : p.why}</em>
                </span>
                <button type="button" className="v3-log-x" aria-label={`${p.name} 빼기`} onClick={() => dropPending(p.key)}>×</button>
              </li>
            ))}
          </ul>
        )}

        <div className="v3-log-cats" role="group" aria-label="카테고리 고르기">
          <button type="button" className={`v3-log-chip${catId === null ? " on" : ""}`} aria-pressed={catId === null}
                  onClick={() => setCatId(null)}>분류 없음</button>
          {cats.map((c) => (
            <button key={c.id} type="button" className={`v3-log-chip${catId === c.id ? " on" : ""}`}
                    aria-pressed={catId === c.id} style={{ ["--c" as string]: c.color }}
                    onClick={() => setCatId(c.id)}>#{c.name}</button>
          ))}
          {newCat === null ? (
            <button type="button" className="v3-log-chip add" onClick={() => setNewCat("")}>＋ 새 카테고리</button>
          ) : (
            <input className="v3-log-newcat" autoFocus value={newCat} maxLength={30} placeholder="이름 · 엔터"
                   aria-label="새 카테고리 이름"
                   onChange={(e) => setNewCat(e.target.value)}
                   onKeyDown={(e) => {
                     if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void addCat(); }
                     if (e.key === "Escape") setNewCat(null);
                   }}
                   onBlur={() => void addCat()} />
          )}
          <span className="v3-log-hint">엔터 저장 · Shift+엔터 줄바꿈 · 4MB까지</span>
        </div>
      </Card>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      <div className="v3-log-grid">
        {/* ── 카테고리 거르개 ─────────────────────────────────────── */}
        <Card title="내 카테고리" className="v3-log-side">
          <div className="v3-log-filters" role="group" aria-label="카테고리로 거르기">
            <button type="button" className={`v3-log-f${filter === null ? " on" : ""}`} aria-pressed={filter === null}
                    onClick={() => setFilter(null)}>
              <span>전체</span><b>{total}</b>
            </button>
            {cats.map((c) => (
              <div key={c.id} className="v3-log-frow">
                <button type="button" className={`v3-log-f${filter === c.id ? " on" : ""}`} aria-pressed={filter === c.id}
                        onClick={() => setFilter(filter === c.id ? null : c.id)}>
                  <i style={{ background: c.color }} aria-hidden="true" /><span>{c.name}</span><b>{c.count}</b>
                </button>
                <button type="button" className="v3-log-hide" aria-label={`${c.name} 숨기기`} title="숨기기"
                        onClick={() => void hideCat(c)}>×</button>
              </div>
            ))}
            {uncategorized > 0 && (
              <button type="button" className={`v3-log-f${filter === "none" ? " on" : ""}`} aria-pressed={filter === "none"}
                      onClick={() => setFilter(filter === "none" ? null : "none")}>
                <i aria-hidden="true" /><span>분류 없음</span><b>{uncategorized}</b>
              </button>
            )}
          </div>
        </Card>

        {/* ── 기록 ─────────────────────────────────────────────────── */}
        <Card className="v3-log-list">
          <div className="v3-log-month">
            <Button type="button" className="v3-btn-s" aria-label="지난달" onClick={() => setMonth(shiftMonth(month, -1))}>‹</Button>
            <b>{Number(y)}년 {Number(mo)}월</b>
            <Button type="button" className="v3-btn-s" aria-label="다음 달" disabled={month >= today().slice(0, 7)}
                    onClick={() => setMonth(shiftMonth(month, 1))}>›</Button>
          </div>
          {entries === null ? <p className="v3-loading">불러오는 중…</p>
            : days.length === 0 ? (
              <div className="v3-empty">
                <b>{filter === null ? "이 달 기록이 아직 없어요" : "이 카테고리 기록이 없어요"}</b>
                <p>위 칸에 한 줄 쓰고 엔터를 누르면 여기 쌓입니다.</p>
              </div>
            ) : days.map(([d, es]) => (
              <section key={d} className="v3-log-day-g" aria-label={dayLabel(d)}>
                <h3>{dayLabel(d)}</h3>
                {es.map((e) => {
                  const c = e.categoryId ? catOf.get(e.categoryId) : undefined;
                  return (
                    <article key={e.id} className="v3-log-e">
                      <span className="v3-log-t">{hhmm(e.createdAt)}</span>
                      <div className="v3-log-b">
                        {editing?.id === e.id ? (
                          <div className="v3-log-edit">
                            <textarea className="v3-log-in" rows={2} autoFocus value={editing.body} aria-label="기록 고치기"
                                      onChange={(ev) => setEditing({ id: e.id, body: ev.target.value })}
                                      onKeyDown={(ev) => {
                                        if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); void saveEdit(); }
                                        if (ev.key === "Escape") setEditing(null);
                                      }} />
                            <Button primary type="button" className="v3-btn-s" onClick={() => void saveEdit()}>저장</Button>
                            <Button type="button" className="v3-btn-s" onClick={() => setEditing(null)}>그만</Button>
                          </div>
                        ) : (
                          <p>
                            {c && <span className="v3-log-pill" style={{ ["--c" as string]: c.color }}>#{c.name}</span>}
                            {e.body}
                          </p>
                        )}
                        {e.attachments.length > 0 && (
                          <div className="v3-log-atts">
                            {e.attachments.map((f) => isImage(f.contentType) ? (
                              <a key={f.pathname} href={blobSrc(f.pathname)} target="_blank" rel="noreferrer" className="v3-log-img"
                                 title={f.name}>
                                <img src={blobSrc(f.pathname)} alt={f.name} loading="lazy" />
                              </a>
                            ) : (
                              <a key={f.pathname} href={blobSrc(f.pathname)} target="_blank" rel="noreferrer" className="v3-log-file">
                                📄 {f.name} <em>{kb(f.size)}</em>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                      {editing?.id !== e.id && (
                        <span className="v3-log-acts">
                          <button type="button" onClick={() => setEditing({ id: e.id, body: e.body })}>고치기</button>
                          <button type="button" onClick={() => void remove(e)}>지우기</button>
                        </span>
                      )}
                    </article>
                  );
                })}
              </section>
            ))}
        </Card>

        {/* ── 이 달 정리 ──────────────────────────────────────────── */}
        <Card title={`${Number(mo)}월 정리`} className="v3-log-sum">
          {cats.filter((c) => c.count > 0).map((c) => (
            <div key={c.id} className="v3-abar">
              <span className="v3-abar-l">{c.name}</span>
              <span className="v3-bar"><span style={{ width: `${(c.count / maxCount) * 100}%`, background: c.color }} /></span>
              <span className="v3-abar-n">{c.count}</span>
            </div>
          ))}
          {uncategorized > 0 && (
            <div className="v3-abar">
              <span className="v3-abar-l">분류 없음</span>
              <span className="v3-bar"><span style={{ width: `${(uncategorized / maxCount) * 100}%` }} /></span>
              <span className="v3-abar-n">{uncategorized}</span>
            </div>
          )}
          <Button primary type="button" className="v3-log-copy" disabled={total === 0} onClick={() => void copyMonth()}>
            이 달 정리 복사
          </Button>
          <p className="v3-log-why">카테고리별로 묶은 글이 복사됩니다. 월간 업무보고에 그대로 붙여넣으세요.</p>
        </Card>
      </div>

      {note && <div className="v3-toasts" role="status" aria-live="polite"><div className="v3-toast"><span className="v3-toast-t">{note}</span></div></div>}
    </div>
  );
}
