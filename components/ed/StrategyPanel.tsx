"use client";

// 운영 전략 상세 패널: 업무 상세와 같은 오른쪽 서랍(Drawer).
//   현재 기준 바로 편집 → 저장하면 변경 이력에 남는다. 잠긴 항목을 팀원이 고치면 「승인 요청」(기준은 그대로)
//   팀장: 담당 지정 · 잠금 · 승인 대기 승인/반려
//   지표 축은 숫자 칸 없이 「집계 화면 링크」 칸만
//   새 항목(target 이 {axis, phase})이면 만들기 칸만 보인다
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  approvalLabel, STRATEGY_AXES, STRATEGY_LINK_AXIS, STRATEGY_PHASES, STRATEGY_STATUSES,
  type StrategyAxis, type StrategyPhase, type StrategyStatus,
} from "@/lib/strategy-words";
import { useMeta } from "./data";
import { api, Drawer, emitChanged, Seg, useToast } from "./ui";

export interface SgItem {
  id: number; axis: string; phase: number; title: string; standard: string; ownerId: number | null; ownerName: string | null;
  status: string; locked: boolean; linkUrl: string | null; changedAt: string; comments: number; pending: number;
}
interface SgChange {
  id: number; before: string; after: string; reason: string | null; meetingId: number | null; meetingTitle: string | null;
  byName: string | null; at: string; approval: string; decidedByName: string | null; decidedAt: string | null;
}
interface SgComment { id: number; authorName: string; body: string; at: string }
type Me = { id: number; lead: boolean; write: boolean };

