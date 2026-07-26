"use client";

// 회의 모드 (파트 D 허들룸) — 몰입형 전체화면. 좌: 코멘트 실시간 누적 / 우: 결정사항.
// 회의 모드가 곧 회의록 — 누적된 코멘트 + 승격된 결정이 그대로 기록으로 남는다.
// 종료 시 memo→decision 승격(결정사항 확정). 그리기·캔버스 없음(펜 없음).
import { useCallback, useEffect, useRef, useState } from "react";
import { renderHighlight, VoteButtons } from "./huddle-ui";

interface Votes { up: number; down: number; mine: string | null }
interface MComment { id: number; body: string; imageUrl?: string | null; authorName: string; createdAt: string; votes?: Votes }
interface MSignal { id: number; title: string; body: string; status: string; type: string; authorId: number; votes?: Votes; imageUrl?: string | null }

const STATUS_LABEL: Record<string, string> = { open: "논의중", discussing: "논의중", decided: "결정됨", resolved: "반영됨", archived: "기각" };

export default function MeetingMode({
  signalId,
  userId,
  isLead,
  onClose,
}: {
  signalId: number;
  userId: number;
  isLead: boolean;
  onClose: () => void;
}) {
  const [signal, setSignal] = useState<MSignal | null>(null);
  const [comments, setComments] = useState<MComment[]>([]);
  const [body, setBody] = useState("");
  const [decision, setDecision] = useState("");
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/signals/${signalId}`);
    if (!res.ok) return;
    const data = await res.json();
    setSignal(data.signal);
    setComments(data.comments ?? []);
  }, [signalId]);

  useEffect(() => { load(); }, [load]);
  // 실시간 누적 — 4초 폴링 (실시간 커서·소켓은 범위 밖)
  useEffect(() => {
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  // 몰입형 — 사이드바 접힘
  useEffect(() => {
    document.body.classList.add("meeting-on");
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("meeting-on"); window.removeEventListener("keydown", onKey); };
  }, [onClose]);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    await fetch(`/api/signals/${signalId}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
    });
    setBusy(false);
    setBody("");
    await load();
  }

  async function act(payload: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/signals/${signalId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    setBusy(false);
    await load();
  }

  // 결정사항 확정 = 코멘트로 남기고(=회의록) + memo→decision 승격
  async function commitDecision() {
    if (decision.trim()) {
      await fetch(`/api/signals/${signalId}/comments`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: `✅ 결정: ==${decision.trim()}==` }),
      });
      setDecision("");
    }
    const canPromote = signal && signal.type === "memo" && (signal.authorId === userId || isLead);
    if (canPromote) await act({ action: "promote" });
    else await load();
  }

  const decisionComments = comments.filter((c) => c.body.startsWith("✅ 결정:"));

  return (
    <div className="meeting">
      <div className="meeting-top">
        <div className="meeting-title">
          <span className="meeting-badge">회의 모드</span>
          <b>{signal?.title ?? "…"}</b>
          {signal && <span className="meeting-st">{STATUS_LABEL[signal.status] ?? signal.status}</span>}
        </div>
        <span className="gsp" />
        <span className="meeting-hint">이 화면이 곧 회의록입니다 — 코멘트·결정이 그대로 기록됩니다.</span>
        <button className="btn" onClick={onClose}>회의 종료</button>
      </div>

      <div className="meeting-body">
        {/* 좌: 코멘트 실시간 누적 */}
        <div className="meeting-left">
          {signal?.body && <p className="meeting-lead">{renderHighlight(signal.body)}</p>}
          <div className="meeting-comments" ref={listRef}>
            {comments.length === 0 && <p className="tdp-muted">아직 코멘트가 없습니다. 첫 발언을 남겨보세요.</p>}
            {comments.map((c) => (
              <div className={`meeting-c ${c.body.startsWith("✅ 결정:") ? "is-decision" : ""}`} key={c.id}>
                <div className="meeting-c-h"><b>{c.authorName}</b>
                  {c.votes && <VoteButtons targetType="comment" targetId={c.id} votes={c.votes} compact />}
                </div>
                <div className="meeting-c-b">{renderHighlight(c.body)}</div>
              </div>
            ))}
          </div>
          <div className="meeting-input">
            <input placeholder="발언 입력 (==강조== 지원) · Enter" value={body}
              onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
            <button className="btn-brand" onClick={send} disabled={busy || !body.trim()}>발언</button>
          </div>
        </div>

        {/* 우: 결정사항 패널 */}
        <aside className="meeting-right">
          <div className="meeting-r-h">결정사항</div>
          {decisionComments.length === 0 && <p className="tdp-muted">아직 확정된 결정이 없습니다.</p>}
          {decisionComments.map((c) => (
            <div className="meeting-decision" key={c.id}>{renderHighlight(c.body.replace("✅ 결정:", "").trim())}</div>
          ))}
          <div className="meeting-r-input">
            <textarea placeholder="이번 회의의 결정사항을 적으세요" rows={3} value={decision}
              onChange={(e) => setDecision(e.target.value)} />
            <button className="btn-brand" onClick={commitDecision} disabled={busy}>
              결정 확정{signal?.type === "memo" ? " → 결정으로 승격" : ""}
            </button>
          </div>
          {signal?.status === "decided" && <p className="meeting-decided">결정으로 승격됨 · 논의·결정에서 추적됩니다.</p>}
        </aside>
      </div>
    </div>
  );
}
