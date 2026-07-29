"use client";

// 허들룸 피드 (Phase 6) — 개인 메모를 팀과 공유해 코멘트를 받는 통로 (SPEC 2.4).
// 메모(private) → [허들룸으로 보내기] → huddle 스레드 → [결정으로 승격] → decision → Task.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import type { ApiSignal } from "./SignalsView";
import SignalThread from "./SignalThread";
import EmptyState from "./EmptyState";
import MeetingMode from "./MeetingMode";
import ReviewSession from "./ReviewSession";

interface ReviewRow { id: number; title: string; status: string; done: number; total: number }

function relTime(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
// 흐름 상태 → LED 톤 + 라벨 (논의중 slate / 결정됨 amber / 반영됨 green)
function flowState(status: string): { led: string; cls: string; label: string } {
  if (status === "decided") return { led: "s-review", cls: "decided", label: "결정됨" };
  if (status === "resolved") return { led: "s-done", cls: "resolved", label: "반영됨" };
  return { led: "s-todo", cls: "open", label: "논의중" };
}

function NewMemoForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
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
      body: JSON.stringify({ type: "memo", scope: toHuddle ? "huddle" : "private", title, body, imageUrl }),
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
        placeholder="내용 (선택, ==강조== 지원)"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        style={{ minWidth: 200 }}
      />
      <input
        placeholder="이미지 URL (선택)"
        value={imageUrl}
        onChange={(e) => setImageUrl(e.target.value)}
        style={{ minWidth: 160 }}
      />
      <label className="glink" style={{ whiteSpace: "nowrap" }}>
        <input type="checkbox" checked={toHuddle} onChange={(e) => setToHuddle(e.target.checked)} />
        바로 허들룸으로 공유
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
  const [meetingId, setMeetingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [activeReview, setActiveReview] = useState<number | null>(null);

  const loadReviews = useCallback(async () => {
    const res = await fetch("/api/review").then((r) => r.json()).catch(() => ({ sessions: [] }));
    setReviews(res.sessions ?? []);
  }, []);

  async function startReview() {
    setBusy(true);
    const res = await fetch("/api/review", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "플랫폼 리뷰 세션", preset: true }),
    });
    setBusy(false);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "세션 개설 실패"); return; }
    await loadReviews();
    setActiveReview(data.id);
  }

  const load = useCallback(async () => {
    try {
      // 허들룸 피드는 huddle_at 기준 (scope 무관) — 승격돼 scope=team이 돼도 흐름이 남는다 (A-3).
      // 미종결·종결 모두 조회해 결정·반영까지 흐름을 보여준다.
      const [huddleRes, huddleClosed, privateRes] = await Promise.all([
        fetch("/api/signals?huddle=1").then((r) => r.json()),
        fetch("/api/signals?huddle=1&status=resolved").then((r) => r.json()),
        fetch("/api/signals?scope=private").then((r) => r.json()),
      ]);
      for (const r of [huddleRes, huddleClosed, privateRes]) if (r.error) throw new Error(r.error);
      const merged = [...(huddleRes.signals ?? []), ...(huddleClosed.signals ?? [])];
      // 중복 제거(같은 id) + huddledAt 내림차순
      const seen = new Set<number>();
      const deduped = merged.filter((s: ApiSignal) => (seen.has(s.id) ? false : seen.add(s.id)));
      deduped.sort((a: ApiSignal, b: ApiSignal) => (b.huddledAt ?? "").localeCompare(a.huddledAt ?? ""));
      setHuddles(deduped);
      // 내 메모: 아직 허들룸으로 보내지 않은 비공개 메모만
      setMyMemos(
        (privateRes.signals ?? []).filter((s: ApiSignal) => s.type === "memo" && !s.huddledAt)
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadReviews();
  }, [load, loadReviews]);

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
          워크스페이스 / <b>허들룸</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">HUDDLE</div>
            <h1>허들룸</h1>
            <p>개인 메모를 팀과 공유하고, 코멘트를 결정 근거로 그대로 끌어올립니다.</p>
          </div>
        </div>

        {loading && <p className="gempty">불러오는 중...</p>}
        {error && <p className="gerr">{error}</p>}

        {/* 리뷰 세션 — 섹션별 이전/이후 비교 → 확정 → 논의·결정 자동 생성 */}
        <section aria-label="리뷰 세션">
          <div className="hud-sh"><h2>리뷰 세션</h2><span className="sub">플랫폼 섹션별 이전/이후 비교·확정</span></div>
          <div className="hud-cards">
            {reviews.length === 0 && (
              <div className="hud-empty">
                <EmptyState compact title="진행 중인 리뷰 세션이 없어요"
                  hint="플랫폼 화면 프리셋 안건으로 리뷰 세션을 시작해 섹션별로 확정·수정·보류를 정합니다." />
              </div>
            )}
            {reviews.map((r) => {
              const closed = r.status === "closed";
              return (
                <article key={r.id} className="hud-card">
                  <div className="hud-card-top">
                    <span className={`led ${closed ? "s-done" : "s-doing"}`} aria-hidden="true" />
                    <span className={`hud-st ${closed ? "resolved" : "open"}`}>{closed ? "종료" : "진행 중"}</span>
                    <span className="hud-src">확정 <span className="num">{r.done}/{r.total}</span></span>
                    <span className="hud-id num">#{r.id}</span>
                  </div>
                  <b className="hud-card-title">{r.title}</b>
                  <div className="hud-card-acts">
                    <button className="hud-act" onClick={() => setActiveReview(r.id)}>열기</button>
                  </div>
                </article>
              );
            })}
            {user.role === "lead" && (
              <button className="hud-add" disabled={busy} onClick={startReview}>＋ 새 리뷰 세션 시작</button>
            )}
          </div>
        </section>

        {/* 내 비공개 메모 — 허들룸으로 보내기 */}
        {!loading && myMemos.length > 0 && (
          <section aria-label="내 메모" style={{ marginTop: 22 }}>
            <div className="hud-sh"><h2>내 메모</h2><span className="sub">비공개 {myMemos.length}건 — 나에게만 보입니다</span></div>
            <div className="hud-cards">
              {myMemos.map((memo) => (
                <article key={memo.id} className="hud-card">
                  <div className="hud-card-top">
                    <span className="led s-todo" aria-hidden="true" />
                    <span className="hud-st priv">비공개</span>
                    <span className="hud-src">{relTime(memo.huddledAt) || `${memo.days}일 경과`}</span>
                    <span className="hud-id num">#{memo.id}</span>
                  </div>
                  <b className="hud-card-title">{memo.title}</b>
                  {memo.body && <p className="hud-card-body">{memo.body}</p>}
                  <div className="hud-card-acts">
                    <button className="hud-act primary" disabled={busy} onClick={() => sendToHuddle(memo)}>허들룸으로 보내기</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 허들룸 피드 */}
        {!loading && (
          <section aria-label="허들룸 피드" style={{ marginTop: 22 }}>
            <div className="hud-sh"><h2>피드</h2><span className="sub">공유 {huddles.length}건</span></div>
            {huddles.length === 0 ? (
              <div className="hud-empty">
                <EmptyState title="공유된 허들룸이 없어요"
                  hint="논의·결정에서 메모를 허들룸으로 보내면, 팀이 함께 볼 결정·논의로 이 피드에 모입니다." />
              </div>
            ) : (
              <div className="hud-cards">
                {huddles.map((signal) => {
                  const fs = flowState(signal.status);
                  return (
                    <article
                      key={signal.id}
                      className={`hud-card clickable${selectedId === signal.id ? " selected" : ""}${signal.agent ? " ag" : ""}`}
                      onClick={() => setSelectedId((prev) => (prev === signal.id ? null : signal.id))}
                      role="button"
                    >
                      <div className="hud-card-top">
                        <span className={`led ${fs.led}`} aria-hidden="true" />
                        <span className={`hud-st ${fs.cls}`}>{fs.label}</span>
                        {signal.agent && <span className="atag"><span className="mo" />에이전트</span>}
                        <span className="hud-src">{signal.authorName}</span>
                        <span className="hud-id num">#{signal.id}</span>
                      </div>
                      <b className="hud-card-title">{signal.title}</b>
                      {signal.body && <p className="hud-card-body">{signal.body}</p>}
                      <div className="hud-card-foot">
                        <span className="hud-time num">{relTime(signal.huddledAt)}</span>
                        <span className="hud-cmt num">코멘트 {signal.commentCount}</span>
                        <span className="hud-card-acts" onClick={(e) => e.stopPropagation()}>
                          <button className="hud-act" onClick={() => setMeetingId(signal.id)}>회의 모드</button>
                        </span>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
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

      {meetingId && (
        <MeetingMode
          signalId={meetingId}
          userId={user.id}
          isLead={user.role === "lead"}
          onClose={() => { setMeetingId(null); load(); }}
        />
      )}

      {activeReview && (
        <ReviewSession
          sessionId={activeReview}
          user={user}
          onClose={() => { setActiveReview(null); loadReviews(); }}
        />
      )}
    </div>
  );
}
