"use client";

// 허들 피드 (Phase 6) — 개인 메모를 팀과 공유해 코멘트를 받는 통로 (SPEC 2.4).
// 메모(private) → [허들로 보내기] → huddle 스레드 → [결정으로 승격] → decision → Task.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import type { ApiSignal } from "./SignalsView";
import SignalThread from "./SignalThread";

function NewMemoForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [toHuddle, setToHuddle] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    const res = await fetch("/api/signals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "memo", scope: toHuddle ? "huddle" : "private", title, body }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "생성 실패");
      return;
    }
    setTitle("");
    setBody("");
    onDone();
  }

  return (
    <div className="tnew">
      <input
        placeholder="메모 제목"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
      />
      <input
        placeholder="내용 (선택)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ minWidth: 240 }}
      />
      <label className="glink" style={{ whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={toHuddle} onChange={(e) => setToHuddle(e.target.checked)} />
        바로 허들로 공유
      </label>
      <button className="lk" onClick={submit} disabled={busy || !title.trim()}>
        추가
      </button>
      {error && <span className="gerr">{error}</span>}
    </div>
  );
}

export default function HuddleFeed({ user }: { user: SessionUser }) {
  const [huddles, setHuddles] = useState<ApiSignal[]>([]);
  const [myMemos, setMyMemos] = useState<ApiSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [huddleRes, privateRes] = await Promise.all([
        fetch("/api/signals?scope=huddle").then((r) => r.json()),
        fetch("/api/signals?scope=private").then((r) => r.json()),
      ]);
      if (huddleRes.error) throw new Error(huddleRes.error);
      if (privateRes.error) throw new Error(privateRes.error);
      setHuddles(huddleRes.signals ?? []);
      setMyMemos((privateRes.signals ?? []).filter((s: ApiSignal) => s.type === "memo"));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function sendToHuddle(signal: ApiSignal) {
    setBusy(true);
    const res = await fetch(`/api/signals/${signal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "toHuddle" }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "공유 실패");
      return;
    }
    load();
  }

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>허들</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">HUDDLE</div>
            <h1>허들</h1>
            <p>개인 메모를 팀과 공유하고, 코멘트를 결정 근거로 그대로 끌어올립니다.</p>
          </div>
        </div>

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}

        {/* 내 비공개 메모 — 허들로 보내기 */}
        {!loading && myMemos.length > 0 && (
          <section className="card" aria-label="내 메모">
            <div className="ch">
              <h2>내 메모</h2>
              <span className="sub">비공개 {myMemos.length}건 — 나에게만 보입니다</span>
            </div>
            {myMemos.map((memo) => (
              <div key={memo.id} className="tinbox-row">
                <span className="dt memo" />
                <div className="tinbox-b">
                  <b>{memo.title}</b>
                  {memo.body && <em>{memo.body}</em>}
                </div>
                <span className="gsp" />
                <button className="lk" disabled={busy} onClick={() => sendToHuddle(memo)}>
                  허들로 보내기
                </button>
              </div>
            ))}
          </section>
        )}

        {/* 허들 피드 */}
        {!loading && (
          <section className="card" aria-label="허들 피드">
            <div className="ch">
              <h2>피드</h2>
              <span className="sub">공유 {huddles.length}건</span>
            </div>
            {huddles.length === 0 && (
              <p className="gempty">공유된 메모가 없습니다. 메모를 허들로 보내보세요.</p>
            )}
            {huddles.map((signal) => (
              <div
                key={signal.id}
                className={`hud clickable ${signal.agent ? "ag" : ""} ${selectedId === signal.id ? "selected" : ""}`}
                onClick={() => setSelectedId((prev) => (prev === signal.id ? null : signal.id))}
                role="button"
              >
                <div className="h">
                  {signal.agent && (
                    <span className="atag">
                      <span className="mo" />
                      에이전트
                    </span>
                  )}
                  {signal.title}
                </div>
                {signal.body && <div className="b">{signal.body}</div>}
                <div className="f">
                  <span>{signal.authorName}</span>
                  <span>코멘트 {signal.commentCount}</span>
                  {signal.type === "decision" && <span className="gtag">결정</span>}
                </div>
              </div>
            ))}
          </section>
        )}

        {selectedId && (
          <SignalThread
            signalId={selectedId}
            user={user}
            onChanged={load}
            onClose={() => setSelectedId(null)}
          />
        )}

        <NewMemoForm onDone={load} />
      </div>
    </div>
  );
}
