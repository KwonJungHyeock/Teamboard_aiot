"use client";

// 하위 업무 (MD-P-2026-028 §A1).
//
// 새 화면을 만들지 않는다. 업무 상세의 속성 블록 바로 아래, 자유 본문 위에 붙는다.
// 맨 아래 한 줄 입력은 **InlineTaskInput 을 그대로 재사용한다** — 세 번째 자리다.
// 새로 만들면 Enter 동작(즉시 생성)과 ⌘Enter(모달 확장)가 자리마다 갈린다.
//
// 진척은 계산하지 않는다 (28-a). lib/progress.ts 의 taskProgress() 가
// 하위 완료율을 이미 셈에 넣는다 — 여기서 또 세면 계산기가 둘이 된다.
import { useState } from "react";
import InlineTaskInput from "./InlineTaskInput";
import SectionEmpty from "./SectionEmpty";
import { isCountable, isDone } from "@/lib/progress";
import { pfill } from "@/lib/progress-bar";
import { notifyTaskUpdated, openTaskPanel } from "@/lib/task-panel";
import { toast } from "@/lib/quick";

export interface SubtaskRow {
  id: number; title: string; status: string; resolution: string | null;
  assigneeId: number | null; assigneeName: string | null;
  dueDate: string | null; progress: number;
}

export default function SubtaskSection({
  parentId, children, prefill, onChanged,
}: {
  parentId: number;
  children: SubtaskRow[];
  /** 하위가 물려받는 값 — 서버가 강제하지만 모달로 확장할 때 미리 채워 준다 (§A2) */
  prefill: { areaId: number; projectId?: number; visibility: "team" | "private" };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);

  // 집계 규칙은 lib/progress.ts 것을 그대로 쓴다. "완료 1" 의 1 이 진척 분자와 같아야 한다.
  const counted = children.filter(isCountable);
  const done = counted.filter(isDone).length;

  async function toggle(row: SubtaskRow) {
    if (busy !== null) return;
    setBusy(row.id);
    const next = isDone(row) ? "todo" : "done";
    const res = await fetch(`/api/tasks/${row.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) {
      toast((res && (await res.json().catch(() => ({})))?.error) || "바꾸지 못했어요", "err");
      return;
    }
    notifyTaskUpdated();
    onChanged();
  }

  return (
    <div className="tdp-sec stx">
      <div className="tdp-sec-h">
        하위 업무 <span className="num">{counted.length}</span>
        {counted.length > 0 && <em className="stx-done">· 완료 {done}</em>}
      </div>

      {children.length === 0 ? (
        <SectionEmpty text="하위 업무가 없어요 — 아래에 제목을 쓰고 Enter" />
      ) : (
        <div className="stx-list">
          {children.map((c) => (
            <div className={`stx-row${isDone(c) ? " done" : ""}`} key={c.id}>
              <input
                type="checkbox" className="stx-chk"
                checked={isDone(c)} disabled={busy === c.id}
                onChange={() => toggle(c)}
                aria-label={`${c.title} 완료`}
              />
              <button className="stx-t" onClick={() => openTaskPanel(c.id)} title={c.title}>{c.title}</button>
              <span className="stx-a">{c.assigneeName ?? "—"}</span>
              <span className="stx-d num">{c.dueDate?.slice(5) ?? "—"}</span>
              <span className="stx-p">
                {/* 진척 값은 서버가 준 그대로. 여기서 다시 계산하지 않는다 (28-a). */}
                <i><b style={pfill(isDone(c) ? 100 : c.progress)} /></i>
                <em className="num">{isDone(c) ? 100 : c.progress}%</em>
              </span>
            </div>
          ))}
        </div>
      )}

      {/* 세 번째 자리 — §C3 목록 위, §D2 프로젝트 상세 아래, 그리고 여기. */}
      <InlineTaskInput
        className="under"
        placeholder="하위 업무 제목을 쓰고 Enter — ⌘Enter 로 자세히"
        prefill={{ ...prefill, parentTaskId: parentId }}
        onCreated={onChanged}
      />
    </div>
  );
}
