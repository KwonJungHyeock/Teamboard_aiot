"use client";

// 업무 검색형 콤보박스 (MD-P-2026-028 §A4 · §B1).
//
// **ProjectCombo 의 패턴과 CSS(.pcb-*)를 그대로 쓴다.** 새 시각 언어를 만들지 않는다.
// 두 자리가 같은 것을 필요로 한다:
//   §A4 상위 업무 지정·해제
//   §B1 차단 업무 지정·해제
// 각각 만들면 키보드 동작과 "없음" 처리가 자리마다 갈린다. 하나로 둔다.
//
// 후보를 화면에서 거르지 않는다 — 서버가 같은 규칙으로 다시 본다(순환·깊이).
// 미리 거르면 규칙이 두 벌이 되고 반드시 한쪽이 낡는다(030 에서 겪은 것).
// 대신 **거절 사유를 그대로 받아 그 자리에 띄운다.**
import { useEffect, useMemo, useRef, useState } from "react";

export interface ComboTask { id: number; title: string; status?: string }

const RECENT_KEY = "tb:recent-tasks";
const RECENT_MAX = 5;

function readRecent(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch { return []; }
}

/** 최근 본 업무를 위로 올린다. 상세를 열 때마다 부르면 자연히 자주 보는 것이 위로 온다. */
export function rememberTask(id: number) {
  if (typeof window === "undefined" || !Number.isInteger(id) || id <= 0) return;
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 동작은 한다 */ }
}

export default function TaskCombo({
  selfId, value, noneLabel, noneHint, note, onPick,
}: {
  /** 자기 자신은 후보에서 뺀다 — 서버도 막지만 목록에 두면 누르게 된다. */
  selfId: number;
  value: number | null;
  /** "상위 없음" / "차단 없음" */
  noneLabel: string;
  noneHint?: string;
  note?: string;
  /**
   * 고른 값을 저장한다. **거절 사유 문자열**을 돌려주면 그 자리에 띄운다.
   * 성공이면 null 을 돌려준다.
   */
  onPick: (id: number | null) => Promise<string | null>;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState<ComboTask[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [cursor, setCursor] = useState(0);
  const qRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setAll((d.tasks ?? []).filter((t: ComboTask) => t.id !== selfId)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [selfId]);

  const typed = q.trim().toLowerCase();
  const { list, recentCount } = useMemo(() => {
    if (typed) {
      return { list: all.filter((t) => t.title.toLowerCase().includes(typed)).slice(0, 8), recentCount: 0 };
    }
    // 타이핑 전에는 최근 본 업무를 위로 (§B1)
    const recent = readRecent();
    const head = recent.map((id) => all.find((t) => t.id === id)).filter((t): t is ComboTask => !!t);
    const rest = all.filter((t) => !recent.includes(t.id));
    return { list: [...head, ...rest].slice(0, 8), recentCount: head.length };
  }, [all, typed]);

  const rowCount = list.length + 1;   // 0 번은 "없음"

  async function pick(id: number | null) {
    if (busy) return;
    setBusy(true); setErr("");
    const message = await onPick(id);
    setBusy(false);
    // 서버가 거절했으면 **그 문장을 그대로** 보여준다. 우리 말로 바꾸지 않는다 —
    // 바꾸면 규칙이 두 벌이 되고, 무엇이 진짜 사유인지 알 수 없게 된다.
    if (message) setErr(message);
  }

  return (
    <div className="pcb-pop tcb" role="dialog" aria-label="업무 선택">
      <input
        ref={qRef} className="pcb-q" autoFocus value={q} placeholder="업무 제목 검색…"
        onChange={(e) => { setQ(e.target.value); setCursor(0); setErr(""); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, rowCount - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          else if (e.key === "Enter") {
            e.preventDefault();
            void pick(cursor === 0 ? null : list[cursor - 1]?.id ?? null);
          } else if (e.key === "Escape") { e.stopPropagation(); }
        }}
      />
      <div className="pcb-list" role="listbox">
        {/* "없음" 은 **항상 첫 줄**이다. 지정만 되고 해제가 안 되면 아무도 안 쓴다 (§B1). */}
        <button
          className={`pcb-o${cursor === 0 ? " cur" : ""}${value === null ? " on" : ""}`}
          onClick={() => pick(null)} disabled={busy}
        >
          <span className="pcb-o-n">{noneLabel}</span>
          {noneHint && <em className="pcb-rec">{noneHint}</em>}
        </button>
        {list.map((t, i) => (
          <button
            key={t.id}
            className={`pcb-o${cursor === i + 1 ? " cur" : ""}${value === t.id ? " on" : ""}`}
            onClick={() => pick(t.id)} disabled={busy}
          >
            <span className="tcb-id num">#{t.id}</span>
            <span className="pcb-o-n">{t.title}</span>
            {!typed && i < recentCount && <em className="pcb-rec">최근</em>}
          </button>
        ))}
        {list.length === 0 && (
          <p className="pcb-none">{typed ? "일치하는 업무가 없어요" : "고를 업무가 없어요"}</p>
        )}
      </div>
      {note && <p className="tcb-n">{note}</p>}
      {err && <p className="pcb-err">{err}</p>}
    </div>
  );
}
