"use client";

// 회의 결정 → 운영 전략 (지시서 v1 파트 4). 확정된 결정 줄의 [전략에 반영]에서 연다.
//   항목 고르기(또는 새 항목) → 바뀐 기준 → 저장. 이력에 회의 링크가 붙는다.
//   잠긴 항목이면 팀원은 승인 대기로만 남는다(파트 3 규칙 그대로, 서버가 판단)
import { useEffect, useMemo, useState } from "react";
import { axisLabel, phaseLabel, STRATEGY_AXES, STRATEGY_PHASES, type StrategyAxis, type StrategyPhase } from "@/lib/strategy-words";
import { api, Modal, Seg } from "./ui";

interface Lite { id: number; axis: string; phase: number; title: string; standard: string; status: string; locked: boolean }

export default function StrategyApply({ meetingId, decision, onClose, onDone }: {
  meetingId: number; decision: { id: number; body: string }; onClose: () => void; onDone: (msg: string) => void;
}) {
  const [items, setItems] = useState<Lite[] | null>(null);
  const [lead, setLead] = useState(false);
  const [pick, setPick] = useState<number | "new" | "">("");
  const [axis, setAxis] = useState<StrategyAxis>("inflow");
  const [phase, setPhase] = useState<StrategyPhase>(1);
  const [title, setTitle] = useState("");
  const [after, setAfter] = useState(decision.body);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ items: Lite[]; me: { lead: boolean } }>("/api/ed/strategy")
      .then((d) => { setItems(d.items.filter((i) => i.status !== "dropped")); setLead(d.me.lead); })
      .catch((e) => setErr(e instanceof Error ? e.message : "불러오지 못했습니다"));
  }, []);
  const cur = typeof pick === "number" ? items?.find((i) => i.id === pick) : undefined;
  const groups = useMemo(() => STRATEGY_AXES.flatMap((a) => STRATEGY_PHASES.map((p) => ({
    label: `${a.label} · ${p.label}`, xs: (items ?? []).filter((i) => i.axis === a.key && i.phase === p.key),
  }))).filter((g) => g.xs.length), [items]);
  const ok = !busy && !!after.trim() && (pick === "new" ? !!title.trim() : typeof pick === "number" && after.trim() !== cur?.standard);

  const save = async () => {
    if (!ok) return;
    setBusy(true); setErr("");
    const ref = { meetingId, meetingItemId: decision.id, reason };
    try {
      if (pick === "new") {
        await api("/api/ed/strategy", { method: "POST", body: { axis, phase, title, standard: after.trim(), ...ref } });
        onDone(`전략에 새 항목으로 반영했습니다 · ${axisLabel(axis)} ${phaseLabel(phase)}`);
      } else {
        const r = await api<{ approval: string }>(`/api/ed/strategy/${pick}`, { method: "PATCH", body: { standard: after.trim(), ...ref } });
        onDone(r.approval === "pending" ? "잠긴 항목이라 승인 대기로 올렸습니다" : "전략 기준을 바꿨습니다. 이력에 회의가 남았습니다");
      }
    } catch (e) { setErr(e instanceof Error ? e.message : "저장하지 못했습니다"); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label="전략에 반영" width={520}>
      <div className="am-h">
        <b className="sga-t">전략에 반영</b>
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="am-b">
        <p className="sga-q"><b>결정</b>{decision.body}</p>
        <label className="am-f"><span>항목</span>
          <select className="ed-input" value={pick} disabled={!items} aria-label="전략 항목"
                  onChange={(e) => setPick(e.target.value === "new" ? "new" : e.target.value ? Number(e.target.value) : "")}>
            <option value="">{items ? "항목 고르기" : "불러오는 중"}</option>
            {groups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.xs.map((i) => <option key={i.id} value={i.id}>{i.locked ? "[잠금] " : ""}{i.title}</option>)}
              </optgroup>
            ))}
            <option value="new">+ 새 항목 만들기</option>
          </select>
        </label>
        {pick === "new" && (
          <>
            <input className="ed-input" value={title} maxLength={200} placeholder="새 항목명" aria-label="새 항목명" onChange={(e) => setTitle(e.target.value)} />
            <div className="am-grid">
              <label className="am-f"><span>축</span>
                <select className="ed-input" value={axis} onChange={(e) => setAxis(e.target.value as StrategyAxis)}>
                  {STRATEGY_AXES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select></label>
              <div className="am-f"><span>단계</span>
                <Seg full value={String(phase)} onChange={(v) => setPhase(Number(v) as StrategyPhase)} options={STRATEGY_PHASES.map((p) => ({ v: String(p.key), label: p.label }))} /></div>
            </div>
          </>
        )}
        {cur && <p className="sga-cur"><b>현재 기준</b>{cur.standard || "비어 있음"}</p>}
        {cur?.locked && !lead && <p className="sga-lock">잠긴 항목입니다. 저장하면 승인 대기로 남고, 팀장이 승인하면 반영됩니다.</p>}
        <label className="am-f"><span>바뀐 기준</span>
          <textarea className="ed-input" rows={3} value={after} maxLength={4000} onChange={(e) => setAfter(e.target.value)} /></label>
        <input className="ed-input" value={reason} maxLength={1000} placeholder="근거 (선택)" aria-label="근거" onChange={(e) => setReason(e.target.value)} />
        {err && <div className="ed-err">{err}</div>}
      </div>
      <div className="am-foot">
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn sm" onClick={onClose}>취소</button>
        <button type="button" className="sg-save" disabled={!ok} onClick={() => void save()}>{busy ? "저장 중" : cur?.locked && !lead ? "승인 요청" : "저장"}</button>
      </div>
    </Modal>
  );
}
