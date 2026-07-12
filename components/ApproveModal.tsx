"use client";

// 승인 게이트 모달 — 승인 시 Notion 기록에 쓸 속성값 선택 (PRD 9장 허용값만)
import { useState } from "react";
import {
  NOTION_AREAS,
  NOTION_CATEGORIES,
  NOTION_PRIORITIES,
  NOTION_STATUSES,
  NOTION_WORK_TYPES,
} from "@/lib/types";

export interface DraftSummary {
  id: number;
  title: string;
  body: string;
  task_type: string;
  user_name?: string;
}

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
  const [category, setCategory] = useState<string>("개인 상시");
  const [workType, setWorkType] = useState<string>("개인업무");
  const [areas, setAreas] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("완료");
  const [priority, setPriority] = useState<string>("Mid");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function toggleArea(area: string) {
    setAreas((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]));
  }

  async function approve() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, workType, areas, status, priority, startDate, endDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "승인 실패");
        return;
      }
      onDone(`"${draft.title}" 승인 완료 — Notion 타임라인에 기록되었습니다.`);
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
        <p className="muted" style={{ marginBottom: 14 }}>
          <span className="badge red">{draft.task_type}</span>{" "}
          <strong style={{ color: "var(--text)" }}>{draft.title}</strong>
          {draft.user_name ? ` · 담당 ${draft.user_name}` : ""}
        </p>

        <div className="grid cols-2">
          <div className="field">
            <label>구분</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              {NOTION_CATEGORIES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>업무유형</label>
            <select value={workType} onChange={(e) => setWorkType(e.target.value)}>
              {NOTION_WORK_TYPES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>상태</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {NOTION_STATUSES.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>우선순위</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              {NOTION_PRIORITIES.map((v) => (
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

        <div className="field">
          <label>업무 구분 (미선택 시 &quot;기타&quot;)</label>
          <div className="chips">
            {NOTION_AREAS.map((area) => (
              <button
                key={area}
                type="button"
                className={`chip ${areas.includes(area) ? "on" : ""}`}
                onClick={() => toggleArea(area)}
              >
                {area}
              </button>
            ))}
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
