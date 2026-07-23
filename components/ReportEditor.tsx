"use client";

// 월간 보고 편집 (Phase 7) — 서술 문단만 수정. 수치·목록(집계)은 잠겨 있어 편집 불가.
import { useState } from "react";

export default function ReportEditor({
  sections,
  narration,
  onSave,
  busy,
}: {
  sections: { key: string; title: string; hint: string }[];
  narration: Record<string, string>;
  onSave: (narration: Record<string, string>) => void;
  busy: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const s of sections) init[s.key] = narration[s.key] ?? "";
    return init;
  });

  return (
    <div className="rped">
      <p className="rped-note">서술 문단만 수정할 수 있습니다. 수치와 목록은 집계 값이라 잠겨 있습니다.</p>
      {sections.map((s) => (
        <div className="rped-r" key={s.key}>
          <label>{s.title}</label>
          <textarea
            rows={3}
            value={draft[s.key]}
            placeholder={s.hint}
            onChange={(e) => setDraft((prev) => ({ ...prev, [s.key]: e.target.value }))}
          />
        </div>
      ))}
      <div className="rped-a">
        <button className="gbtn" disabled={busy} onClick={() => onSave(draft)}>
          서술 저장
        </button>
      </div>
    </div>
  );
}
