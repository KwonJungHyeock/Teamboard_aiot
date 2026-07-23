"use client";

// 시그널 스레드 (Phase 6) — 상세 + 코멘트 + 생명주기 액션.
// 경로: 메모(비공개) → 허들로 보내기 → 결정으로 승격 → Task 생성(반영).
// 코멘트는 signal_id에 붙어 전 과정에서 보존된다.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";

interface ThreadSignal {
  id: number;
  type: string;
  scope: string;
  title: string;
  body: string;
  status: string;
  taskId: number | null;
  taskTitle: string | null;
  targetActorId: number | null;
  targetName: string | null;
  authorId: number;
  authorName: string;
  agent: boolean;
  projectName: string | null;
  huddledAt: string | null;
}

interface ThreadComment {
  id: number;
  body: string;
  authorName: string;
  agent: boolean;
  createdAt: string;
}

const TYPE_LABEL: Record<string, string> = {
  decision: "결정",
  review: "확인 요청",
  memo: "메모",
  risk: "리스크",
};
const SCOPE_LABEL: Record<string, string> = { private: "비공개", huddle: "허들", team: "팀 전체" };
const STATUS_LABEL: Record<string, string> = {
  open: "제기됨",
  discussing: "논의중",
  decided: "결정됨",
  resolved: "반영됨",
  archived: "기각됨",
};

