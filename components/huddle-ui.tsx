"use client";

// 허들룸 공용 UI (파트 D) — ==하이라이트== 렌더, 투표 버튼, 이미지 썸네일.
import { useState, type ReactNode } from "react";

/** ==문법== 을 형광펜(mark)으로 렌더. 그리기 아님 — 순수 텍스트 마크업. */
export function renderHighlight(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /==([^=]+)==/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<mark key={i++} className="hl-mark">{m[1]}</mark>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function VoteButtons({
  targetType,
  targetId,
  votes,
  compact,
}: {
  targetType: "huddle" | "comment";
  targetId: number;
  votes: { up: number; down: number; mine: string | null };
  compact?: boolean;
}) {
  const [state, setState] = useState(votes);
  const [busy, setBusy] = useState(false);
  async function vote(v: "up" | "down") {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/huddle/vote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId, vote: v }),
    });
    setBusy(false);
    if (res.ok) setState(await res.json());
  }
  return (
    <span className={`votes ${compact ? "votes-sm" : ""}`}>
      <button className={`vote ${state.mine === "up" ? "on" : ""}`} onClick={() => vote("up")} disabled={busy} aria-label="찬성">
        👍 <b>{state.up}</b>
      </button>
      <button className={`vote ${state.mine === "down" ? "on" : ""}`} onClick={() => vote("down")} disabled={busy} aria-label="반대">
        👎 <b>{state.down}</b>
      </button>
    </span>
  );
}

export function ImageThumb({ url }: { url: string }) {
  return (
    <a className="hthumb" href={url} target="_blank" rel="noreferrer" title="원본 열기">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="첨부 이미지" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = "none"; }} />
    </a>
  );
}
