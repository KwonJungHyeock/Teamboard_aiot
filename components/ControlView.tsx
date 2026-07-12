"use client";

// 화면 C — 관제뷰 (팀장 전용). 4요소 + 승인 처리 (PRD 6장)
import { useCallback, useEffect, useState } from "react";
import ApproveModal from "./ApproveModal";
import type { ActivityEntry, Draft, TimelineItem } from "@/lib/types";

type DraftRow = Draft & { user_name: string; assistant_name: string };

interface Overview {
  members: { id: number; name: string; role: string; assistant_name: string }[];
  workingDrafts: DraftRow[];
  pendingDrafts: DraftRow[];
  overdue: TimelineItem[];
  dueSoon: TimelineItem[];
  progress: { area: string; total: number; done: number; percent: number }[];
  activity: ActivityEntry[];
  timelineError: string | null;
}

export default function ControlView() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [approving, setApproving] = useState<DraftRow | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/control/overview");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "관제뷰 조회 실패");
      setData(json);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  async function reject(id: number) {
    await fetch(`/api/drafts/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    setRejectingId(null);
    setFeedback("");
    refresh();
  }

  if (error) return <p className="error-text">{error}</p>;
  if (!data) return <p className="muted">불러오는 중...</p>;

  const memberStatus = (memberId: number) => {
    const working = data.workingDrafts.find((d) => d.user_id === memberId);
    if (working) return { label: `부사수 작성 중: ${working.task_type}`, badge: "blue" };
    const pending = data.pendingDrafts.filter((d) => d.user_id === memberId).length;
    if (pending > 0) return { label: `승인 대기 ${pending}건`, badge: "yellow" };
    return { label: "대기", badge: "" };
  };

  return (
    <div>
      {notice && (
        <p className="muted" style={{ color: "var(--green)", marginBottom: 14 }}>
          {notice}
        </p>
      )}
      {data.timelineError && (
        <p className="error-text" style={{ marginBottom: 14 }}>
          Notion 타임라인 조회 실패: {data.timelineError}
        </p>
      )}

      {/* 상단 4요소 */}
      <div className="grid cols-4">
        <div className="card">
          <h2>실시간 현황</h2>
          {data.members.map((m) => {
            const s = memberStatus(m.id);
            return (
              <div key={m.id} style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {m.name}
                  {m.role === "lead" && (
                    <span className="badge red" style={{ marginLeft: 6 }}>
                      팀장
                    </span>
                  )}
                </div>
                <div className="meta" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>
                  🤖 {m.assistant_name} · <span className={`badge ${s.badge}`}>{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="card">
          <h2>
            막힌 곳 <span className="count">{data.pendingDrafts.length + data.overdue.length}</span>
          </h2>
          <p className="muted" style={{ fontSize: 13 }}>
            승인 대기 <strong style={{ color: "var(--yellow)" }}>{data.pendingDrafts.length}</strong>건
            · 지연 업무 <strong style={{ color: "var(--accent)" }}>{data.overdue.length}</strong>건
          </p>
          {data.overdue.slice(0, 4).map((item) => (
            <div key={item.pageId} className="meta" style={{ marginTop: 8, fontSize: 12.5 }}>
              <span className="badge red">지연</span> {item.title} (~{item.endDate})
            </div>
          ))}
        </div>

        <div className="card">
          <h2>프로젝트별 진행률</h2>
          {data.progress.length === 0 && <p className="muted">데이터 없음</p>}
          {data.progress.slice(0, 5).map((p) => (
            <div key={p.area} style={{ marginBottom: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  marginBottom: 4,
                }}
              >
                <span>{p.area}</span>
                <span className="muted">
                  {p.done}/{p.total} · {p.percent}%
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${p.percent}%` }} />
              </div>
            </div>
          ))}
        </div>

        <div className="card">
          <h2>
            마감 임박 <span className="count">{data.dueSoon.length}</span>
          </h2>
          {data.dueSoon.length === 0 && <p className="muted">이번 주 마감 업무 없음</p>}
          {data.dueSoon.slice(0, 5).map((item) => (
            <div key={item.pageId} className="meta" style={{ marginBottom: 8, fontSize: 12.5 }}>
              <span className="badge yellow">{item.endDate}</span> {item.title}
              <span className="muted"> · {item.assignees.map((a) => a.name).join(", ")}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 승인 처리 (팀원 부사수 초안 포함) */}
      <div className="card section-gap">
        <h2>
          승인 대기 초안 — 전체 <span className="count">{data.pendingDrafts.length}</span>
        </h2>
        {data.pendingDrafts.length === 0 && <p className="muted">승인 대기 중인 초안이 없습니다.</p>}
        {data.pendingDrafts.map((d) => (
          <div className="item" key={d.id}>
            <div className="title">
              <span className="badge red" style={{ marginRight: 8 }}>
                {d.task_type}
              </span>
              {d.title}
            </div>
            <div className="meta">
              담당 {d.user_name} · 🤖 {d.assistant_name} ·{" "}
              {new Date(d.created_at).toLocaleString("ko-KR")}
            </div>
            {expandedId === d.id && <div className="draft-body">{d.body}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button
                className="btn small"
                onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
              >
                {expandedId === d.id ? "본문 접기" : "본문 보기"}
              </button>
              <button className="btn small primary" onClick={() => setApproving(d)}>
                승인
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setRejectingId(rejectingId === d.id ? null : d.id);
                  setFeedback("");
                }}
              >
                반려
              </button>
            </div>
            {rejectingId === d.id && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  rows={2}
                  placeholder="반려 사유 / 재작업 지시사항"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  <button className="btn small ghost" onClick={() => setRejectingId(null)}>
                    취소
                  </button>
                  <button className="btn small primary" onClick={() => reject(d.id)}>
                    반려 확정
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
        <p className="muted" style={{ marginTop: 12, fontSize: 12.5 }}>
          업무 지시(할당)는 2차 범위입니다.{" "}
          <button className="btn small" disabled>
            팀원 부사수에게 업무 지시 (준비 중)
          </button>
        </p>
      </div>

      {/* 팀 활동 로그 */}
      <div className="card section-gap">
        <h2>팀 활동 로그</h2>
        <div className="log">
          {data.activity.map((entry) => (
            <div className="row" key={entry.id}>
              <span className="time">
                {new Date(entry.created_at).toLocaleTimeString("ko-KR", { hour12: false })}
              </span>
              <span className={`lv-${entry.level}`}>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>

      {approving && (
        <ApproveModal
          draft={approving}
          onClose={() => setApproving(null)}
          onDone={(message) => {
            setApproving(null);
            setNotice(message);
            refresh();
          }}
        />
      )}
    </div>
  );
}
