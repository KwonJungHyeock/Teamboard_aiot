"use client";

// 월간 보고 화면 (Phase 7) — 월별 목록 + 생성 + 상세(보기/편집) + 승인 + 인쇄(PDF). lead 전용.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/types";
import ReportView, { type ReportData } from "./ReportView";
import ReportEditor from "./ReportEditor";

interface ReportListItem {
  id: number;
  year: number;
  month: number;
  status: string;
  draftStatus: string | null;
  title: string | null;
  approvedAt: string | null;
  createdAt: string;
}

interface ReportDetail {
  report: {
    id: number;
    year: number;
    month: number;
    status: string;
    draftStatus: string | null;
    title: string | null;
    notionPageId: string | null;
  };
  sections: { key: string; title: string; hint: string }[];
  data: ReportData;
  narration: Record<string, string>;
}

export default function ReportsView({ user }: { user: SessionUser }) {
  const now = new Date();
  const [list, setList] = useState<ReportListItem[]>([]);
  const [genYear, setGenYear] = useState(now.getUTCFullYear());
  const [genMonth, setGenMonth] = useState(now.getUTCMonth() + 1);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadList = useCallback(async () => {
    const res = await fetch("/api/reports");
    const data = await res.json();
    if (res.ok) setList(data.reports ?? []);
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  async function openReport(id: number) {
    setError("");
    setEditing(false);
    const res = await fetch(`/api/reports/${id}`);
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "조회 실패");
      return;
    }
    setDetail(data);
  }

  async function generate() {
    setBusy(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/reports/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: genYear, month: genMonth }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "생성 실패");
      return;
    }
    await loadList();
    await openReport(data.reportId);
    setNotice(`${genYear}년 ${genMonth}월 보고 초안이 생성되었습니다.`);
  }

  async function saveNarration(narration: Record<string, string>) {
    if (!detail) return;
    setBusy(true);
    const res = await fetch(`/api/reports/${detail.report.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ narration }),
    });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "저장 실패");
      return;
    }
    setEditing(false);
    await openReport(detail.report.id);
  }

  async function approve() {
    if (!detail) return;
    setBusy(true);
    setError("");
    const res = await fetch(`/api/reports/${detail.report.id}/approve`, { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "승인 실패");
      return;
    }
    setNotice("승인 완료 — Notion 타임라인에 기록되었습니다.");
    await loadList();
    await openReport(detail.report.id);
  }

  const canApprove = detail && detail.report.status !== "approved" && detail.report.draftStatus === "pending";

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>월간 보고</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">REPORTS</div>
            <h1>월간 보고</h1>
            <p>모든 수치는 DB 집계 값이며, 부사수는 서술만 작성합니다. 승인 시 Notion에 기록됩니다.</p>
          </div>
          <div className="rp-gen no-print">
            <select value={genYear} onChange={(e) => setGenYear(Number(e.target.value))}>
              {[now.getUTCFullYear() - 1, now.getUTCFullYear()].map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select value={genMonth} onChange={(e) => setGenMonth(Number(e.target.value))}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>
                  {m}월
                </option>
              ))}
            </select>
            <button className="gbtn" disabled={busy} onClick={generate}>
              보고서 생성
            </button>
          </div>
        </div>

        {error && <p className="gerr">{error}</p>}
        {notice && <p className="rp-notice no-print">{notice}</p>}

        <div className="rp-cols">
          <aside className="rp-side no-print">
            <div className="ch">
              <h2>월별</h2>
              <span className="sub">{list.length}건</span>
            </div>
            {list.length === 0 && <p className="gempty">생성된 보고서가 없습니다.</p>}
            {list.map((r) => (
              <button
                key={r.id}
                className={`rp-item ${detail?.report.id === r.id ? "on" : ""}`}
                onClick={() => openReport(r.id)}
              >
                <b>
                  {r.year}년 {r.month}월
                </b>
                <span className={`rp-st ${r.status}`}>{r.status === "approved" ? "승인" : "초안"}</span>
              </button>
            ))}
          </aside>

          <div className="rp-main">
            {!detail && <p className="gempty">왼쪽에서 보고서를 선택하거나 새로 생성하세요.</p>}
            {detail && (
              <>
                <div className="rp-actions no-print">
                  <span className={`rp-st ${detail.report.status}`}>
                    {detail.report.status === "approved" ? "승인됨" : "초안"}
                  </span>
                  {detail.report.status !== "approved" && (
                    <button className="gbtn mu" disabled={busy} onClick={() => setEditing((v) => !v)}>
                      {editing ? "미리보기" : "서술 편집"}
                    </button>
                  )}
                  <button className="gbtn mu" onClick={() => window.print()}>
                    PDF 인쇄
                  </button>
                  {canApprove && (
                    <button className="gbtn" disabled={busy} onClick={approve}>
                      승인 · Notion 기록
                    </button>
                  )}
                  <span className="gsp" />
                </div>
                {editing ? (
                  <>
                    <ReportEditor
                      sections={detail.sections}
                      narration={detail.narration}
                      onSave={saveNarration}
                      busy={busy}
                    />
                    <ReportView data={detail.data} narration={detail.narration} />
                  </>
                ) : (
                  <ReportView data={detail.data} narration={detail.narration} />
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
