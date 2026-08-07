"use client";

// 월간 보고 화면 — 두 갈래를 한 메뉴에서 (MD-P-2026-010 §범위: 신규 메뉴 생성 금지)
//   [성과 리포트] 월별 PDF (전원)  ·  [승인 보고서] 기존 서술·승인·Notion 흐름 (팀장)
import { useCallback, useEffect, useState } from "react";
import PageShell from "./PageShell";
import ReportView, { type ReportData } from "./ReportView";
import ReportEditor from "./ReportEditor";
import PerfReport from "./PerfReport";
import EmptyState from "./EmptyState";
import SectionEmpty from "./SectionEmpty";
import Skeleton from "./Skeleton";
import ErrorNote from "./ErrorNote";
import type { SessionUser } from "@/lib/types";

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

export default function ReportsView({ user, notionConnected = true }: { user: SessionUser; notionConnected?: boolean }) {
  const isLead = user.role === "lead";
  const [mainTab, setMainTab] = useState<"perf" | "approval">("perf");
  const now = new Date();
  const [list, setList] = useState<ReportListItem[]>([]);
  const [genYear, setGenYear] = useState(now.getUTCFullYear());
  const [genMonth, setGenMonth] = useState(now.getUTCMonth() + 1);
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // 첫 목록이 오기 전 빈 상태를 띄우면 "보고서가 없다"고 잘못 말하게 된다 (§A-4)
  const [listLoading, setListLoading] = useState(true);

  const loadList = useCallback(async () => {
    const res = await fetch("/api/reports").catch(() => null);
    if (res && res.ok) setList((await res.json()).reports ?? []);
    setListLoading(false);
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
    setNotice(notionConnected ? "승인 완료 — Notion 타임라인에 기록되었습니다." : "승인 완료 — 저장되었습니다.");
    await loadList();
    await openReport(detail.report.id);
  }

  const canApprove = detail && detail.report.status !== "approved" && detail.report.draftStatus === "pending";

  return (
    <PageShell
      crumb={["워크스페이스", "월간 보고"]}
      title="월간 보고"
      subtitle={<>{mainTab === "perf" ? "월별 성과를 그대로 인쇄해 PDF로 저장합니다. 화면에 보이는 그대로 출력됩니다." : "모든 수치는 DB 집계 값이며, 에이전트는 서술만 작성합니다. 승인 시 " + (notionConnected ? "Notion에 기록됩니다." : "확정됩니다.")}</>}
      tabs={isLead ? [{ key: "perf", label: "성과 리포트" }, { key: "approval", label: "승인 보고서" }] : undefined}
      activeTab={mainTab}
      onTab={(k) => setMainTab(k as "perf" | "approval")}
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        {mainTab === "perf" && <PerfReport user={user} />}

        {mainTab === "approval" && isLead && (
        <>
        {error && <ErrorNote message={error} />}
        {notice && <p className="rp-notice no-print">{notice}</p>}

        {listLoading && <Skeleton variant="page" />}

        {/* A-b — 좌우 분할은 **고를 것이 있을 때만** 그린다 (MD-P-2026-026 §A).
            보고서가 0건이면 좌측 "생성된 보고서가 없습니다" 와
            우측 "왼쪽에서 보고서를 선택하세요" 가 동시에 떴다.
            생성기는 빈 상태 안으로 들여온다 — 여기서 할 수 있는 유일한 일이다. */}
        {!listLoading && list.length === 0 ? (
          <EmptyState
            icon="handover"
            title="아직 생성된 보고서가 없어요"
            hint="연·월을 고르고 생성하면 그 달의 목표·완료 업무·결정·리스크가 DB 집계값으로 채워집니다. 서술만 손으로 다듬어 승인하세요."
            action={
              <div className="rp-gen">
                <select aria-label="연도" value={genYear} onChange={(e) => setGenYear(Number(e.target.value))}>
                  {[now.getUTCFullYear() - 1, now.getUTCFullYear()].map((y) => (
                    <option key={y} value={y}>{y}년</option>
                  ))}
                </select>
                <select aria-label="월" value={genMonth} onChange={(e) => setGenMonth(Number(e.target.value))}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                    <option key={m} value={m}>{m}월</option>
                  ))}
                </select>
                <button className="btn-primary" disabled={busy} onClick={generate}>보고서 생성</button>
              </div>
            }
          />
        ) : !listLoading ? (
        <div className="rp-cols">
          <aside className="rp-side no-print">
            <div className="ch">
              <h2>월별 보고서</h2>
              <span className="sub">{list.length}건</span>
            </div>
            {/* 생성기 — 연·월 선택 + 생성 버튼 (조작 대상이 명확하도록 목록 패널로 이동) */}
            <div className="rp-gen">
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
              <button className="btn-brand" disabled={busy} onClick={generate}>
                보고서 생성
              </button>
            </div>
            {list.map((r) => (
              <button
                key={r.id}
                className={`rp-item ${detail?.report.id === r.id ? "on" : ""}`}
                onClick={() => openReport(r.id)}
              >
                <b>
                  {r.year}년 {r.month}월
                </b>
                <span className="gsp" />
                {r.approvedAt && <em className="rp-by">{r.approvedAt.slice(0, 10)}</em>}
                <span className={`rp-st ${r.status}`}>{r.status === "approved" ? "승인" : "초안"}</span>
              </button>
            ))}
          </aside>

          <div className="rp-main">
            {!detail && (
              <SectionEmpty text="왼쪽에서 보고서를 고르거나 위에서 새로 생성하세요" />
            )}
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
                  <a className="gbtn mu" href={`/api/reports/${detail.report.id}/pptx`}>
                    PPTX 내보내기
                  </a>
                  {canApprove && (
                    <button className="gbtn" disabled={busy} onClick={approve}>
                      {notionConnected ? "승인 · Notion 기록" : "승인 · 확정"}
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
        ) : null}
        </>
        )}
      </div>
    </div>
    </PageShell>
  );
}
