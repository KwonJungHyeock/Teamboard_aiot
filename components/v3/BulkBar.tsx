"use client";

// v3 「업무」 — 작업 줄과 결과 줄 (MD-P-2026-057 §B).
//
// ── 안 사라진다 ────────────────────────────────────────────────────
//
// 결과 줄은 몇 초 뒤에 스스로 없어지지 않는다. 닫기를 눌러야 없어진다
// (047 §B 와 같은 결). 열아홉 건을 바꾼 사람이 자리를 비운 사이 사라지면,
// 돌아와서 무엇이 바뀌었는지도 되돌릴 방법도 없다.
//
// ── 되돌리기는 결과 줄에만 있다 ────────────────────────────────────
//
// 작업 줄에 두면 「무엇을 되돌리는가」가 안 보인다. 바꾼 직후 그 자리에 서고,
// 그 한 번의 바꾸기만 되돌린다.
import { useState } from "react";
import { Button } from "./parts";
import {
  BULK_STATUS, resultNote, failLines, selectionNote, progressNote,
  type BulkChange, type BulkResult,
} from "@/lib/v3/bulk";

interface Person { id: number; name: string }

export function BulkBar({
  n, people, busy, sent, total, onChange, onClear,
}: {
  n: number;
  people: Person[];
  busy: boolean;
  sent: number;
  total: number;
  onChange: (c: BulkChange) => void;
  onClear: () => void;
}) {
  const [due, setDue] = useState("");
  // 아무것도 안 골랐으면 **작업 줄이 아예 없다**(지시 §B ⑤). 흐리게 두면
  // 「고르면 되는구나」가 아니라 「고장났나」로 읽힌다.
  if (n === 0) return null;
  return (
    <div className="v3-bulk" role="group" aria-label="고른 업무 한 번에 고치기">
      <b className="v3-bulk-n">{selectionNote(n)}</b>

      <label className="v3-bulk-f">
        <span>상태</span>
        <select disabled={busy} value=""
                onChange={(e) => { if (e.target.value) onChange({ field: "status", value: e.target.value }); }}>
          <option value="">▾</option>
          {BULK_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </label>

      <label className="v3-bulk-f">
        <span>담당</span>
        <select disabled={busy} value=""
                onChange={(e) => {
                  if (e.target.value === "") return;
                  onChange({ field: "assignee", value: e.target.value === "none" ? null : Number(e.target.value) });
                }}>
          <option value="">▾</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          {/* 담당을 **뗄 수 있다.** PATCH 가 falsy 를 null 로 받는다(046 §B-1). */}
          <option value="none">담당 없음</option>
        </select>
      </label>

      <span className="v3-bulk-f">
        <span>기한</span>
        <input type="date" value={due} disabled={busy} aria-label="기한"
               onChange={(e) => {
                 setDue(e.target.value);
                 if (e.target.value) onChange({ field: "due", value: e.target.value });
               }} />
        {/* 기한을 **지우는 길**. 날짜 칸을 비우는 것만으로는 뜻이 안 통한다 —
            「아직 안 골랐다」와 「없애겠다」가 같은 모양이 된다. */}
        <Button className="v3-btn-s" disabled={busy}
                onClick={() => { setDue(""); onChange({ field: "due", value: null }); }}>
          기한 지우기
        </Button>
      </span>

      {busy
        ? <span className="v3-bulk-p" role="status">{progressNote(sent, total)}</span>
        : <Button className="v3-btn-s v3-bulk-x" onClick={onClear}>선택 해제</Button>}
    </div>
  );
}

export function BulkResultBar({
  r, busy, onUndo, onClose,
}: { r: BulkResult; busy: boolean; onUndo: () => void; onClose: () => void }) {
  const lines = failLines(r);
  return (
    <div className={`v3-bulkr${r.failed.length > 0 ? " bad" : ""}`} role="status">
      <span className="v3-bulkr-t">{resultNote(r)}</span>
      {/* 실패는 **건수와 사유를 같이** 적는다. 건수만 적으면 다음에 무엇을
          해야 할지 모르고, 사유만 적으면 몇 건인지 모른다. */}
      {lines.map((l) => <span key={l} className="v3-bulkr-why">{l}</span>)}
      {r.done.length > 0 && (
        <Button className="v3-btn-s" disabled={busy} onClick={onUndo}>되돌리기</Button>
      )}
      {/* 안 사라지므로 닫는 길이 반드시 있어야 한다. */}
      <Button className="v3-btn-s v3-bulkr-x" onClick={onClose} aria-label="알림 닫기">닫기</Button>
    </div>
  );
}
