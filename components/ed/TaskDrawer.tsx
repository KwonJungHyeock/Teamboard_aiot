"use client";

// 업무 상세 드로어(460px) — 어느 화면이든 `?task=ID` 로 연다 (DESIGN.md 5.3).
//   수정 요청 박스 · 맡긴 일(담당 + 확인 요청 · 수정 요청) · 상태 · 담당/공개 · 함께하는 사람 · 기간(달력) · 카테고리/목표(고르거나 적기) ·
//   체크리스트(하위 업무 = 항목) · 기록(메모) · 하단 삭제 / 완료
// 저장은 기존 `/api/tasks/:id` PATCH. 체크리스트 항목은 하위 업무로 만든다(진척에 그대로 잡힌다).
import { useCallback, useEffect, useState } from "react";
import { ago, dueBadge, initial, isEnter, STATUS_LABEL, todayKst, type EdTask, type Status } from "@/lib/ed/core";
import { areaOpts, canMakeGoal, createTask, deleteTask, dropArea, dropGoal, goalOpts, makeArea, makeGoal, patchTask, useMeta, type Revision } from "./data";
import Combo from "./Combo";
import { DateIn } from "./AddModal";
import { api, Drawer, emitChanged, Seg, useToast } from "./ui";

interface Act { id: number; message: string; created_at?: string; createdAt?: string }

// 기록 안의 주소 — 옛 상세의 「첨부」처럼 아래에 다시 보인다(저장하는 것은 없다)
const linksIn = (text: string) => Array.from(new Set(text.match(/https?:\/\/[^\s)>\]]+/g) ?? [])).slice(0, 12);
const host = (u: string) => { try { const h = new URL(u).hostname.replace(/^www\./, ""); return h; } catch { return u; } };

interface Detail {
  id: number; title: string; description: string; status: string; assigneeId: number | null; assigneeName: string | null;
  createdByName: string | null; createdById: number | null; visibility: string; areaId: number; areaName: string; dueDate: string | null; startDate?: string | null; goalIds: number[]; parentTaskId: number | null;
  /** 담당 · 만든 사람 · 팀장만 고친다(QA 1) — 나머지는 보기 전용 + 「수정 요청」 */
  canEdit?: boolean; dropReason?: string | null;
  /** 함께하는 사람(0048) */
  members?: { id: number; name: string }[];
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
  const canAskFix = t.assigneeId !== me && !(t.members ?? []).some((m) => m.id === me);
  const done = checks.filter((c) => c.status === "done").length;
  const pct = checks.length ? Math.round((done / checks.length) * 100) : 0;
  const db = dueBadge(t.dueDate, t.status, today);

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
  // ── 카테고리 · 목표 — 고르거나 적기(Combo). 만들기 · 지우기 규칙은 data.ts 하나 ──
  const personal = t.visibility === "private";
  const fail = (e: unknown) => showToast(e instanceof Error ? e.message : "처리하지 못했습니다");

  const remove = async () => {
    try {
      await deleteTask(id);
      onClose();
    } catch (e) { showToast(e instanceof Error ? e.message : "삭제하지 못했습니다"); }
  };
  const ro = t.canEdit === false;
  const finish = async () => {
    if (!ro && title.trim() && title.trim() !== t.title) await save({ title: title.trim() });
    if (!ro && memo !== (t.description ?? "")) await save({ description: memo });
    onClose();
  };
  // 중단 — 사유가 있어야 한다(진척 분모에서 빠지므로). 중단한 업무는 목록에서 내려간다
  const drop = async () => {
    const why = window.prompt("중단 사유를 적어 주세요");
    if (!why || !why.trim()) return;
    await save({ status: "dropped", dropReason: why.trim() });
    emitChanged();
  };

