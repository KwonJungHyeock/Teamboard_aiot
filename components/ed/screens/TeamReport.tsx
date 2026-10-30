"use client";

// 팀 보고 상세 = 발표 화면 (2026-10-30 지시서 PART 3 · 4).
//   보기: 페이지(1600×900)를 차례로 — ① 목표 ② 한눈에 ③ 종합표 ④ 업무 상세 ⑤ 결정 · 요청 ⑥ 이슈(분기 · 연간) ⑦ 계획
//   발표: 한 장씩 풀스크린, ← → 로 넘기고 영상 · iframe 은 그 자리에서 재생. 빈 에셋 자리는 숨긴다
//   편집(팀장 · 작성중): 업무 넣기 · 설명 · 멘트 · 에셋 · 순서 · 결정/요청 · 이슈 · 계획 · 파트 순서
//   PDF: 같은 페이지를 이미지로 떠서 16:9 PDF. 확정하면 PDF 를 만들어 보관한다
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, useToast } from "../ui";
import { buildPages, fileUrl, PART_LABEL, statusWord, type Item, type Part, type ReportData } from "../report/Pages";
import { Fit, pagesToPdf, pdfName, saveBlob, sizeError, uploadReportFile, videoPosters, kindOfFile } from "../report/tools";

type Tab = "setup" | "pick" | "items" | "requests" | "issues" | "plans" | "tidy";

