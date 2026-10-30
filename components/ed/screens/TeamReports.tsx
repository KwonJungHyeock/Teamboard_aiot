"use client";

// 「보고」 목록 — 월간 · 분기 · 연간 탭, 기간별 카드(작성중 · 확정 · PDF). 만들기는 팀장.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, Seg, useToast } from "../ui";
import { fileUrl } from "../report/Pages";
import { todayKst } from "@/lib/ed/core";

type Kind = "month" | "quarter" | "year";
interface Row { id: number; kind: Kind; start: string; label: string; title: string; status: "draft" | "final"; pdf: boolean; items: number; updatedAt: string;
  counts: { total: number; done: number; doing: number; todo: number } | null }

export default function TeamReports() {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("month");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const today = todayKst();
  const [pick, setPick] = useState(today.slice(0, 7));
  const [toast, showToast] = useToast();
  const load = useCallback(async () => {
    const d = await api<{ reports: Row[]; canEdit: boolean }>(`/api/team-reports?kind=${kind}`).catch(() => null);
    setRows(d?.reports ?? []); setCanEdit(!!d?.canEdit);
  }, [kind]);
  useEffect(() => { void load(); }, [load]);

  const years = Array.from({ length: 3 }, (_, i) => String(Number(today.slice(0, 4)) - 1 + i));
  const create = async () => {
    const start = kind === "month" ? `${pick}-01` : kind === "quarter" ? `${pick.slice(0, 4)}-${String((Number(pick.slice(6)) - 1) * 3 + 1).padStart(2, "0")}-01` : `${pick.slice(0, 4)}-01-01`;
    try { const r = await api<{ id: number }>("/api/team-reports", { method: "POST", body: { kind, periodStart: start } }); router.push(`/v3/reports/${r.id}`); }
    catch (e) { showToast(e instanceof Error ? e.message : "만들지 못했습니다"); }
  };
  const setK = (k: Kind) => {
    setKind(k);
    setPick(k === "month" ? today.slice(0, 7) : k === "quarter" ? `${today.slice(0, 4)}-Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}` : today.slice(0, 4));
  };

  return (
    <div className="ed-page trp">
      <div className="trp-top">
        <h1 className="ed-h1">보고</h1>
        <Seg value={kind} onChange={setK} options={[{ v: "month", label: "월간" }, { v: "quarter", label: "분기" }, { v: "year", label: "연간" }]} />
      </div>
      {canEdit && (
        <div className="trp-new">
          {kind === "month" && <input className="ed-input" type="month" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 170 }} />}
          {kind === "quarter" && (
            <select className="ed-input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 170 }}>
              {years.flatMap((y) => [1, 2, 3, 4].map((q) => <option key={`${y}-${q}`} value={`${y}-Q${q}`}>{y}년 {q}분기</option>))}
            </select>
          )}
          {kind === "year" && <select className="ed-input" value={pick} onChange={(e) => setPick(e.target.value)} style={{ width: 170 }}>{years.map((y) => <option key={y} value={y}>{y}년</option>)}</select>}
          <button type="button" className="ed-btn pri" onClick={() => void create()}>보고 만들기</button>
          <span className="trp-hint">같은 기간 보고가 있으면 그 보고를 엽니다.</span>
        </div>
      )}
      {rows === null ? <div className="ed-empty">불러오는 중</div> : rows.length === 0 ? <div className="ed-empty">{canEdit ? "아직 보고가 없습니다 — 기간을 고르고 「보고 만들기」" : "아직 보고가 없습니다"}</div> : (
        <div className="trp-cards">
          {rows.map((r) => (
            <div key={r.id} className="trp-card">
              <Link href={`/v3/reports/${r.id}`} style={{ color: "inherit", textDecoration: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                <div className="trp-row"><span className={`trp-st${r.status === "final" ? " final" : ""}`}>{r.status === "final" ? "확정" : "작성중"}</span><small>{r.label}</small></div>
                <b>{r.title}</b>
                <div className="n">{r.counts ? <><span>업무 {r.counts.total}</span><span>완료 {r.counts.done}</span></> : <span>숫자는 확정 때 굳습니다</span>}<span>상세 {r.items}건</span></div>
              </Link>
              {r.pdf && <a className="ed-btn sm" style={{ alignSelf: "flex-start" }} href={`/api/team-reports/${r.id}/pdf`}>PDF 받기</a>}
            </div>
          ))}
        </div>
      )}
      {toast}
    </div>
  );
}
export { fileUrl };