  return (
    <Drawer onClose={() => void finish()} label="업무 상세">
      <div className="dh">
        <textarea className="tt" rows={2} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목" readOnly={ro}
                  onBlur={() => { if (title.trim() && title.trim() !== t.title) void save({ title: title.trim() }); }}
                  onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
        <button type="button" className="ed-x" onClick={() => void finish()} aria-label="닫기">✕</button>
      </div>
      <div className="db">
        {ro && <div className="tdr-ro">보기 전용 · 고칠 것은 아래 「수정 요청」으로</div>}
        {t.status === "dropped" && (
          <div className="tdr-ro drop">중단한 업무{t.dropReason ? ` · ${t.dropReason}` : ""}
            {!ro && <button type="button" className="ed-btn sm" onClick={() => void save({ status: "todo" }).then(emitChanged)}>되살리기</button>}</div>
        )}
        {rev && (
          <div className="ed-box">
            <div className="tdr-fix"><span>수정 요청 · {rev.requesterName}</span>{rev.memo || "내용 없음"}</div>
            {t.assigneeId === me || rev.requesterId === me
              ? <button type="button" className="ed-btn pri sm tdr-al" onClick={() => void fixDone()}>수정 완료</button> : null}
          </div>
        )}
        <fieldset className="tdr-fs" disabled={ro}>
        <div className="ed-field">
          <span className="tdr-fh">상태
            {!ro && t.status !== "dropped" && !t.parentTaskId && <button type="button" className="tdr-tidy" onClick={() => void drop()}>중단…</button>}
          </span>
          <Seg full value={(["todo", "doing", "review", "hold", "done"].includes(t.status) ? t.status : "todo") as Status}
               options={(["todo", "doing", "review", "hold", "done"] as Status[]).map((s) => ({ v: s, label: STATUS_LABEL[s] }))}
               onChange={(s) => { if (!ro) void save({ status: s }); }} />
        </div>
        {!t.parentTaskId && (
          <div className="tdr-two">
            <label className="ed-field">
              <span>담당</span>
              <select className="ed-input" value={t.assigneeId ?? ""} disabled={t.visibility === "private"}
                      onChange={(e) => { const p = meta.people.find((x) => x.id === Number(e.target.value)); if (p) void save({ assigneeId: p.id, assigneeName: p.name, members: (t.members ?? []).filter((m) => m.id !== p.id) }); }}>
                {t.assigneeId === null && <option value="">담당 없음</option>}
                {meta.people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `나 · ${p.name}` : p.name}</option>)}
              </select>
            </label>
            {t.createdById === me ? (
              <div className="ed-field">
                <span>공개</span>
                <Seg full value={t.visibility === "private" ? "private" : "team"}
                     options={[{ v: "team", label: "팀" }, { v: "private", label: "나만" }]}
                     onChange={(v) => void save({ visibility: v })} />
              </div>
            ) : <span />}
          </div>
        )}
        {!t.parentTaskId && t.visibility !== "private" && (
          <div className="ed-field">
            <span>함께하는 사람</span>
            <div className="ed-chips">
              {(t.members ?? []).map((m) => (
                <button key={m.id} type="button" className="ed-chip on tdr-mem" aria-label={`${m.name} 빼기`}
                        onClick={() => { const next = (t.members ?? []).filter((x) => x.id !== m.id); void save({ memberIds: next.map((x) => x.id), members: next }); }}>
                  {m.id === me ? `나 · ${m.name}` : m.name}<b aria-hidden="true">✕</b>
                </button>
              ))}
              {meta.people.some((p) => p.id !== t.assigneeId && !(t.members ?? []).some((m) => m.id === p.id)) && (
                <select className="ed-chip tdr-addsel" value="" aria-label="함께하는 사람 더하기"
                        onChange={(e) => { const p = meta.people.find((x) => x.id === Number(e.target.value)); if (!p) return; const next = [...(t.members ?? []), p]; void save({ memberIds: next.map((x) => x.id), members: next }); }}>
                  <option value="">+ 더하기</option>
                  {meta.people.filter((p) => p.id !== t.assigneeId && !(t.members ?? []).some((m) => m.id === p.id))
                    .map((p) => <option key={p.id} value={p.id}>{p.id === me ? `나 · ${p.name}` : p.name}</option>)}
                </select>
              )}
            </div>
          </div>
        )}
        <div className="ed-field">
          <span>{t.parentTaskId ? "기한" : "기간"} {t.dueDate && <em className={`tdr-due ${db.tone}`}>{db.text}</em>}</span>
          <div className="am-dates">
            {!t.parentTaskId ? (
              <DateIn label="시작일" value={t.startDate ?? ""} max={t.dueDate ?? undefined} onChange={(v) => void save({ startDate: v || null })} />
            ) : <span />}
            <i>~</i>
            <DateIn label="기한" value={t.dueDate ?? ""} min={t.startDate ?? undefined} onChange={(v) => void save({ dueDate: v || null })} />
          </div>
        </div>
        <div className="tdr-two">
          <div className="ed-field">
            <span>카테고리</span>
            <Combo label="카테고리" value={t.areaId} options={areaOpts(meta)} disabled={!!t.parentTaskId || ro}
                   onPick={(id) => { const a = id === null ? meta.areas.find((x) => x.name === "기타") : meta.areas.find((x) => x.id === id); if (a) void save({ areaId: a.id, areaName: a.name }); }}
                   onCreate={async (name) => { try { const id = await makeArea(name); await save({ areaId: id, areaName: name }); } catch (e) { fail(e); } }}
                   onRemove={async (o) => { try { const msg = await dropArea(o); if (msg) { showToast(msg); await load(); } } catch (e) { fail(e); } }} />
          </div>
          {!t.parentTaskId && (
            <div className="ed-field">
              <span>목표</span>
              <Combo label="목표" value={t.goalIds[0] ?? null} options={goalOpts(meta, personal)} none="없음 (상시 업무)" disabled={ro}
                     onPick={(id) => void save({ goalIds: id === null ? [] : [id] })}
                     onCreate={canMakeGoal(meta, personal) ? async (title) => { try { const id = await makeGoal(title, personal); await save({ goalIds: [id] }); } catch (e) { fail(e); } } : undefined}
                     onRemove={async (o) => { try { if (await dropGoal(o) && t.goalIds.includes(o.id)) await save({ goalIds: t.goalIds.filter((x) => x !== o.id) }); } catch (e) { fail(e); } }} />
            </div>
          )}
        </div>
        </fieldset>
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
                  <button type="button" className={`ed-check sm${c.status === "done" ? " on" : ""}`} disabled={ro} onClick={() => void toggleCheck(c)} aria-label="항목 완료">{c.status === "done" ? "✓" : ""}</button>
                  <span>{c.title}</span>
                  {!ro && <button type="button" className="rm" onClick={() => void removeCheck(c)} aria-label="항목 삭제">✕</button>}
                </div>
              ))}
            </div>
            {!ro && <input className="ed-input" value={checkText} onChange={(e) => setCheckText(e.target.value)} placeholder="+ 항목"
                   onKeyDown={(e) => { if (isEnter(e)) { e.preventDefault(); void addCheck(); } }} />}
          </div>
        )}
        <div className="ed-field">
          <span>기록</span>
          <textarea className="ed-input" rows={5} placeholder={ro ? "" : "메모"} value={memo} readOnly={ro} onChange={(e) => setMemo(e.target.value)}
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
        {!ro && <button type="button" className="ed-btn gh red" style={{ padding: "10px 4px" }} onClick={() => void remove()}>삭제</button>}
        <button type="button" className="ed-btn pri lg" style={{ marginLeft: "auto" }} onClick={() => void finish()}>{ro ? "닫기" : "완료"}</button>
      </div>
      {toast}
    </Drawer>
  );
}
