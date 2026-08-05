"use client";

// 논의·결정 스레드 (협업 B) — 대화형. 답글 목록(아바타·mono 시각·@멘션·리액션) +
// 상시 하단 컴포저(@멘션·이모지·전송) + LED 상태 + "✓ 해결로 표시" + 생명주기 액션.
// 답글은 signal_id에 붙어 허들 공유·결정 승격 후에도 보존된다.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import { VoteButtons, ImageThumb } from "./huddle-ui";
import { Avatar, ReactionChips, MentionComposer, renderRich, relTime, type ReactionSummary, type Person } from "./collab-ui";
import HoverActions from "./HoverActions";
import BlobImage from "./BlobImage";
import { uploadImage, type UploadedImage } from "@/lib/upload";
import { DecisionConfirm, DecisionCard, draftRationale, type Decision } from "./decision-ui";

interface Votes { up: number; down: number; mine: string | null }
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
  imageUrl?: string | null;
  votes?: Votes;
  reactions?: ReactionSummary[];
}

interface ThreadComment {
  id: number;
  body: string;
  imageUrl?: string | null;
  authorId: number;
  authorName: string;
  avatarUrl?: string | null;
  agent: boolean;
  createdAt: string;
  votes?: Votes;
  reactions?: ReactionSummary[];
}

