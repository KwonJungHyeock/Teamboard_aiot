"use client";

// 승인 게이트 모달 — 승인 시 Notion 기록에 쓸 속성값 선택.
// 선택지는 /api/notion/schema(캐시·폴백)에서 동적 로드. 실패 시 하드코딩 폴백.
// 실제 Notion 스키마 반영: "구분" 없음, "업무 구분"은 단일 select, "상태"는 status.
import { useEffect, useMemo, useState } from "react";
import {
  NOTION_WORK_AREAS,
  NOTION_PRIORITIES,
  NOTION_STATUSES,
  NOTION_WORK_TYPES,
} from "@/lib/types";
import { applyAreaPrefix } from "@/lib/notion-schema";

export interface DraftSummary {
  id: number;
  title: string;
  body: string;
  task_type: string;
  user_name?: string;
}

interface Options {
  workArea: string[];
  workType: string[];
  status: string[];
  priority: string[];
}

const FALLBACK: Options = {
  workArea: [...NOTION_WORK_AREAS],
  workType: [...NOTION_WORK_TYPES],
  status: [...NOTION_STATUSES],
  priority: [...NOTION_PRIORITIES],
};

export default function ApproveModal({
  draft,
  onClose,
  onDone,
}: {
  draft: DraftSummary;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [options, setOptions] = useState<Options>(FALLBACK);
  const [workArea, setWorkArea] = useState<string>("기타");
  const [workType, setWorkType] = useState<string>("개인업무");
  const [status, setStatus] = useState<string>("진행"); // 승인 = 업무 시작 → 기본 진행
  const [priority, setPriority] = useState<string>("Mid");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // 선택지 동적 로드 (캐시/폴백)
  useEffect(() => {
    fetch("/api/notion/schema")
      .then((r) => r.json())
      .then((d) => {
        if (d?.options) setOptions({ ...FALLBACK, ...d.options });
      })
      .catch(() => {});
  }, []);

  // 업무명 최종 형태 미리보기 ([업무구분] 접두어, 중복 방지)
  const finalTitle = useMemo(() => applyAreaPrefix(draft.title, workArea), [draft.title, workArea]);

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workArea, workType, status, priority, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "승인 실패");
        return;
      }
      onDone(`"${finalTitle}" 승인 완료 — Notion 타임라인에 기록되었습니다.`);
    } catch {
      setError("서버에 연결할 수 없습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>승인 → Notion 타임라인 기록</h3>
        <p className="muted" style={{ marginBottom: 10 }}>
          <span className="badge red">{draft.task_type}</span>{" "}
          {draft.user_name ? `담당 ${draft.user_name}` : ""}
        </p>

        {/* 최종 업무명 미리보기 — 사용자가 확인 후 승인 */}
        <div className="field">
          <label>Notion 업무명 (미리보기)</label>
          <div
            style={{
              padding: "9px 12px",
              background: "var(--surface-2, rgba(255,255,255,.04))",
              border: "1px solid var(--line, #23252c)",
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            {finalTitle}
          </div>
        </div>

        <div className="grid cols-2">
          <div className="field">
            <label>업무 구분</label>
            <select value={workArea} onChange={(e) => setWorkArea(e.target.value)}>
              {options.workArea.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>업무유형</label>
            <select value={workType} onChange={(e) => setWorkType(e.target.value)}>
              {options.workType.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>상태</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {options.status.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>우선순위</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {options.priority.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>시작일</label>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="field">
            <label>종료일</label>
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {error && <p className="error-text">{error}</p>}
        <div className="actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>
            취소
          </button>
          <button className="btn primary" onClick={approve} disabled={busy}>
            {busy ? "기록 중..." : "승인하고 Notion에 기록"}
          </button>
        </div>
      </div>
    </div>
  );
}