export default function SignalThread({
  signalId,
  user,
  onChanged,
  onClose,
}: {
  signalId: number;
  user: SessionUser;
  onChanged: () => void;
  onClose?: () => void;
}) {
  const [signal, setSignal] = useState<ThreadSignal | null>(null);
  const [comments, setComments] = useState<ThreadComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/signals/${signalId}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "조회 실패");
      setSignal(null);
      return;
    }
    setSignal(data.signal);
    setComments(data.comments ?? []);
    setTaskTitle(data.signal.title);
    setError("");
  }, [signalId]);

  useEffect(() => {
    load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/signals/${signalId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "처리 실패");
      return false;
    }
    setError("");
    await load();
    onChanged();
    return true;
  }

  async function addComment() {
    if (!commentBody.trim()) return;
    setBusy(true);
    const res = await fetch(`/api/signals/${signalId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: commentBody }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "코멘트 실패");
      return;
    }
    setCommentBody("");
    await load();
    onChanged();
  }

  if (error && !signal) {
    return (
      <section className="card sthread">
        <p className="gerr">{error}</p>
      </section>
    );
  }
  if (!signal) {
    return (
      <section className="card sthread">
        <p className="gempty">불러오는 중...</p>
      </section>
    );
  }

  const active = signal.status === "open" || signal.status === "discussing";
  const decided = signal.status === "decided";
  const openish = active || decided; // 종결(resolved/archived) 전
  const isAuthor = signal.authorId === user.id;
  const isTarget = signal.targetActorId === user.id;
  const isLead = user.role === "lead";

  return (
    <section className={`card sthread ${signal.agent ? "agline" : ""}`} aria-label="시그널 스레드">
      <div className="ch">
        <span className={`dt ${signal.type}`} />
        <h2>{signal.title}</h2>
        <span className="gsp" />
        {onClose && (
          <button className="lk mu" onClick={onClose}>
            닫기
          </button>
        )}
      </div>
      <div className="smeta">
        {signal.agent && (
          <span className="atag">
            <span className="mo" />
            에이전트
          </span>
        )}
        <span className="gtag">{TYPE_LABEL[signal.type] ?? signal.type}</span>
        <span className="gtag">{SCOPE_LABEL[signal.scope] ?? signal.scope}</span>
        <span className="gtag">{STATUS_LABEL[signal.status] ?? signal.status}</span>
        {signal.huddledAt && <span className="gtag">허들 공유됨</span>}
        <em>
          {signal.authorName}
          {signal.type === "review" && signal.targetName ? ` → ${signal.targetName} 확인 요청` : ""}
          {signal.projectName ? ` · ${signal.projectName}` : ""}
        </em>
      </div>
      {signal.body && <p className="sbody">{signal.body}</p>}
      {signal.taskId && (
        <p className="slinked">반영됨 → Task #{signal.taskId} {signal.taskTitle ? `“${signal.taskTitle}”` : ""}</p>
      )}
      {decided && (
        <p className="sdecided">결정됨 · 아직 업무로 반영되지 않았습니다 (미실행 결정)</p>
      )}

      {/* 생명주기 액션 — 제기됨 → 논의중 → 결정됨 → 반영됨(Task) 또는 기각됨 */}
      <div className="sacts">
        {signal.scope !== "huddle" && isAuthor && !signal.huddledAt && (
          <button className="gbtn" disabled={busy} onClick={() => act({ action: "toHuddle" })}>
            허들로 보내기
          </button>
        )}
        {signal.type === "memo" && (isAuthor || isLead) && (
          <button className="gbtn" disabled={busy} onClick={() => act({ action: "promote" })}>
            결정으로 승격
          </button>
        )}
        {signal.status === "open" && (
          <button className="gbtn" disabled={busy} onClick={() => act({ status: "discussing" })}>
            논의 시작
          </button>
        )}
        {/* 결정: 논의중 → 결정됨(작성자·lead) */}
        {signal.type === "decision" && active && (isAuthor || isLead) && (
          <button className="gbtn" disabled={busy} onClick={() => act({ status: "decided" })}>
            결정 확정
          </button>
        )}
        {/* 결정 → Task 반영 (작성자·lead). decided·논의중 모두 가능 */}
        {signal.type === "decision" && openish && !signal.taskId && (isAuthor || isLead) && (
          <button className="gbtn" disabled={busy} onClick={() => setTaskForm((v) => !v)}>
            Task로 반영
          </button>
        )}
        {/* 확인 요청: 대상·lead가 확인 완료 → resolved */}
        {signal.type === "review" && active && (isTarget || isLead) && (
          <button className="gbtn" disabled={busy} onClick={() => act({ action: "confirmReview" })}>
            확인 완료
          </button>
        )}
        {/* memo·risk 처리 완료 → resolved (member 전권) */}
        {active && (signal.type === "memo" || signal.type === "risk") && (
          <button className="gbtn mu" disabled={busy} onClick={() => act({ status: "resolved" })}>
            처리 완료
          </button>
        )}
        {openish && (
          <button className="gbtn mu" disabled={busy} onClick={() => act({ status: "archived" })}>
            기각
          </button>
        )}
      </div>

      {taskForm && (
        <div className="tnew">
          <input
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Task 제목"
          />
          <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
          <button
            className="lk"
            disabled={busy || !taskTitle.trim()}
            onClick={async () => {
              const ok = await act({ action: "createTask", title: taskTitle, dueDate: taskDue || null });
              if (ok) setTaskForm(false);
            }}
          >
            생성
          </button>
        </div>
      )}

      {error && <p className="gerr">{error}</p>}

      {/* 코멘트 스레드 — 허들 공유·승격 후에도 그대로 유지 */}
      <div className="scomments">
        <div className="ch">
          <h2>코멘트</h2>
          <span className="sub">{comments.length}건</span>
        </div>
        {comments.map((comment) => (
          <div key={comment.id} className={`scomment ${comment.agent ? "ag" : ""}`}>
            <b>
              {comment.agent && (
                <span className="atag">
                  <span className="mo" />
                  에이전트
                </span>
              )}
              {comment.authorName}
            </b>
            <span>{comment.body}</span>
          </div>
        ))}
        <div className="tnew">
          <input
            placeholder="코멘트 입력"
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addComment()}
            style={{ flex: 1 }}
          />
          <button className="lk" onClick={addComment} disabled={busy || !commentBody.trim()}>
            등록
          </button>
        </div>
      </div>
    </section>
  );
}