export default function TeamReport({ id }: { id: number }) {
  const router = useRouter();
  const [d, setD] = useState<ReportData | null>(null);
  const [err, setErr] = useState("");
  const [edit, setEdit] = useState(false);
  const [tab, setTab] = useState<Tab>("pick");
  const [sel, setSel] = useState<number | null>(null);
  const [show, setShow] = useState<number | null>(null);
  const [busy, setBusy] = useState("");
  const [exp, setExp] = useState<{ posters: Record<number, string> } | null>(null);
  const expBox = useRef<HTMLDivElement>(null);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try { setD(await api<ReportData>(`/api/team-reports/${id}`)); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "불러오지 못했습니다"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (d && !d.canEdit) setEdit(false); }, [d]);

  const pages = useMemo(() => (d ? buildPages(d, "view") : []), [d]);
  const showPages = useMemo(() => (d ? buildPages(d, "present") : []), [d]);

  // ── 발표 ──
  const shell = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (show === null) return;
    const on = (e: KeyboardEvent) => {
      if (["ArrowRight", "PageDown", " "].includes(e.key)) { e.preventDefault(); setShow((i) => Math.min((i ?? 0) + 1, showPages.length - 1)); }
      if (["ArrowLeft", "PageUp"].includes(e.key)) { e.preventDefault(); setShow((i) => Math.max((i ?? 0) - 1, 0)); }
      if (e.key === "Escape") setShow(null);
    };
    document.addEventListener("keydown", on);
    shell.current?.requestFullscreen?.().catch(() => {});
    return () => { document.removeEventListener("keydown", on); if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); };
  }, [show === null, showPages.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 쓰기 ──
  const call = async (url: string, method: string, body?: unknown) => {
    try { await api(url, { method, body }); await load(); return true; }
    catch (e) { showToast(e instanceof Error ? e.message : "저장하지 못했습니다"); return false; }
  };
  const row = (res: string, rid: number, body: Record<string, unknown>) => call(`/api/team-reports/rows/${res}/${rid}`, "PATCH", body);
  const drop = (res: string, rid: number) => call(`/api/team-reports/rows/${res}/${rid}`, "DELETE");
  const add = (res: string, body: Record<string, unknown>) => call(`/api/team-reports/${id}/${res}`, "POST", body);

  // ── PDF ──
  const makePdf = async (): Promise<Blob | null> => {
    if (!d) return null;
    setBusy("PDF 만드는 중");
    try {
      const posters = await videoPosters(d);
      setExp({ posters });
      await new Promise((r) => setTimeout(r, 300));
      const box = expBox.current!;
      await Promise.all(Array.from(box.querySelectorAll("img")).map((im) => im.decode().catch(() => {})));
      await document.fonts?.ready;
      const blob = await pagesToPdf(Array.from(box.querySelectorAll<HTMLElement>(".rp-page")), (i, n) => setBusy(`PDF 만드는 중 ${i}/${n}`));
      return blob;
    } catch (e) { showToast(e instanceof Error ? `PDF를 만들지 못했습니다 — ${e.message}` : "PDF를 만들지 못했습니다"); return null; }
    finally { setExp(null); setBusy(""); }
  };
  const downloadPdf = async () => { const b = await makePdf(); if (b && d) saveBlob(b, pdfName(d)); };
  const archivePdf = async () => {
    const b = await makePdf(); if (!b || !d) return;
    setBusy("PDF 보관 중");
    try {
      const path = await uploadReportFile(d.report.id, b, pdfName(d));
      await api(`/api/team-reports/${id}`, { method: "PATCH", body: { pdfPath: path } });
      showToast("확정 PDF 를 보관했습니다");
    } catch (e) { showToast(e instanceof Error ? `PDF 보관 실패 — ${e.message}` : "PDF 보관 실패"); }
    finally { setBusy(""); await load(); }
  };
  const finalize = async () => {
    if (!d) return;
    const warn = d.warnings.length ? `\n\n하위 보고: ${d.warnings.join(" · ")}` : "";
    if (!window.confirm(`「${d.report.title}」를 확정할까요?\n지금의 숫자를 굳히고 PDF 를 만들어 보관합니다.${warn}`)) return;
    if (!(await call(`/api/team-reports/${id}`, "PATCH", { status: "final" }))) return;
    setEdit(false);
    await new Promise((r) => setTimeout(r, 200));
    await archivePdf();
  };
  const reopen = async () => { if (window.confirm("확정을 해제할까요? 굳힌 숫자와 보관한 PDF 가 비워지고 다시 작성중이 됩니다.")) await call(`/api/team-reports/${id}`, "PATCH", { status: "draft" }); };
  const remove = async () => { if (window.confirm("이 보고를 지울까요?")) { if (await call(`/api/team-reports/${id}`, "DELETE")) router.push("/v3/reports"); } };

  if (err) return <div className="ed-page"><div className="ed-err">{err}</div><Link href="/v3/reports">보고 목록</Link></div>;
  if (!d) return <div className="ed-page"><div className="ed-empty">불러오는 중</div></div>;
  const r = d.report;
  const item = d.items.find((i) => i.id === sel) ?? null;

  return (
    <div className="ed-page trp">
      <div className="trp-top">
        <Link href="/v3/reports" className="ed-crumb">보고 /</Link>
        <h1 className="ed-h1">{r.title}</h1>
        <span className={`trp-st${r.status === "final" ? " final" : ""}`}>{r.status === "final" ? `확정 · ${r.finalizedBy ?? ""}` : "작성중"}</span>
        <button type="button" className="ed-btn pri" onClick={() => setShow(0)}>발표</button>
        <button type="button" className="ed-btn" disabled={!!busy} onClick={() => void downloadPdf()}>{busy || "PDF 내보내기"}</button>
        {r.pdfPath && <a className="ed-btn" href={fileUrl(r.pdfPath)} download={pdfName(d)}>확정 PDF</a>}
        {d.isLead && r.status === "final" && !r.pdfPath && <button type="button" className="ed-btn" disabled={!!busy} onClick={() => void archivePdf()}>PDF 보관 다시</button>}
        {d.canEdit && <button type="button" className={`ed-btn${edit ? " pri" : ""}`} onClick={() => setEdit(!edit)}>{edit ? "편집 닫기" : "편집"}</button>}
        {d.canEdit && <button type="button" className="ed-btn" disabled={!!busy} onClick={() => void finalize()}>확정</button>}
        {d.isLead && r.status === "final" && <button type="button" className="ed-btn gh" onClick={() => void reopen()}>확정 해제</button>}
        {d.canEdit && <button type="button" className="ed-btn gh red" onClick={() => void remove()}>지우기</button>}
      </div>
      {d.warnings.length > 0 && <div className="trp-warn">하위 보고가 확정되지 않았습니다 — {d.warnings.join(" · ")}. 작성은 되지만 확정은 모두 확정된 뒤에 됩니다.</div>}
      <div className={`trp-body${edit ? " edit" : ""}`}>
        <div className="trp-pages">
          {pages.map((p) => (
            <div key={p.key} style={{ display: "contents" }}>
              <div className="trp-pl">{p.label}</div>
              <Fit className={`${edit && p.itemId ? "pick" : ""}${edit && p.itemId === sel ? " on" : ""}`}
                   onClick={edit && p.itemId ? () => { setSel(p.itemId!); setTab("items"); } : undefined}>{p.node}</Fit>
            </div>
          ))}
        </div>
        {edit && d.canEdit && <Editor d={d} tab={tab} setTab={setTab} item={item} setSel={setSel} row={row} drop={drop} add={add} call={call} toast={showToast} />}
      </div>

      {show !== null && (
        <div className="trp-show" ref={shell} onClick={(e) => { if ((e.target as HTMLElement).classList.contains("trp-show")) setShow((i) => Math.min((i ?? 0) + 1, showPages.length - 1)); }}>
          {showPages[show] && <Fit fitHeight key={showPages[show].key}>{showPages[show].node}</Fit>}
          <div className="bar">
            <button type="button" onClick={() => setShow(Math.max(show - 1, 0))}>←</button>
            <span>{show + 1} / {showPages.length} · {showPages[show]?.label}</span>
            <button type="button" onClick={() => setShow(Math.min(show + 1, showPages.length - 1))}>→</button>
            <button type="button" onClick={() => setShow(null)}>닫기 Esc</button>
          </div>
        </div>
      )}
      {exp && (
        <div ref={expBox} aria-hidden="true" style={{ position: "fixed", left: -20000, top: 0, width: 1600, pointerEvents: "none" }}>
          {buildPages(d, "export", exp.posters).map((p) => <div key={p.key}>{p.node}</div>)}
        </div>
      )}
      {toast}
    </div>
  );
}

