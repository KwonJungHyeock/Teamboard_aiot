"use client";

// 협업 공용 UI — @멘션·==하이라이트== 리치 렌더, 이모지 리액션 칩, @멘션 컴포저, 아바타.
import { useRef, useState, type ReactNode } from "react";
import { useAutocomplete } from "./autocomplete";

export const REACTION_EMOJIS = ["👍", "🎉", "👀", "❤️", "🙌", "🤔", "✅", "🔥"];

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}
export interface Person {
  id: number;
  name: string;
}

/** 상대 시각(mono 표기용). */
export function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return iso.slice(5, 10).replace("-", ".");
}

/** ==강조== + @멘션(purple) 렌더. names 지정 시 공백 포함 이름도 매칭. */
export function renderRich(text: string, names: string[] = []): ReactNode[] {
  if (!text) return [];
  // 이름 긴 것 우선(접두사 충돌 방지). 없으면 한글/영숫자 연속을 이름으로 간주.
  const sorted = [...names].sort((a, b) => b.length - a.length).map(escapeRegExp);
  const mention = sorted.length
    ? `@(?:${sorted.join("|")})`
    : `@[0-9A-Za-z가-힣_]+`;
  const re = new RegExp(`(${mention})|==([^=]+)==`, "g");
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<span key={key++} className="mention">{m[1]}</span>);
    else if (m[2]) out.push(<mark key={key++} className="hl">{m[2]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 이니셜 아바타(자산 도착 전 폴백). url 있으면 이미지. */
export function Avatar({ name, url, size = 30 }: { name: string; url?: string | null; size?: number }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="cav" src={url} alt={name} width={size} height={size} style={{ width: size, height: size }} />;
  }
  return (
    <span className="cav cav-i" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {name.slice(0, 1)}
    </span>
  );
}

/** 이모지 리액션 칩(토글) + 추가 버튼. onToggle이 서버 토글 후 최신 요약 반환. */
export function ReactionChips({
  targetType,
  targetId,
  reactions,
  onChanged,
}: {
  targetType: string;
  targetId: number;
  reactions: ReactionSummary[];
  onChanged: (next: ReactionSummary[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(false);

  async function toggle(emoji: string) {
    if (busy) return;
    setBusy(true);
    setPick(false);
    try {
      const res = await fetch("/api/reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetType, targetId, emoji }),
      });
      if (res.ok) onChanged((await res.json()).reactions ?? []);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rchips">
      {reactions.map((r) => (
        <button
          key={r.emoji}
          className={`rchip ${r.mine ? "on" : ""}`}
          onClick={() => toggle(r.emoji)}
          disabled={busy}
          aria-pressed={r.mine}
        >
          <span className="re">{r.emoji}</span>
          <span className="rc num">{r.count}</span>
        </button>
      ))}
      <div className="radd-wrap">
        <button className="radd" onClick={() => setPick((v) => !v)} aria-label="리액션 추가" disabled={busy}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></svg>
        </button>
        {pick && (
          <div className="rpick" role="menu">
            {REACTION_EMOJIS.map((e) => (
              <button key={e} onClick={() => toggle(e)} aria-label={e}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 공용 컴포저 (MD-P-2026-006 §D) — @사람 · :이모지 · #프로젝트 자동완성을 공유 훅으로 처리.
 *  Enter=전송(Shift+Enter=줄바꿈). 입력창이 비었을 때 ↑ → 직전 내 코멘트 편집(onEditLast). */
export function MentionComposer({
  value,
  onChange,
  onSubmit,
  busy,
  placeholder = "메시지 — @사람 · #프로젝트 · :이모지, Enter로 전송",
  submitLabel = "전송",
  onEditLast,
  onCancelEdit,
  editing = false,
}: {
  /** @deprecated 사람 목록은 자동완성 훅이 직접 가져온다. 호출부 호환용으로만 남긴다. */
  people?: Person[];
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy?: boolean;
  placeholder?: string;
  submitLabel?: string;
  onEditLast?: () => void;
  onCancelEdit?: () => void;
  editing?: boolean;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [emo, setEmo] = useState(false);
  const ac = useAutocomplete(value, onChange, taRef);

  function insertEmoji(e: string) {
    onChange(value + e);
    setEmo(false);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  return (
    <div className={`composer${editing ? " editing" : ""}`}>
      {editing && (
        <div className="composer-edit">
          직전 메시지 편집 중
          <button className="lk" onClick={onCancelEdit}>취소 (Esc)</button>
        </div>
      )}
      <div className="composer-in">
        <textarea
          ref={taRef}
          rows={1}
          className="composer-ta"
          placeholder={placeholder}
          value={value}
          disabled={busy}
          onChange={(e) => { onChange(e.target.value); setTimeout(ac.sync, 0); }}
          onClick={ac.sync}
          onKeyUp={(e) => { if (e.key.startsWith("Arrow")) ac.sync(); }}
          onKeyDown={(e) => {
            if (ac.onKeyDown(e)) return;
            if (e.key === "Escape") { setEmo(false); if (editing) { e.stopPropagation(); onCancelEdit?.(); } }
            // 입력창이 비었을 때 ↑ — 직전 내 코멘트 편집 (Slack과 같은 자리·같은 동작)
            if (e.key === "ArrowUp" && !value && onEditLast) { e.preventDefault(); onEditLast(); return; }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSubmit(); }
          }}
        />
        {ac.menu}
      </div>
      <div className="composer-tools">
        <div className="radd-wrap">
          <button className="composer-emo" onClick={() => setEmo((v) => !v)} aria-label="이모지" disabled={busy}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01" /></svg>
          </button>
          {emo && (
            <div className="rpick up" role="menu">
              {REACTION_EMOJIS.map((e) => <button key={e} onClick={() => insertEmoji(e)} aria-label={e}>{e}</button>)}
            </div>
          )}
        </div>
        <button className="btn-brand composer-send" onClick={onSubmit} disabled={busy || !value.trim()}>
          {busy ? "전송 중…" : editing ? "저장" : submitLabel}
        </button>
      </div>
    </div>
  );
}
