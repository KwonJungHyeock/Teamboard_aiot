"use client";

// 결정 로그 공용 UI (MD-P-2026-004) — 확정 팝오버 · 스레드 고정 결정 카드.
// 결정=green LED / 번복=slate 취소선. 결정은 삭제 불가, 번복만 가능.
import { useEffect, useMemo, useState } from "react";
import { toast } from "@/lib/quick";
import { openPanel } from "@/lib/side-panel";
import SectionEmpty from "./SectionEmpty";

export interface Decision {
  id: number;
  projectId: number | null;
  projectName: string | null;
  projectColorKey: string | null;
  areaName: string | null;
  discussionId: number;
  discussionTitle: string | null;
  title: string;
  rationale: string;
  decidedBy: number;
  decidedByName: string;
  decidedAt: string;
  status: "confirmed" | "superseded";
  supersededBy: number | null;
  linkedTaskIds: number[];
}

/** mono 타임스탬프 — YYYY.MM.DD HH:MM (KST) */
export function decTime(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return iso.slice(0, 16);
  const f = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d);
  const g = (t: string) => f.find((p) => p.type === t)?.value ?? "";
  return `${g("year")}.${g("month")}.${g("day")} ${g("hour")}:${g("minute")}`;
}

interface OpenTask { id: number; title: string }

/**
 * 결정 확정 팝오버 — 논의 [✓ 해결로 표시] 클릭 시 그 자리에서 뜬다(화면 이동 없음).
 * rationale은 스레드 마지막 3개 답글로 프리필하되 사용자가 수정 가능(초안임을 명시).
 */