/** DB 시각(UTC 문자열) → KST */
const kst = (pg: string) => new Date(Date.parse(pg.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00")) + 9 * 3600e3).toISOString();
export const kstDay = (pg: string) => { const s = kst(pg); return `${s.slice(5, 7)}.${s.slice(8, 10)}`; };
const kstTime = (pg: string) => { const s = kst(pg); return `${s.slice(5, 7)}.${s.slice(8, 10)} ${s.slice(11, 16)}`; };

export function LockIcon() {
  return (
    <svg className="sg-lock" viewBox="0 0 16 16" width="13" height="13" aria-label="잠금" role="img">
      <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" />
      <path d="M5.2 7V5.2a2.8 2.8 0 0 1 5.6 0V7" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export default function StrategyPanel({ target, me, onClose, onSaved }: {
  target: number | { axis: StrategyAxis; phase: StrategyPhase }; me: Me; onClose: () => void; onSaved: (id?: number) => void;
}) {
  return typeof target === "number"
    ? <Detail id={target} me={me} onClose={onClose} onSaved={onSaved} />
    : <NewItem preset={target} onClose={onClose} onSaved={onSaved} />;
}

function NewItem({ preset, onClose, onSaved }: { preset: { axis: StrategyAxis; phase: StrategyPhase }; onClose: () => void; onSaved: (id?: number) => void }) {
  const [axis, setAxis] = useState<StrategyAxis>(preset.axis);
  const [phase, setPhase] = useState<StrategyPhase>(preset.phase);
  const [title, setTitle] = useState("");
  const [standard, setStandard] = useState("");
  const [link, setLink] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true); setErr("");
    try {
      const { id } = await api<{ id: number }>("/api/ed/strategy", { method: "POST", body: { axis, phase, title, standard, linkUrl: link } });
      emitChanged(); onSaved(id);
    } catch (e) { setErr(e instanceof Error ? e.message : "만들지 못했습니다"); setBusy(false); }
  };
  return (
    <Drawer onClose={onClose} label="새 전략 항목">
      <div className="dh">
        <div className="sg-dt">새 항목</div>
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="db sg-db">
        <label className="ed-field"><span>항목명</span>
          <input className="ed-input" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
        <div className="sg-two">
          <label className="ed-field"><span>축</span>
            <select className="ed-input" value={axis} onChange={(e) => setAxis(e.target.value as StrategyAxis)}>
              {STRATEGY_AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select></label>
          <div className="ed-field"><span>단계</span>
            <Seg full value={String(phase)} onChange={(v) => setPhase(Number(v) as StrategyPhase)} options={STRATEGY_PHASES.map((p) => ({ v: String(p.key), label: p.label }))} /></div>
        </div>
        <label className="ed-field"><span>현재 기준</span>
          <textarea className="ed-input" rows={4} value={standard} maxLength={4000} onChange={(e) => setStandard(e.target.value)} /></label>
        {axis === STRATEGY_LINK_AXIS && (
          <label className="ed-field"><span>집계 화면 링크</span>
            <input className="ed-input" value={link} maxLength={500} placeholder="https:// 또는 /v3/stats" onChange={(e) => setLink(e.target.value)} /></label>
        )}
        <p className="sg-hint">담당은 팀장이 지정합니다. 새 항목은 검토 중으로 시작합니다.</p>
        {err && <div className="ed-err">{err}</div>}
      </div>
      <div className="df">
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn sm gh" onClick={onClose}>취소</button>
        <button type="button" className="sg-save" disabled={!title.trim() || busy} onClick={() => void save()}>{busy ? "만드는 중" : "만들기"}</button>
      </div>
    </Drawer>
  );
}

function Detail({ id, me, onClose, onSaved }: { id: number; me: Me; onClose: () => void; onSaved: (id?: number) => void }) {
  const meta = useMeta();
  const [d, setD] = useState<{ item: SgItem; changes: SgChange[]; comments: SgComment[]; meetings: { id: number; title: string; at: string }[] } | null>(null);
  const [err, setErr] = useState("");
  const [title, setTitle] = useState("");
  const [std, setStd] = useState("");
  const [reason, setReason] = useState("");
  const [mtg, setMtg] = useState<number | "">("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, show] = useToast();

  const load = useCallback(async () => {
    try {
      const x = await api<NonNullable<typeof d>>(`/api/ed/strategy/${id}`);
      setD(x); setTitle(x.item.title); setStd(x.item.standard); setLink(x.item.linkUrl ?? ""); setReason(""); setMtg("");
    } catch (e) { setErr(e instanceof Error ? e.message : "불러오지 못했습니다"); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  if (err) return <Drawer onClose={onClose} label="전략 항목"><div className="dh"><div className="ed-err" style={{ flex: 1 }}>{err}</div><button type="button" className="ed-x" onClick={onClose}>✕</button></div></Drawer>;
  if (!d) return <Drawer onClose={onClose} label="전략 항목"><div className="dh"><div className="ed-empty" style={{ flex: 1 }}>불러오는 중</div><button type="button" className="ed-x" onClick={onClose}>✕</button></div></Drawer>;

  const it = d.item;
  const dropped = it.status === "dropped";
  const plain = me.write && (!it.locked || me.lead);        // 기준 밖의 칸
  const needApproval = it.locked && !me.lead;
  const dirty = std.trim() !== it.standard && !!std.trim();
  const pending = d.changes.filter((c) => c.approval === "pending");
  const history = d.changes.filter((c) => c.approval !== "pending");

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    setBusy(true);
    try { await fn(); if (msg) show(msg); await load(); emitChanged(); onSaved(); }
    catch (e) { show(e instanceof Error ? e.message : "저장하지 못했습니다"); }
    setBusy(false);
  };
  const patch = (body: Record<string, unknown>, msg?: string) => run(() => api(`/api/ed/strategy/${id}`, { method: "PATCH", body }), msg);
  const saveStd = () => run(async () => {
    const r = await api<{ approval: string }>(`/api/ed/strategy/${id}`, { method: "PATCH", body: { standard: std.trim(), reason, meetingId: mtg || null } });
    show(r.approval === "pending" ? "승인 대기로 올렸습니다. 팀장이 승인하면 반영됩니다" : "기준을 바꿨습니다. 이력에 남았습니다");
  });
  const decide = (cid: number, action: "approve" | "reject") =>
    run(() => api(`/api/ed/strategy/changes/${cid}`, { method: "PATCH", body: { action } }), action === "approve" ? "승인했습니다" : "반려했습니다");
  const comment = () => { const b = note.trim(); if (!b) return; void run(async () => { await api(`/api/ed/strategy/${id}/comments`, { method: "POST", body: { body: b } }); setNote(""); }); };

  return (
    <Drawer onClose={onClose} label="전략 항목 상세">
      <div className="dh">
        <textarea className="tt" rows={2} value={title} readOnly={!plain || dropped} aria-label="항목명" onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => { const t = title.trim(); if (t && t !== it.title) void patch({ title: t }); else setTitle(it.title); }}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); } }} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="db sg-db">
        {dropped && (
          <div className="sg-note">폐기한 항목입니다.
            {plain && <button type="button" className="sg-link" disabled={busy} onClick={() => void patch({ status: "review" }, "되살렸습니다. 검토 중으로 돌아갔습니다")}>되살리기</button>}
          </div>
        )}
        {it.locked && (
          <div className="sg-note"><LockIcon /> 잠긴 항목입니다.{needApproval ? " 기준을 고치면 팀장 승인 뒤 반영됩니다." : ""}</div>
        )}

        <div className="sg-two">
          <label className="ed-field"><span>축</span>
            <select className="ed-input" value={it.axis} disabled={!plain || dropped} onChange={(e) => void patch({ axis: e.target.value })}>
              {STRATEGY_AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select></label>
          <div className="ed-field"><span>단계</span>
            <Seg full value={String(it.phase)} onChange={(v) => { if (plain && !dropped && Number(v) !== it.phase) void patch({ phase: Number(v) }); }}
                 options={STRATEGY_PHASES.map((p) => ({ v: String(p.key), label: p.label }))} /></div>
        </div>
        <div className="sg-two">
          <div className="ed-field"><span>상태</span>
            <Seg full value={it.status as StrategyStatus} options={STRATEGY_STATUSES.map((s) => ({ v: s.key, label: s.label }))}
                 onChange={(v) => {
                   if (!plain || v === it.status) return;
                   if (v === "dropped" && !window.confirm("이 항목을 폐기할까요? 거르개 「폐기」에서 다시 보고 되살릴 수 있습니다.")) return;
                   void patch({ status: v }, v === "dropped" ? "폐기했습니다" : undefined);
                 }} /></div>
          <label className="ed-field"><span>담당</span>
            {me.lead ? (
              <select className="ed-input" value={it.ownerId ?? ""} disabled={busy} onChange={(e) => void patch({ ownerId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">담당 없음</option>
                {meta?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : <span className="sg-ro">{it.ownerName ?? "담당 없음 (팀장이 지정)"}</span>}
          </label>
        </div>
        {me.lead && (
          <div className="ed-field"><span>잠금</span>
            <Seg value={it.locked ? "on" : "off"} onChange={(v) => { if ((v === "on") !== it.locked) void patch({ locked: v === "on" }, v === "on" ? "잠갔습니다" : "잠금을 풀었습니다"); }}
                 options={[{ v: "off", label: "풀림" }, { v: "on", label: "잠금" }]} />
          </div>
        )}

        <div className="ed-field">
          <span>현재 기준</span>
          <textarea className="ed-input sg-std" rows={4} value={std} maxLength={4000} readOnly={!me.write || dropped} aria-label="현재 기준"
                    onChange={(e) => setStd(e.target.value)} />
          {dirty && me.write && !dropped && (
            <div className="sg-edit">
              <input className="ed-input" value={reason} maxLength={1000} placeholder="근거 (선택)" aria-label="근거" onChange={(e) => setReason(e.target.value)} />
              <select className="ed-input" value={mtg} aria-label="회의 링크" onChange={(e) => setMtg(e.target.value ? Number(e.target.value) : "")}>
                <option value="">회의 링크 없음</option>
                {d.meetings.map((m) => <option key={m.id} value={m.id}>{kstDay(m.at)} {m.title}</option>)}
              </select>
              <div className="sg-acts">
                <button type="button" className="ed-btn sm gh" onClick={() => { setStd(it.standard); setReason(""); setMtg(""); }}>되돌리기</button>
                <button type="button" className="sg-save" disabled={busy} onClick={() => void saveStd()}>{needApproval ? "승인 요청" : "저장"}</button>
              </div>
            </div>
          )}
        </div>

        {it.axis === STRATEGY_LINK_AXIS && (
          <div className="ed-field">
            <span>집계 화면 링크</span>
            <div className="sg-linkrow">
              <input className="ed-input" value={link} maxLength={500} readOnly={!plain || dropped} placeholder="https:// 또는 /v3/stats" aria-label="집계 화면 링크"
                     onChange={(e) => setLink(e.target.value)} onBlur={() => { if (link.trim() !== (it.linkUrl ?? "")) void patch({ linkUrl: link.trim() }, "링크를 저장했습니다"); }} />
              {it.linkUrl && <a className="sg-link" href={it.linkUrl} target={it.linkUrl.startsWith("/") ? undefined : "_blank"} rel="noreferrer noopener">열기</a>}
            </div>
          </div>
        )}

        {pending.length > 0 && (
          <div className="ed-field">
            <span>승인 대기 <i className="sg-n">{pending.length}</i></span>
            {pending.map((c) => (
              <div key={c.id} className="sg-ch wait">
                <div className="who">{c.byName ?? "알 수 없음"} · {kstTime(c.at)}<em className="sg-wait">승인 대기</em></div>
                <Diff c={c} />
                {me.lead && (
                  <div className="sg-acts">
                    <button type="button" className="ed-btn sm" disabled={busy} onClick={() => void decide(c.id, "reject")}>반려</button>
                    <button type="button" className="sg-save" disabled={busy} onClick={() => void decide(c.id, "approve")}>승인</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="ed-field">
          <span>변경 이력 <i className="sg-n">{history.length}</i></span>
          {history.length === 0 ? <div className="sg-empty">아직 바뀐 적이 없습니다</div> : history.map((c) => (
            <div key={c.id} className={`sg-ch ${c.approval}`}>
              <div className="who">{kstTime(c.at)} · {c.byName ?? "알 수 없음"}<em className={`ap ${c.approval}`}>{approvalLabel(c.approval)}</em>
                {c.decidedByName && c.approval !== "direct" && <small> 처리 {c.decidedByName}</small>}</div>
              <Diff c={c} />
            </div>
          ))}
        </div>

        <div className="ed-field">
          <span>의견 <i className="sg-n">{d.comments.length}</i></span>
          {me.write && (
            <div className="sg-cm-in">
              <input className="ed-input" value={note} maxLength={2000} placeholder="의견 남기기" aria-label="의견"
                     onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); comment(); } }} />
              <button type="button" className="sg-save" disabled={!note.trim() || busy} onClick={comment}>남기기</button>
            </div>
          )}
          {d.comments.map((c) => (
            <div key={c.id} className="sg-cm"><div className="who">{c.authorName} · {kstTime(c.at)}</div><p>{c.body}</p></div>
          ))}
        </div>
      </div>
      {toast}
    </Drawer>
  );
}

function Diff({ c }: { c: SgChange }) {
  return (
    <>
      {c.before && <p className="bf"><b>이전</b>{c.before}</p>}
      <p className="af"><b>{c.before ? "바뀐" : "처음"}</b>{c.after}</p>
      {c.reason && <p className="rs"><b>근거</b>{c.reason}</p>}
      {c.meetingId && <Link className="mt" href={`/v3/room/${c.meetingId}`}>회의 · {c.meetingTitle ?? `#${c.meetingId}`}</Link>}
    </>
  );
}
