"use client";

// 업무 상세 드로어(460px) — 어느 화면이든 `?task=ID` 로 연다 (DESIGN.md 5.3).
//   수정 요청 박스 · 맡긴 일(담당 + 확인 요청 · 수정 요청) · 상태 세그먼트 · 기한 칩 · 카테고리 · 목표 ·
//   체크리스트(하위 업무 = 항목) · 기록(메모) · 하단 삭제 / 완료
// 저장은 기존 `/api/tasks/:id` PATCH. 체크리스트 항목은 하위 업무로 만든다(진척에 그대로 잡힌다).
import { useCallback, useEffect, useState } from "react";
import { addDays, ago, catColor, diffDays, dueBadge, initial, isEnter, mondayOf, STATUS_LABEL, todayKst, weekday, type EdTask, type Status } from "@/lib/ed/core";
import { createTask, patchTask, deleteTask, useMeta, type Revision } from "./data";
import { api, Drawer, emitChanged, Seg, useToast } from "./ui";

interface Act { id: number; message: string; created_at?: string; createdAt?: string }
// 기록 안의 주소 — 옛 상세의 「첨부」처럼 아래에 다시 보인다(저장하는 것은 없다)
const linksIn = (text: string) => Array.from(new Set(text.match(/https?:\/\/[^\s)>\]]+/g) ?? [])).slice(0, 12);
const host = (u: string) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return h; } catch { return u; } };

interface Detail {
  id: number; title: string; description: string; status: string; assigneeId: number | null; assigneeName: string | null;
  createdByName: string | null; createdById: number | null; visibility: string; areaId: number; areaName: string; dueDate: string | null; goalIds: number[]; parentTaskId: number | null;
}