export function DecisionConfirm({
  discussionId, defaultTitle, rationaleDraft, supersedesId, onDone, onCancel,
}: {
  discussionId: number;
  defaultTitle: string;
  rationaleDraft: string;
  supersedesId?: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(defaultTitle);
  const [rationale, setRationale] = useState(rationaleDraft);
  const [taskIds, setTaskIds] = useState<number[]>([]);
  const [tasks, setTasks] = useState<OpenTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/tasks").then((r) => r.json())
      .then((d) => setTasks((d.tasks ?? []).map((t: OpenTask) => ({ id: t.id, title: t.title })).slice(0, 60)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  async function confirm() {
    if (busy) return;
    if (!title.trim()) { setErr("결정 내용을 입력하세요."); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/decisions", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ discussionId, title: title.trim(), rationale, linkedTaskIds: taskIds, supersedesId }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setErr((res && (await res.json().catch(() => ({})))?.error) || "확정에 실패했어요.");
      return;
    }
    toast(supersedesId ? "결정을 번복했어요" : "결정으로 확정했어요");
    onDone();
  }

  return (
    <div className="dcf-bg" role="presentation" onClick={onCancel}>
      <div className="dcf" role="dialog" aria-modal="true" aria-label={supersedesId ? "결정 번복" : "결정 확정"} onClick={(e) => e.stopPropagation()}>
        <div className="dcf-h">
          <b>{supersedesId ? "결정 번복" : "결정 확정"}</b>
          <button className="dcf-x" onClick={onCancel} aria-label="닫기">✕</button>
        </div>
        <label className="dcf-f">
          <span>결정 내용 <em className="req">필수</em></span>
          <input className="dcf-title" value={title} autoFocus maxLength={300}
            placeholder="무엇을 결정했나요? 한 줄로"
            onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="dcf-f">
          <span>근거 <em>선택 · 마지막 답글에서 만든 초안입니다. 수정하세요.</em></span>
          <textarea className="dcf-rat" rows={4} value={rationale} maxLength={4000}
            placeholder="왜 그렇게 결정했는지 — 나중에 재논의를 막아줍니다."
            onChange={(e) => setRationale(e.target.value)} />
        </label>
        <div className="dcf-f">
          <span>연결 업무 <em>선택</em></span>
          <div className="dcf-tasks">
            {tasks.length === 0 && <SectionEmpty text="연결할 업무가 없어요" />}
            {tasks.map((t) => (
              <label key={t.id} className={`dcf-task${taskIds.includes(t.id) ? " on" : ""}`}>
                <input type="checkbox" checked={taskIds.includes(t.id)}
                  onChange={(e) => setTaskIds((cur) => e.target.checked ? [...cur, t.id] : cur.filter((x) => x !== t.id))} />
                <span className="num">#{t.id}</span> {t.title}
              </label>
            ))}
          </div>
        </div>
        {err && <p className="dcf-err">{err}</p>}
        <div className="dcf-foot">
          <span className="dcf-note">확정하면 프로젝트 결정 로그에 자동 기록됩니다.</span>
          <button className="btn-outline" onClick={onCancel} disabled={busy}>취소</button>
          <button className="btn-brand" onClick={confirm} disabled={busy || !title.trim()}>
            {busy ? "확정 중…" : "확정"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 스레드 하단 고정 결정 카드 — 결정=green LED, 번복=slate 취소선 + 새 결정 링크. */
export function DecisionCard({ decision, onSupersede }: { decision: Decision; onSupersede?: (d: Decision) => void }) {
  const superseded = decision.status === "superseded";
  return (
    <div className={`dcard${superseded ? " sup" : ""}`}>
      <div className="dcard-top">
        <span className={`dcard-led ${superseded ? "sup" : "ok"}`} aria-hidden="true" />
        <span className="dcard-k">{superseded ? "번복됨" : "확정된 결정"}</span>
        <span className="dcard-t num">{decTime(decision.decidedAt)}</span>
      </div>
      <p className="dcard-title">{decision.title}</p>
      {decision.rationale && <p className="dcard-rat">{decision.rationale}</p>}
      <div className="dcard-foot">
        <span className="dcard-by">{decision.decidedByName}</span>
        {decision.projectName && <span className="dcard-chip">{decision.projectName}</span>}
        {decision.linkedTaskIds.length > 0 && <span className="dcard-chip">연결 업무 {decision.linkedTaskIds.length}</span>}
        {superseded && decision.supersededBy && (
          <span className="dcard-sup">→ 새 결정 #{decision.supersededBy}</span>
        )}
        {!superseded && onSupersede && (
          <button className="dcard-act" onClick={() => onSupersede(decision)}>번복</button>
        )}
      </div>
    </div>
  );
}

/** 스레드 마지막 3개 답글 → 근거 초안. */
export function draftRationale(replies: { authorName: string; body: string }[]): string {
  const last = replies.slice(-3);
  if (last.length === 0) return "";
  return last.map((r) => `- ${r.authorName}: ${r.body.replace(/\s+/g, " ").trim().slice(0, 160)}`).join("\n");
}

/** 결정 목록 한 행 — 결정 로그 화면(프로젝트 탭 · 논의·결정 탭 공용). */
export function DecisionListItem({ decision }: { decision: Decision }) {
  const superseded = decision.status === "superseded";
  const chipColor = useMemo(() => {
    switch (decision.projectColorKey) {
      case "play": case "purple": return "var(--purple)";
      case "train": case "teal": return "var(--teal)";
      case "green": return "var(--green)";
      case "amber": return "var(--amber)";
      default: return "var(--blue)";
    }
  }, [decision.projectColorKey]);
  return (
    <article className={`drow${superseded ? " sup" : ""}`}>
      <span className={`drow-led ${superseded ? "sup" : "ok"}`} aria-hidden="true" />
      <div className="drow-b">
        <div className="drow-h">
          <h4 className="drow-t">{decision.title}</h4>
          {superseded && decision.supersededBy && (
            <span className="drow-sup">→ 새 결정 #{decision.supersededBy}</span>
          )}
        </div>
        {decision.rationale && <p className="drow-rat">{decision.rationale}</p>}
        <div className="drow-meta">
          {(decision.projectName || decision.areaName) && (
            <span className="drow-chip" style={{ color: chipColor, background: `color-mix(in srgb, ${chipColor} 12%, var(--card))` }}>
              {decision.projectName ?? decision.areaName}
            </span>
          )}
          <span className="drow-av" aria-hidden="true">{decision.decidedByName.slice(0, 1)}</span>
          <span className="drow-by">{decision.decidedByName}</span>
          <span className="drow-time num">{decTime(decision.decidedAt)}</span>
          {decision.linkedTaskIds.length > 0 && <span className="drow-tasks num">업무 {decision.linkedTaskIds.length}</span>}
          <button className="drow-link" onClick={() => openPanel("signal", decision.discussionId)}>원본 논의 →</button>
        </div>
      </div>
    </article>
  );
}
