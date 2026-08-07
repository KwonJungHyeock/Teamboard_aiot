"use client";

// 프로젝트 검색형 콤보박스 (MD-P-2026-027 §D1 · §D4).
//
// 프로젝트가 늘어나면 <select> 는 못 쓴다 — 스크롤을 눈으로 훑어야 하고,
// 찾는 이름이 뭐로 시작하는지 기억해야 한다. 타이핑으로 좁히는 편이 언제나 빠르다.
//
// 세 가지를 한 자리에서 끝낸다:
//   ① 타이핑으로 좁히기  ② 최근 사용을 위로  ③ 없으면 그 자리에서 만들기
// ③ 이 핵심이다. "프로젝트가 아직 없네 → 다른 화면 가서 만들고 → 돌아와서 고른다" 는
// 흐름은 중간에 끊긴다. 끊기면 그냥 프로젝트 없이 만들어 버린다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface ComboProject {
  id: number;
  name: string;
  colorKey: string | null;
  areaId: number;
}

const RECENT_KEY = "tb:recent-projects";
const RECENT_MAX = 5;

function readRecent(): number[] {
  if (typeof window === "undefined") return [];
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((n) => Number.isInteger(n)) : [];
  } catch {
    return [];
  }
}

/** 고른 프로젝트를 최근 목록 맨 앞으로. 고를 때마다 부르면 자연히 자주 쓰는 것이 위로 온다. */
export function rememberProject(id: number) {
  if (typeof window === "undefined" || !Number.isInteger(id) || id <= 0) return;
  const next = [id, ...readRecent().filter((x) => x !== id)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* 저장 실패는 조용히 넘긴다 — 최근 목록은 없어도 되는 편의다 */
  }
}

export default function ProjectCombo({
  value,
  projects,
  areaId,
  canCreate,
  disabled,
  disabledReason,
  onChange,
  onCreated,
  placeholder = "＋ 프로젝트 연결",
}: {
  value: number | null;
  projects: ComboProject[];
  /** 새로 만들 때 넣을 영역. 업무의 영역을 그대로 물려준다 — 영역 없는 프로젝트를 만들지 않는다. */
  areaId?: number;
  /** 프로젝트 생성은 팀장만 (POST /api/projects 가 requireLead). 아니면 만들기 줄을 그리지 않는다. */
  canCreate?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  onChange: (id: number | null) => void;
  /** 새로 만든 프로젝트를 부모 목록에 즉시 반영하기 위한 통지 */
  onCreated?: (p: ComboProject) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = projects.find((p) => p.id === value) ?? null;

  // 후보 정렬 — 최근 사용이 위, 그 뒤는 이름순. 검색어가 있으면 이름 부분일치로 좁힌다.
  const options = useMemo(() => {
    const recent = readRecent();
    const key = q.trim().toLowerCase();
    const hit = key ? projects.filter((p) => p.name.toLowerCase().includes(key)) : projects.slice();
    const rank = (p: ComboProject) => {
      const i = recent.indexOf(p.id);
      return i === -1 ? RECENT_MAX : i;
    };
    return hit.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  }, [projects, q]);

  const recentCount = useMemo(() => {
    const recent = readRecent();
    return options.filter((p) => recent.includes(p.id)).length;
  }, [options]);

  const typed = q.trim();
  // 이름이 정확히 같은 프로젝트가 이미 있으면 "만들기"를 그리지 않는다 — 같은 이름 둘을 만들게 된다.
  const showCreate = !!canCreate && typed.length > 0 && !projects.some((p) => p.name.trim() === typed);

  // 행 목록: [연결 없음] + 후보들 + [새로 만들기]. 커서 이동을 한 줄로 계산하려고 평평하게 둔다.
  const rowCount = 1 + options.length + (showCreate ? 1 : 0);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setErr("");
    setCursor(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, close]);

  function pick(id: number | null) {
    if (id !== null) rememberProject(id);
    onChange(id);
    close();
  }

  async function createAndPick() {
    if (busy || !typed) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: typed, areaId }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) {
      setErr(d?.error ?? "프로젝트를 만들지 못했어요");
      return;
    }
    const made: ComboProject = { id: d.id, name: typed, colorKey: "team", areaId: areaId ?? 0 };
    onCreated?.(made);
    pick(made.id);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();          // 모달까지 Esc 가 올라가 같이 닫히면 안 된다
      close();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => (c + 1) % rowCount); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => (c - 1 + rowCount) % rowCount); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      if (cursor === 0) { pick(null); return; }
      if (cursor <= options.length) { pick(options[cursor - 1].id); return; }
      void createAndPick();
    }
  }

  if (disabled) {
    return (
      <span className="pcb-off" title={disabledReason}>
        {disabledReason ?? "선택할 수 없습니다"}
      </span>
    );
  }

  return (
    <div className={`pcb${open ? " open" : ""}`} ref={boxRef}>
      <button
        type="button"
        className={`pcb-v${selected ? "" : " empty"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {selected ? (
          <>
            <i className={`pjdot ${selected.colorKey ?? "team"}`} />
            {selected.name}
          </>
        ) : (
          placeholder
        )}
      </button>

      {open && (
        <div className="pcb-pop" role="dialog" aria-label="프로젝트 선택">
          <input
            ref={inputRef}
            className="pcb-q"
            value={q}
            placeholder="프로젝트 검색"
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={onKey}
            aria-label="프로젝트 검색"
          />
          <div className="pcb-list" role="listbox">
            <button
              type="button"
              role="option"
              aria-selected={value === null}
              className={`pcb-o${cursor === 0 ? " cur" : ""}${value === null ? " on" : ""}`}
              onMouseEnter={() => setCursor(0)}
              onClick={() => pick(null)}
            >
              연결 없음
            </button>

            {options.map((p, i) => (
              <button
                type="button"
                key={p.id}
                role="option"
                aria-selected={value === p.id}
                className={`pcb-o${cursor === i + 1 ? " cur" : ""}${value === p.id ? " on" : ""}`}
                onMouseEnter={() => setCursor(i + 1)}
                onClick={() => pick(p.id)}
              >
                <i className={`pjdot ${p.colorKey ?? "team"}`} />
                <span className="pcb-o-n">{p.name}</span>
                {/* 최근 사용 표시는 검색어가 없을 때만 — 좁혀 놓고 나면 순서가 이미 답이다 */}
                {!typed && i < recentCount && <em className="pcb-rec">최근</em>}
              </button>
            ))}

            {options.length === 0 && !showCreate && (
              <p className="pcb-none">{typed ? "일치하는 프로젝트가 없어요" : "프로젝트가 없어요"}</p>
            )}

            {showCreate && (
              <button
                type="button"
                className={`pcb-o pcb-new${cursor === rowCount - 1 ? " cur" : ""}`}
                onMouseEnter={() => setCursor(rowCount - 1)}
                onClick={createAndPick}
                disabled={busy}
              >
                {busy ? "만드는 중…" : `“${typed}” 새 프로젝트로 만들기`}
              </button>
            )}
          </div>
          {err && <p className="pcb-err">{err}</p>}
        </div>
      )}
    </div>
  );
}