export default function TaskDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const meta = useMeta();
  const today = todayKst();
  const [t, setT] = useState<Detail | null>(null);
  const [createdById, setCreatedById] = useState<number | null>(null);
  const [checks, setChecks] = useState<EdTask[]>([]);
  const [rev, setRev] = useState<Revision | null>(null);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [checkText, setCheckText] = useState("");
  const [ask, setAsk] = useState<string | null>(null);
  const [pinged, setPinged] = useState(false);
  const [acts, setActs] = useState<Act[]>([]);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try {
      const [d, kids, r] = await Promise.all([
        api<{ task: Detail; activity?: Act[] }>(`/api/tasks/${id}`),
        api<{ tasks: EdTask[] }>(`/api/tasks?parent=${id}`),
        api<{ revisions: Revision[] }>("/api/revisions").catch(() => ({ revisions: [] as Revision[] })),
      ]);
      setActs(d.activity ?? []);
      setT(d.task); setTitle(d.task.title); setMemo(d.task.description ?? ""); setCreatedById(d.task.createdById);
      setChecks(kids.tasks.filter((k) => k.parentTaskId === id).sort((a, b) => a.id - b.id));
      setRev(r.revisions.find((x) => x.taskId === id) ?? null);
    } catch (e) { setErr(e instanceof Error ? e.message : "불러오지 못했습니다"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const save = async (body: Record<string, unknown>) => {
    if (!t) return;
    const prev = t;
    setT({ ...t, ...body } as Detail);
    try { await patchTask(id, body); } catch (e) { setT(prev); showToast(e instanceof Error ? e.message : "저장하지 못했습니다"); }
  };

  if (err) return <Drawer onClose={onClose} label="업무"><div className="dh"><div style={{ flex: 1 }} className="ed-err">{err}</div><button type="button" className="ed-x" onClick={onClose}>✕</button></div></Drawer>;
  if (!t || !meta) return <Drawer onClose={onClose} label="업무"><div className="dh"><div style={{ flex: 1 }} className="ed-empty">불러오는 중</div><button type="button" className="ed-x" onClick={onClose}>✕</button></div></Drawer>;

  const me = meta.me.id;
  const delegated = t.assigneeId !== me && createdById === me;
  const canAskFix = t.assigneeId !== me;
  const done = checks.filter((c) => c.status === "done").length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;
  const db = dueBadge(t.dueDate, t.status, today);
  const DUES = [
    { label: "오늘", v: today }, { label: "내일", v: addDays(today, 1) },
    { label: "금요일", v: addDays(today, (5 - weekday(today) + 7) % 7) }, { label: "다음 주", v: addDays(mondayOf(today), 7) },
  ];

  const addCheck = async () => {
    const txt = checkText.trim();
    if (!txt) return;
    setCheckText("");
    try { await createTask({ title: txt, parentTaskId: id, assigneeId: t.assigneeId ?? me, status: "todo" }); await load(); }
    catch (e) { showToast(e instanceof Error ? e.message : "항목을 더하지 못했습니다"); }
  };
  const toggleCheck = async (c: EdTask) => {
    const next = c.status === "done" ? "todo" : "done";
    setChecks((xs) => xs.map((x) => (x.id === c.id ? { ...x, status: next } : x)));
    try { await patchTask(c.id, { status: next }); } catch { void load(); }
  };
  const removeCheck = async (c: EdTask) => {
    setChecks((xs) => xs.filter((x) => x.id !== c.id));
    try { await deleteTask(c.id); } catch { void load(); }
  };
  const fixDone = async () => {
    try { await api("/api/revisions", { method: "PATCH", body: { taskId: id } }); setRev(null); emitChanged(); }
    catch (e) { showToast(e instanceof Error ? e.message : "처리하지 못했습니다"); }
  };
  const sendFix = async () => {
    try { await api("/api/revisions", { method: "POST", body: { taskId: id, memo: ask ?? "" } }); setAsk(null); await load(); emitChanged(); showToast("수정 요청을 보냈습니다"); }
    catch (e) { showToast(e instanceof Error ? e.message : "보내지 못했습니다"); }
  };
  const ping = async () => {
    try { await api(`/api/tasks/${id}/nudge`, { method: "POST" }); setPinged(true); }
    catch (e) { showToast(e instanceof Error ? e.message : "보내지 못했습니다"); }
  };
  const remove = async () => {
    try {
      await deleteTask(id);
      onClose();
    } catch (e) { showToast(e instanceof Error ? e.message : "삭제하지 못했습니다"); }
  };
  const finish = async () => {
    if (title.trim() && title.trim() !== t.title) await save({ title: title.trim() });
    if (memo !== (t.description ?? "")) await save({ description: memo });
    onClose();
  };

  return (
    <Drawer onClose={() => void finish()} label="업무 상세">
      <div className="dh">
        <textarea className="tt" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목"
                  onBlur={() => { if (title.trim() && title.trim() !== t.title) void save({ title: title.trim() }); }}
                  onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
        <button type="button" className="ed-x" onClick={() => void finish()} aria-label="닫기">✕</button>
      </div>
      <div className="db">
        {rev && (
          <div className="ed-box">
            <div className="tdr-fix"><span>수정 요청 · {rev.requesterName}</span>{rev.memo || "내용 없음"}</div>
            {t.assigneeId === me || rev.requesterId === me
              ? <button type="button" className="ed-btn pri sm tdr-al" onClick={() => void fixDone()}>수정 완료</button> : null}
          </div>
        )}
        <div className="ed-field">
          <span>상태</span>
          <Seg full value={(["todo", "doing", "review", "done"].includes(t.status) ? t.status : "todo") as Status}
               options={(["todo", "doing", "review", "done"] as Status[]).map((s) => ({ v: s, label: STATUS_LABEL[s] }))}
               onChange={(s) => void save({ status: s })} />
        </div>
        {!t.parentTaskId && (
          <div className="ed-field">
            <span>담당</span>
            <div className="ed-chips">
              {meta.people.map((p) => (
                <button key={p.id} type="button" className={`ed-chip${t.assigneeId === p.id ? " on" : ""}`}
                        disabled={t.visibility === "private" && p.id !== t.createdById}
                        onClick={() => { if (t.assigneeId !== p.id) void save({ assigneeId: p.id, assigneeName: p.name }); }}>{p.id === me ? `나 · ${p.name}` : p.name}</button>
              ))}
            </div>
          </div>
        )}
        {t.createdById === me && !t.parentTaskId && (
          <div className="ed-field">
            <span>공개</span>
            <Seg full value={t.visibility === "private" ? "private" : "team"}
                 options={[{ v: "private", label: "나만" }, { v: "team", label: "팀" }]}
                 onChange={(v) => void save({ visibility: v })} />
          </div>
        )}
        <div className="ed-field">
          <span>기한 {t.dueDate && <em className={`tdr-due ${db.tone}`}>{db.tone === "red" ? db.text : `${t.dueDate.slice(5).replace("-", ".")}${diffDays(t.dueDate, today) >= 0 ? ` · ${db.text === "오늘" || db.text === "내일" ? db.text : `D-${diffDays(t.dueDate, today)}`}` : ""}`}</em>}</span>
          <div className="ed-chips">
            {DUES.map((d) => <button key={d.label} type="button" className={`ed-chip${t.dueDate === d.v ? " on" : ""}`} onClick={() => void save({ dueDate: d.v })}>{d.label}</button>)}
            <button type="button" className={`ed-chip${!t.dueDate ? " on" : ""}`} onClick={() => void save({ dueDate: null })}>없음</button>
            <label className="ed-chip tdr-date">날짜<input type="date" value={t.dueDate ?? ""} onChange={(e) => e.target.value && void save({ dueDate: e.target.value })} /></label>
          </div>
        </div>
        <div className="ed-field">
          <span>카테고리</span>
          <div className="ed-chips">
            {meta.areas.map((a) => (
              <button key={a.id} type="button" className={`ed-chip${t.areaId === a.id ? " on" : ""}`} onClick={() => void save({ areaId: a.id })} disabled={!!t.parentTaskId}>
                <i className="tdr-cd" style={{ background: catColor(a.name) }} />{a.name}
              </button>
            ))}
          </div>
        </div>
        {!t.parentTaskId && (
          <div className="ed-field">
            <span>목표</span>
            <div className="ed-chips">
              <button type="button" className={`ed-chip${t.goalIds.length === 0 ? " on" : ""}`} onClick={() => void save({ goalIds: [] })}>없음</button>
              {meta.goals.filter((g) => g.periodType !== "year").map((g) => (
                <button key={g.id} type="button" className={`ed-chip${t.goalIds.includes(g.id) ? " on" : ""}`} onClick={() => void save({ goalIds: [g.id] })}>{g.title}</button>
              ))}
            </div>
          </div>
        )}
        {canAskFix && (
          <div className="tdr-owner">
            <span className="ed-face lg">{initial(t.assigneeName)}</span>
            <div style={{ flex: 1, minWidth: 0 }}><b>{t.assigneeName ?? "담당 없음"}</b><small>{delegated ? "맡긴 일" : "담당"}</small></div>
            {delegated && <button type="button" className="tdr-ping" onClick={() => void ping()} disabled={pinged}>{pinged ? "요청함 ✓" : "확인 요청"}</button>}
            {!rev && <button type="button" className="tdr-ping" onClick={() => setAsk(ask === null ? "" : null)}>수정 요청</button>}
          </div>
        )}
        {ask !== null && (
          <div className="ed-box">
            <textarea className="ed-input" rows={2} placeholder="고칠 내용" value={ask} onChange={(e) => setAsk(e.target.value)} autoFocus />
            <div style={{ display: "flex", gap: 6 }}>
              <button type="button" className="ed-btn pri sm" onClick={() => void sendFix()}>보내기</button>
              <button type="button" className="ed-btn sm" onClick={() => setAsk(null)}>취소</button>
            </div>
          </div>
        )}
        {!t.parentTaskId && (
          <div className="ed-field" style={{ gap: 8 }}>
            <div className="tdr-ch"><span className="ed-label">체크리스트</span><span className="tn">{checks.length ? `${pct}%` : ""}</span></div>
            <div className="ed-bar"><i style={{ width: `${pct}%` }} /></div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {checks.map((c) => (
                <div key={c.id} className={`ed-crow${c.status === "done" ? " done" : ""}`}>
                  <button type="button" className={`ed-check sm${c.status === "done" ? " on" : ""}`} onClick={() => void toggleCheck(c)} aria-label="항목 완료">{c.status === "done" ? "✓" : ""}</button>
                  <span>{c.title}</span>
                  <button type="button" className="rm" onClick={() => void removeCheck(c)} aria-label="항목 삭제">✕</button>
                </div>
              ))}
            </div>
            <input className="ed-input" value={checkText} onChange={(e) => setCheckText(e.target.value)} placeholder="+ 항목"
                   onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void addCheck(); } }} />
          </div>
        )}
        <div className="ed-field">
          <span>기록</span>
          <textarea className="ed-input" rows={5} placeholder="메모" value={memo} onChange={(e) => setMemo(e.target.value)}
                    onBlur={() => { if (memo !== (t.description ?? "")) void save({ description: memo }); }} />
        </div>
        {linksIn(memo).length > 0 && (
          <div className="ed-field" style={{ gap: 6 }}>
            <span>링크</span>
            {linksIn(memo).map((u) => <a key={u} className="tdr-link" href={u} target="_blank" rel="noreferrer noopener"><b>{host(u)}</b><em>{u}</em></a>)}
          </div>
        )}
        {acts.length > 0 && (
          <div className="ed-field" style={{ gap: 2 }}>
            <span style={{ paddingBottom: 6 }}>활동</span>
            {acts.slice(0, 8).map((a) => (
              <div key={a.id} className="tdr-act"><span>{a.message}</span><em>{ago(String(a.createdAt ?? a.created_at ?? "").replace(" ", "T").replace(/\+00$/, "Z"))}</em></div>
            ))}
          </div>
        )}
      </div>
      <div className="df">
        <button type="button" className="ed-btn gh red" style={{ padding: "10px 4px" }} onClick={() => void remove()}>삭제</button>
        <button type="button" className="ed-btn pri lg" style={{ marginLeft: "auto" }} onClick={() => void finish()}>완료</button>
      </div>
      {toast}
    </Drawer>
  );
}