const TYPE_LABEL: Record<string, string> = { decision: "결정", review: "확인 요청", memo: "메모", risk: "리스크" };
const SCOPE_LABEL: Record<string, string> = { private: "비공개", huddle: "허들", team: "팀 전체" };
// LED 상태 — 열림(slate)·논의중(amber)·결정/반영(green)·기각(muted)
const STATUS_LED: Record<string, { label: string; tone: string }> = {
  open: { label: "열림", tone: "open" },
  discussing: { label: "논의중", tone: "discussing" },
  decided: { label: "결정됨", tone: "decided" },
  resolved: { label: "반영됨", tone: "decided" },
  archived: { label: "기각됨", tone: "archived" },
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
  const [people, setPeople] = useState<Person[]>([]);
  const [draft, setDraft] = useState("");
  const [attach, setAttach] = useState<UploadedImage | null>(null);   // 코멘트 첨부 이미지 (§E)
  // 미리보기는 로컬 파일로 그린다. 아직 코멘트가 없어 서버 읽기 권한이 성립하지 않기 때문 (014a P1).
  const [attachPreview, setAttachPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskForm, setTaskForm] = useState(false);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDue, setTaskDue] = useState("");
  // 결정 로그 (MD-P-2026-004) — 확정 팝오버 + 이 논의에서 확정된 결정들
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [confirming, setConfirming] = useState<{ supersedesId?: number; defaultTitle: string } | null>(null);
  // ↑ — 입력창이 비었을 때 직전 내 코멘트 편집 (MD-P-2026-006 §A)
  const [editing, setEditing] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/signals/${signalId}`);
    const data = await res.json();
    if (!res.ok) { setError(data.error ?? "조회 실패"); setSignal(null); return; }
    setSignal(data.signal);
    setComments(data.comments ?? []);
    setDecisions(data.decisions ?? []);
    setTaskTitle(data.signal.title);
    setError("");
  }, [signalId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/meta/selectors").then((r) => r.json()).then((d) => setPeople(d.actors ?? [])).catch(() => {});
  }, []);
  // 실시간 4초 폴링 재사용 — 스레드 열려 있는 동안 답글·리액션 갱신
  useEffect(() => {
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  // hover 액션 바의 리액션은 즉시 반영한다(폴링을 기다리지 않게)
  useEffect(() => {
    const on = () => load();
    window.addEventListener("tb:reaction-changed", on);
    return () => window.removeEventListener("tb:reaction-changed", on);
  }, [load]);

  const names = people.map((p) => p.name);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/signals/${signalId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "처리 실패"); return false; }
    setError(""); await load(); onChanged(); return true;
  }

  async function send() {
    const body = draft.trim();
    if ((!body && !attach) || busy) return;
    setBusy(true);
    const res = editing
      ? await fetch(`/api/signals/${signalId}/comments`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing, body }),
        })
      : await fetch(`/api/signals/${signalId}/comments`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body, imageUrl: attach?.pathname }),
        });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "전송 실패"); return; }
    setDraft("");
    if (attachPreview) URL.revokeObjectURL(attachPreview);
    setAttachPreview(null); setAttach(null);
    setEditing(null); await load(); onChanged();
  }

  // 코멘트 이미지 첨부 (MD-P-2026-014 §E + 014a) — 업로드는 서버 라우트 경유, pathname 만 들고 있는다.
  async function attachImage(file: File) {
    setError(""); setUploading(true);
    try {
      const up = await uploadImage(file, { kind: "signal", id: signalId });
      setAttach(up);
      setAttachPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(file); });
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 업로드 실패");
    } finally {
      setUploading(false);
    }
  }
  function pickAttach() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => { const f = input.files?.[0]; if (f) void attachImage(f); };
    input.click();
  }

  /** 입력창이 빈 상태에서 ↑ — 내 마지막 코멘트를 편집 버퍼로 올린다. */
  function editLast() {
    const mine = [...comments].reverse().find((c) => c.authorId === user.id);
    if (!mine) return;
    setEditing(mine.id);
    setDraft(mine.body);
  }

  function setCommentReactions(id: number, next: ReactionSummary[]) {
    setComments((cur) => cur.map((c) => (c.id === id ? { ...c, reactions: next } : c)));
  }

  if (error && !signal) return <section className="card sthread"><p className="gerr">{error}</p></section>;
  if (!signal) return <section className="card sthread"><p className="gempty">불러오는 중...</p></section>;

  const active = signal.status === "open" || signal.status === "discussing";
  const decided = signal.status === "decided";
  const openish = active || decided;
  const isAuthor = signal.authorId === user.id;
  const isTarget = signal.targetActorId === user.id;
  const isLead = user.role === "lead";
  const led = STATUS_LED[signal.status] ?? { label: signal.status, tone: "open" };

  // "✓ 해결로 표시" — 타입·권한에 맞을 때만. 클릭하면 결정 확정 팝오버가 뜨고(화면 이동 없음),
  // 확정 시 결정 로그에 자동 기록된다 (MD-P-2026-004 §B).
  const canResolve = active && (
    signal.type === "decision" ? (isAuthor || isLead)
      : signal.type === "review" ? (isTarget || isLead)
        : signal.type === "memo" || signal.type === "risk"
  );
  const resolveLabel = signal.type === "decision" ? "✓ 결정으로 표시"
    : signal.type === "review" ? "✓ 확인 완료" : "✓ 해결로 표시";
  // 근거 초안 — 마지막 3개 답글 요약(사용자가 수정 가능)
  const rationaleDraft = draftRationale(comments.map((c) => ({ authorName: c.authorName, body: c.body })));

  return (
    <section className={`card sthread ${signal.agent ? "agline" : ""}`} aria-label="논의 스레드">
      <div className="ch">
        <span className={`dt ${signal.type}`} />
        <h2>{signal.title}</h2>
        <span className={`sled s-${led.tone}`}><i />{led.label}</span>
        <span className="gsp" />
        {onClose && <button className="lk mu" onClick={onClose}>닫기</button>}
      </div>
      <div className="smeta">
        {signal.agent && <span className="atag"><span className="mo" />에이전트</span>}
        <span className="gtag">{TYPE_LABEL[signal.type] ?? signal.type}</span>
        <span className="gtag">{SCOPE_LABEL[signal.scope] ?? signal.scope}</span>
        {signal.huddledAt && <span className="gtag">허들 공유됨</span>}
        <em>
          {signal.authorName}
          {signal.type === "review" && signal.targetName ? ` → ${signal.targetName} 확인 요청` : ""}
          {signal.projectName ? ` · ${signal.projectName}` : ""}
        </em>
      </div>
      {signal.body && <p className="sbody">{renderRich(signal.body, names)}</p>}
      {signal.imageUrl && <ImageThumb url={signal.imageUrl} />}
      <ReactionChips targetType="signal" targetId={signal.id} reactions={signal.reactions ?? []} onChanged={() => load()} />
      {signal.scope === "huddle" && signal.votes && (
        <div style={{ margin: "8px 0" }}><VoteButtons targetType="huddle" targetId={signal.id} votes={signal.votes} /></div>
      )}
      {signal.taskId && <p className="slinked">반영됨 → Task #{signal.taskId} {signal.taskTitle ? `“${signal.taskTitle}”` : ""}</p>}
      {decided && <p className="sdecided">결정됨 · 아직 업무로 반영되지 않았습니다 (미실행 결정)</p>}

      {/* 액션 — 해결로 표시(1차) + 생명주기(2차) */}
      <div className="sacts">
        {canResolve && (
          <button className="btn-brand sresolve" disabled={busy}
            onClick={() => setConfirming({ defaultTitle: signal.title })}>
            {resolveLabel}
          </button>
        )}
        {signal.scope !== "huddle" && isAuthor && !signal.huddledAt && (
          <button className="gbtn" disabled={busy} onClick={() => act({ action: "toHuddle" })}>허들로 보내기</button>
        )}
        {signal.type === "memo" && (isAuthor || isLead) && (
          <button className="gbtn" disabled={busy} onClick={() => act({ action: "promote" })}>결정으로 승격</button>
        )}
        {signal.status === "open" && (
          <button className="gbtn" disabled={busy} onClick={() => act({ status: "discussing" })}>논의 시작</button>
        )}
        {signal.type === "decision" && openish && !signal.taskId && (isAuthor || isLead) && (
          <button className="gbtn" disabled={busy} onClick={() => setTaskForm((v) => !v)}>Task로 반영</button>
        )}
        {openish && <button className="gbtn mu" disabled={busy} onClick={() => act({ status: "archived" })}>기각</button>}
      </div>

      {taskForm && (
        <div className="tnew">
          <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Task 제목" />
          <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
          <button className="lk" disabled={busy || !taskTitle.trim()}
            onClick={async () => { const ok = await act({ action: "createTask", title: taskTitle, dueDate: taskDue || null }); if (ok) setTaskForm(false); }}>
            생성
          </button>
        </div>
      )}

      {error && <p className="gerr">{error}</p>}

      {/* 대화형 답글 스레드 */}
      <div className="thread">
        <div className="thread-h"><h3>대화</h3><span className="sub num">{comments.length}</span></div>
        <div className="thread-list">
          {comments.length === 0 && <p className="thread-empty">첫 메시지를 남겨 논의를 시작하세요. @이름으로 멘션할 수 있어요.</p>}
          {comments.map((c) => (
            <div key={c.id} tabIndex={0} className={`msg ha-host ${c.agent ? "ag" : ""} ${c.authorId === user.id ? "mine" : ""}`}>
              <HoverActions
                reactionTarget={{ type: "reply", id: c.id }}
                threadLabel="답글"
                onThread={() => { setDraft((d) => (d ? d : `@${c.authorName} `)); document.querySelector<HTMLTextAreaElement>(".composer-ta")?.focus(); }}
                more={c.authorId === user.id
                  ? [{ label: "편집", onClick: () => { setEditing(c.id); setDraft(c.body); } }]
                  : [{ label: "이 사람에게 답글", onClick: () => { setDraft(`@${c.authorName} `); document.querySelector<HTMLTextAreaElement>(".composer-ta")?.focus(); } }]}
              />
              <Avatar name={c.authorName} url={c.avatarUrl} />
              <div className="msg-b">
                <div className="msg-top">
                  <b>{c.authorName}</b>
                  {c.agent && <span className="atag sm"><span className="mo" />에이전트</span>}
                  <span className="msg-t num">{relTime(c.createdAt)}</span>
                </div>
                <div className="msg-body">{renderRich(c.body, names)}</div>
                {c.imageUrl && <ImageThumb url={c.imageUrl} />}
                <ReactionChips targetType="reply" targetId={c.id} reactions={c.reactions ?? []} onChanged={(next) => setCommentReactions(c.id, next)} />
              </div>
            </div>
          ))}
        </div>
        {/* 첨부 미리보기 + 컴포저 */}
        {attach && (
          <div className="cmt-attach">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="bimg" src={attachPreview ?? ""} alt={attach.name} />
            <span className="cmt-attach-n">{attach.name}</span>
            <button className="cmt-attach-x" aria-label="첨부 제거"
              onClick={() => {
                if (attachPreview) URL.revokeObjectURL(attachPreview);
                setAttachPreview(null); setAttach(null);
              }}>✕</button>
          </div>
        )}
        <div className="cmt-tools">
          <button className="btn-ghost" onClick={pickAttach} disabled={uploading || editing !== null}>
            {uploading ? "올리는 중…" : "🖼 이미지 첨부"}
          </button>
        </div>
        {/* 상시 하단 컴포저 */}
        <MentionComposer value={draft} onChange={setDraft} onSubmit={send} busy={busy}
          editing={editing !== null}
          onEditLast={editLast}
          onCancelEdit={() => { setEditing(null); setDraft(""); }} />
      </div>

      {/* 확정된 결정 — 스레드 하단 고정 (MD-P-2026-004 §B-2·E) */}
      {decisions.length > 0 && (
        <div className="dpin">
          <div className="dpin-h">
            <h3>확정된 결정</h3>
            <span className="sub num">{decisions.length}</span>
          </div>
          {decisions.map((d) => (
            <DecisionCard key={d.id} decision={d}
              onSupersede={(dec) => setConfirming({ supersedesId: dec.id, defaultTitle: dec.title })} />
          ))}
        </div>
      )}

      {/* 결정 확정·번복 팝오버 */}
      {confirming && (
        <DecisionConfirm
          discussionId={signalId}
          defaultTitle={confirming.defaultTitle}
          rationaleDraft={rationaleDraft}
          supersedesId={confirming.supersedesId}
          onCancel={() => setConfirming(null)}
          onDone={() => { setConfirming(null); load(); onChanged(); }}
        />
      )}
    </section>
  );
}
