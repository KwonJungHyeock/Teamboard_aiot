"use client";

// 한 줄 업무 입력 (MD-P-2026-027 §C3 · §D2).
//
// 두 자리가 같은 것을 필요로 한다:
//   §C3 업무 목록 맨 위 — 제목만으로 즉시 만든다
//   §D2 프로젝트 상세의 업무 목록 맨 아래 — 여기서 만들면 프로젝트가 자동 지정된다
// §D2 의 목적은 "연결"이라는 행위를 없애는 것이다. 만들고 나서 붙이는 게 아니라,
// 붙어 있는 자리에서 만든다.
//
// 두 자리를 각각 만들면 Enter 동작과 ⌘Enter 확장이 갈린다. 한 컴포넌트로 둔다.
//   Enter   제목만으로 즉시 생성
//   ⌘Enter  지금까지 친 내용을 그대로 들고 모달로 확장 (§C3)
import { useRef, useState } from "react";
import { toast } from "@/lib/quick";
import { notifyTaskUpdated, openNewTaskModal, type NewTaskPrefill } from "@/lib/task-panel";

export default function InlineTaskInput({
  prefill = {},
  placeholder = "업무 제목을 쓰고 Enter — ⌘Enter 로 자세히",
  onCreated,
  disabled,
  className = "",
}: {
  /** 이 자리에서 만드는 업무가 물려받을 값 (영역·프로젝트·담당·상태) */
  prefill?: NewTaskPrefill;
  placeholder?: string;
  onCreated?: (id: number) => void;
  disabled?: boolean;
  /** "under" — 표 **아래**에 붙는 자리 (§D2). 위아래 여백이 반대로 붙는다. */
  className?: string;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  async function createNow() {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true); setErr("");
    const res = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: t,
        areaId: prefill.areaId,
        projectId: prefill.projectId,
        assigneeId: prefill.assigneeId,
        visibility: prefill.visibility,
        status: prefill.status,
        // 상위가 있으면 프로젝트·영역·공개 범위는 서버가 상위 값으로 덮는다 (§A2).
        parentTaskId: prefill.parentTaskId,
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { setErr(body?.error ?? "업무를 만들지 못했어요"); return; }
    setTitle("");
    notifyTaskUpdated();
    onCreated?.(body.id);
    toast(prefill.parentTaskId ? "하위 업무를 만들었어요" : "업무를 만들었어요");
    ref.current?.focus();   // 연달아 넣는 흐름이다 — 포커스를 뺏지 않는다
  }

  /** 친 내용을 그대로 들고 모달로 (§C3). 입력칸은 비운다 — 같은 제목이 두 곳에 남으면 헷갈린다. */
  function expand() {
    openNewTaskModal({ ...prefill, title: title.trim() });
    setTitle("");
  }

  return (
    <div className={`iti${err ? " err" : ""}${className ? ` ${className}` : ""}`}>
      <span className="iti-p" aria-hidden="true">＋</span>
      <input
        ref={ref}
        className="iti-q"
        value={title}
        disabled={disabled || busy}
        placeholder={placeholder}
        onChange={(e) => { setTitle(e.target.value); if (err) setErr(""); }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) expand(); else void createNow();
        }}
        aria-label="새 업무 제목"
      />
      {title.trim() && (
        <button className="lk iti-more" onClick={expand} disabled={busy}>자세히</button>
      )}
      {err && <span className="iti-e">{err}</span>}
    </div>
  );
}