// ── 편집 패널 ────────────────────────────────────────────────────
type Fn = (...a: never[]) => Promise<boolean>;
function Editor({ d, tab, setTab, item, setSel, row, drop, add, call, toast }: {
  d: ReportData; tab: Tab; setTab: (t: Tab) => void; item: Item | null; setSel: (n: number | null) => void;
  row: (res: string, id: number, b: Record<string, unknown>) => Promise<boolean>; drop: (res: string, id: number) => Promise<boolean>;
  add: (res: string, b: Record<string, unknown>) => Promise<boolean>; call: (u: string, m: string, b?: unknown) => Promise<boolean>; toast: (s: string) => void;
}) {
  const r = d.report;
  const TABS: [Tab, string][] = [["setup", "구성"], ["pick", "업무 넣기"], ["items", "항목"], ["requests", "결정·요청"], ...(r.kind !== "month" ? [["issues", "이슈"] as [Tab, string]] : []), ["plans", "계획"], ["tidy", `정리 필요 ${d.agg.tidy.length}`]];
  return (
    <aside className="trp-side">
      <div className="ed-chips">{TABS.map(([k, l]) => <button key={k} type="button" className={`ed-chip${tab === k ? " on" : ""}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === "setup" && <Setup d={d} call={call} />}
      {tab === "pick" && <Pick d={d} add={add} drop={drop} />}
      {tab === "items" && (item ? <ItemEdit d={d} item={item} row={row} drop={drop} add={add} toast={toast} back={() => setSel(null)} /> : <Items d={d} setSel={setSel} call={call} />)}
      {tab === "requests" && <Requests d={d} row={row} drop={drop} add={add} />}
      {tab === "issues" && <Issues d={d} row={row} drop={drop} add={add} />}
      {tab === "plans" && <Plans d={d} row={row} drop={drop} add={add} />}
      {tab === "tidy" && (
        <div className="trp-list">
          <p className="trp-hint">이 기간에 완료로 바뀌었지만 시작일 · 기한 · 등록일이 모두 기간 전인 업무입니다. 실적에서 빠집니다 — 실제 완료일을 확인해 정리하세요.</p>
          {d.agg.tidy.map((t) => <Link key={t.id} className="trp-li" href={`/v3/reports/${r.id}?task=${t.id}`} scroll={false}><span className="t">{t.title}</span><small>{t.assignee}</small></Link>)}
          {!d.agg.tidy.length && <p className="trp-hint">없음</p>}
        </div>
      )}
    </aside>
  );
}

/** 글칸 — 손을 떼면(blur) 저장 */
function Text({ value, onSave, rows = 3, placeholder, max }: { value: string; onSave: (v: string) => void; rows?: number; placeholder?: string; max?: number }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return rows > 1
    ? <textarea className="ed-input" rows={rows} value={v} maxLength={max} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v); }} />
    : <input className="ed-input" value={v} maxLength={max} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v); }} />;
}

function Setup({ d, call }: { d: ReportData; call: (u: string, m: string, b?: unknown) => Promise<boolean> }) {
  const r = d.report;
  const move = (i: number, k: number) => { const o = [...r.partOrder]; const [x] = o.splice(i, 1); o.splice(i + k, 0, x); void call(`/api/team-reports/${r.id}`, "PATCH", { partOrder: o }); };
  return (
    <>
      <h3>제목</h3><Text rows={1} value={r.title} max={120} onSave={(v) => void call(`/api/team-reports/${r.id}`, "PATCH", { title: v })} />
      <h3>핵심 멘트 (① 목표 달성률)</h3><Text rows={3} value={r.headline} max={400} placeholder="이번 기간을 한두 문장으로" onSave={(v) => void call(`/api/team-reports/${r.id}`, "PATCH", { headline: v })} />
      <h3>파트 순서 (이 보고만)</h3>
      <div className="trp-list">{r.partOrder.map((p, i) => (
        <div key={p} className="trp-li"><span className="t">{i + 1}. {PART_LABEL[p as Part]}</span>
          <button type="button" className="x" disabled={i === 0} onClick={() => move(i, -1)} aria-label="위로">↑</button>
          <button type="button" className="x" disabled={i === 2} onClick={() => move(i, 1)} aria-label="아래로">↓</button></div>
      ))}</div>
      <p className="trp-hint">팀 기본 순서는 설정에서 바꿉니다. 새 보고는 팀 기본 순서로 시작합니다.</p>
    </>
  );
}

function Pick({ d, add, drop }: { d: ReportData; add: (res: string, b: Record<string, unknown>) => Promise<boolean>; drop: (res: string, id: number) => Promise<boolean> }) {
  const inMap = new Map(d.items.map((i) => [i.taskId, i.id]));
  const [q, setQ] = useState("");
  const ts = d.agg.tasks.filter((t) => !q.trim() || `${t.title} ${t.assignee ?? ""}`.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <>
      <p className="trp-hint">이 기간의 팀 업무입니다. 체크하면 업무 상세 페이지(④)가 생깁니다. 팀보드에 없는 일은 먼저 업무로 등록하세요.</p>
      <input className="ed-input" placeholder="찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="trp-cand">
        {d.report.partOrder.map((p) => {
          const xs = ts.filter((t) => t.part === p);
          return xs.length ? (
            <div key={p}><h3 style={{ margin: "8px 0 4px" }}>{PART_LABEL[p as Part]} {xs.length}</h3>
              {xs.map((t) => (
                <label key={t.id}><input type="checkbox" checked={inMap.has(t.id)}
                  onChange={(e) => void (e.target.checked ? add("items", { taskId: t.id }) : drop("items", inMap.get(t.id)!))} />
                  <span>{t.title}<br /><small>{statusWord(t.status)} · {t.assignee ?? "담당 없음"}</small></span></label>
              ))}
            </div>
          ) : null;
        })}
      </div>
    </>
  );
}

function Items({ d, setSel, call }: { d: ReportData; setSel: (n: number) => void; call: (u: string, m: string, b?: unknown) => Promise<boolean> }) {
  const [dragId, setDragId] = useState<number | null>(null);
  return (
    <>
      <p className="trp-hint">누르면 고칩니다. 같은 파트 안에서 끌어 순서를 바꿉니다. 페이지를 눌러도 됩니다.</p>
      {d.report.partOrder.map((p) => {
        const xs = d.items.filter((i) => i.task?.part === p).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
        if (!xs.length) return null;
        const drop = (target: number) => {
          if (dragId === null || dragId === target) return;
          const ids = xs.map((x) => x.id).filter((x) => x !== dragId);
          ids.splice(ids.indexOf(target), 0, dragId);
          const all = d.report.partOrder.flatMap((pp) => (pp === p ? ids : d.items.filter((i) => i.task?.part === pp).sort((a, b) => a.sortOrder - b.sortOrder).map((i) => i.id)));
          void call(`/api/team-reports/${d.report.id}/reorder`, "POST", { res: "items", ids: all });
        };
        return (
          <div key={p} className="trp-list"><h3>{PART_LABEL[p as Part]}</h3>
            {xs.map((i) => (
              <div key={i.id} className={`trp-li${dragId === i.id ? " drag" : ""}`} draggable onDragStart={() => setDragId(i.id)} onDragEnd={() => setDragId(null)}
                   onDragOver={(e) => e.preventDefault()} onDrop={() => drop(i.id)} onClick={() => setSel(i.id)}>
                <span>⋮⋮</span><span className="t">{i.task?.title}</span><small>{i.assets.length ? `에셋 ${i.assets.length}` : "에셋 없음"}{i.visible ? "" : " · 숨김"}</small>
              </div>
            ))}
          </div>
        );
      })}
      {!d.items.length && <p className="trp-hint">「업무 넣기」에서 업무를 체크하세요.</p>}
    </>
  );
}

function ItemEdit({ d, item, row, drop, add, toast, back }: {
  d: ReportData; item: Item; row: (res: string, id: number, b: Record<string, unknown>) => Promise<boolean>; drop: (res: string, id: number) => Promise<boolean>;
  add: (res: string, b: Record<string, unknown>) => Promise<boolean>; toast: (s: string) => void; back: () => void;
}) {
  const [url, setUrl] = useState(""); const [cap, setCap] = useState(""); const [up, setUp] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const onFile = async (f: File) => {
    const bad = sizeError(f); if (bad) { toast(bad); return; }
    setUp(`올리는 중 · ${(f.size / 1048576).toFixed(1)}MB`);
    try {
      const path = await uploadReportFile(d.report.id, f, f.name);
      await add("assets", { itemId: item.id, kind: kindOfFile(f), path, caption: cap });
      setCap("");
    } catch (e) { toast(e instanceof Error ? e.message : "올리지 못했습니다"); }
    finally { setUp(""); }
  };
  return (
    <>
      <button type="button" className="ed-btn sm gh" style={{ alignSelf: "flex-start" }} onClick={back}>← 항목 목록</button>
      <h3>{item.task?.title}</h3>
      <label className="trp-row" style={{ fontSize: 13 }}><input type="checkbox" checked={item.visible} style={{ width: "auto" }} onChange={(e) => void row("items", item.id, { visible: e.target.checked })} />보고에 보이기</label>
      <h3>간단 설명 (2~3줄)</h3><Text rows={4} max={600} value={item.summary} onSave={(v) => void row("items", item.id, { summary: v })} />
      <h3>핵심 멘트 (1~2문장)</h3><Text rows={2} max={300} value={item.comment} onSave={(v) => void row("items", item.id, { comment: v })} />
      <h3>에셋</h3>
      {item.assets.map((a) => (
        <div key={a.id} className="trp-asset">
          <div className="trp-row"><b style={{ flex: 1 }}>{a.kind === "iframe" ? "iframe" : a.kind === "video" ? "영상" : a.kind === "gif" ? "GIF" : "이미지"}</b>
            <button type="button" className="ed-btn sm gh red" onClick={() => void drop("assets", a.id)}>빼기</button></div>
          {a.kind === "iframe" ? <small style={{ wordBreak: "break-all" }}>{a.url}</small> : <small>{a.path?.split("/").pop()?.slice(37)}</small>}
          <Text rows={1} max={200} placeholder="캡션" value={a.caption} onSave={(v) => void row("assets", a.id, { caption: v })} />
        </div>
      ))}
      <input className="ed-input" placeholder="캡션(선택)" value={cap} onChange={(e) => setCap(e.target.value)} />
      <div className="trp-row">
        <button type="button" className="ed-btn sm" disabled={!!up} onClick={() => file.current?.click()}>{up || "파일 올리기"}</button>
        <input ref={file} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
               onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFile(f); }} />
      </div>
      <p className="trp-hint">이미지 5MB · GIF · 영상 50MB. 첫 번째 에셋이 크게, 나머지는 아래에 작게 나옵니다.</p>
      <div className="trp-row"><input className="ed-input" placeholder="iframe 주소 https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
        <button type="button" className="ed-btn sm" disabled={!url.trim()} onClick={async () => { if (await add("assets", { itemId: item.id, kind: "iframe", url: url.trim(), caption: cap })) { setUrl(""); setCap(""); } }}>넣기</button></div>
    </>
  );
}

const REQ_K = [["decide", "결정"], ["confirm", "확인"], ["coop", "협조"], ["tidy", "정리"]];
const REQ_S = [["open", "진행"], ["done", "완료"], ["hold", "보류"]];
function Requests({ d, row, drop, add }: { d: ReportData; row: (r: string, i: number, b: Record<string, unknown>) => Promise<boolean>; drop: (r: string, i: number) => Promise<boolean>; add: (r: string, b: Record<string, unknown>) => Promise<boolean> }) {
  return (
    <>
      {d.requests.map((q) => (
        <div key={q.id} className="trp-asset">
          <div className="trp-row">
            <select className="ed-input" value={q.kind} onChange={(e) => void row("requests", q.id, { kind: e.target.value })}>{REQ_K.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <select className="ed-input" value={q.status} onChange={(e) => void row("requests", q.id, { status: e.target.value })}>{REQ_S.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            <button type="button" className="ed-btn sm gh red" onClick={() => void drop("requests", q.id)}>✕</button>
          </div>
          <Text rows={2} max={600} placeholder="내용" value={q.body} onSave={(v) => void row("requests", q.id, { body: v })} />
          <div className="trp-row">
            <input className="ed-input" type="date" value={q.due ?? ""} onChange={(e) => void row("requests", q.id, { due: e.target.value || null })} />
            <Text rows={1} max={80} placeholder="요청(누가 → 누구)" value={q.requester} onSave={(v) => void row("requests", q.id, { requester: v })} />
          </div>
        </div>
      ))}
      <button type="button" className="ed-btn sm" onClick={() => void add("requests", { kind: "decide", body: "" })}>+ 결정 · 요청 더하기</button>
    </>
  );
}

function Issues({ d, row, drop, add }: { d: ReportData; row: (r: string, i: number, b: Record<string, unknown>) => Promise<boolean>; drop: (r: string, i: number) => Promise<boolean>; add: (r: string, b: Record<string, unknown>) => Promise<boolean> }) {
  const F: [string, string, number][] = [["title", "제목", 1], ["background", "배경 · 현황", 3], ["alt_a", "대안 A", 2], ["alt_b", "대안 B", 2], ["discussion", "논의 포인트", 2], ["decision", "결정 결과", 2]];
  return (
    <>
      {d.issues.map((is) => (
        <div key={is.id} className="trp-asset">
          <div className="trp-row"><b style={{ flex: 1 }}>핵심 이슈</b><button type="button" className="ed-btn sm gh red" onClick={() => void drop("issues", is.id)}>✕</button></div>
          {F.map(([k, l, n]) => <div key={k}><small>{l}</small><Text rows={n} max={1200} value={String((is as unknown as Record<string, string>)[k] ?? "")} onSave={(v) => void row("issues", is.id, { [k]: v })} /></div>)}
          <small>액션 아이템</small>
          {is.actions.map((x) => (
            <div key={x.id} className="trp-row">
              <Text rows={1} max={300} value={x.body} onSave={(v) => void row("actions", x.id, { body: v })} />
              <select className="ed-input" style={{ width: 90 }} value={x.assignee_id ?? ""} onChange={(e) => void row("actions", x.id, { assigneeId: e.target.value || null })}>
                <option value="">담당</option>{d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input className="ed-input" style={{ width: 120 }} type="date" value={x.due ?? ""} onChange={(e) => void row("actions", x.id, { due: e.target.value || null })} />
              <select className="ed-input" style={{ width: 70 }} value={x.status} onChange={(e) => void row("actions", x.id, { status: e.target.value })}>
                <option value="todo">예정</option><option value="doing">진행</option><option value="done">완료</option></select>
              <button type="button" className="x ed-btn sm gh" onClick={() => void drop("actions", x.id)}>✕</button>
            </div>
          ))}
          <button type="button" className="ed-btn sm gh" onClick={() => void add("actions", { issueId: is.id, body: "" })}>+ 액션</button>
        </div>
      ))}
      <button type="button" className="ed-btn sm" onClick={() => void add("issues", { title: "" })}>+ 핵심 이슈 더하기</button>
    </>
  );
}

const PLAN_S = [["todo", "예정"], ["doing", "진행"], ["done", "완료"], ["dropped", "중단"]];
function Plans({ d, row, drop, add }: { d: ReportData; row: (r: string, i: number, b: Record<string, unknown>) => Promise<boolean>; drop: (r: string, i: number) => Promise<boolean>; add: (r: string, b: Record<string, unknown>) => Promise<boolean> }) {
  const [v, setV] = useState("");
  return (
    <>
      <h3>지난 계획 → 지금</h3>
      <p className="trp-hint">지난 보고의 「다음 계획」입니다. 업무로 걸린 것은 지금 상태가 자동으로, 손으로 적은 것은 여기서 상태를 고칩니다.</p>
      {d.prevPlans.map((x) => (
        <div key={`${x.kind}-${x.id}`} className="trp-li"><span className="t">{x.body}</span>
          {x.kind === "manual"
            ? <select className="ed-input" style={{ width: 80 }} value={x.status} onChange={(e) => void row("plans", x.id, { status: e.target.value })}>{PLAN_S.map(([a, b]) => <option key={a} value={a}>{b}</option>)}</select>
            : <small>{statusWord(x.status)}</small>}
        </div>
      ))}
      {!d.prevPlans.length && <p className="trp-hint">지난 보고가 없거나 계획이 없습니다.</p>}
      <h3>다음 기간 계획</h3>
      <p className="trp-hint">기한이 다음 기간인 업무 {d.agg.autoPlans.length}건은 자동으로 들어갑니다. 업무가 아닌 계획만 아래에 적습니다.</p>
      {d.plans.map((p) => <div key={p.id} className="trp-li"><span className="t">{p.body}</span><button type="button" className="x" onClick={() => void drop("plans", p.id)}>✕</button></div>)}
      <div className="trp-row"><input className="ed-input" placeholder="계획 한 줄" value={v} onChange={(e) => setV(e.target.value)} />
        <button type="button" className="ed-btn sm" disabled={!v.trim()} onClick={async () => { if (await add("plans", { body: v.trim() })) setV(""); }}>더하기</button></div>
    </>
  );
}
export type { Fn };
