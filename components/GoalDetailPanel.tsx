"use client";

// 목표 상세 슬라이드 패널 (파트 C) — 우측 480px. 업무 상세 패널과 동일 UX.
// 제목·기간·영역·소유·진척모드·연결업무·기여현황·진척바. 편집 권한은 서버가 판단(canEdit).
import { useCallback, useEffect, useState } from "react";
import {
  GOAL_PANEL_EVENT,
  currentGoalParam,
  closeGoalPanel,
  notifyGoalUpdated,
} from "@/lib/goal-panel";

interface Contribution { actorId: number | null; name: string; total: number; done: number; sharePct: number }
interface GoalDetail {
  goal: {
    id: number; title: string; description: string; periodType: string; periodStart: string; periodEnd: string;
    progressMode: "auto" | "manual"; progress: number | null; scope: "team" | "personal";
    ownerName: string | null; areaId: number | null; areaName: string | null; projectName: string | null;
  };
  tasks: { id: number; title: string; status: string; assigneeName: string | null; dueDate: string | null }[];
  contribution: Contribution[];
  canEdit: boolean;
}

const PERIOD_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월간" };
const STATUS_LABEL: Record<string, string> = { todo: "대기", doing: "진행", review: "리뷰", done: "완료", dropped: "중단" };

export default function GoalDetailPanel() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [d, setD] = useState<GoalDetail | null>(null);
  const [err, setErr] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [manualVal, setManualVal] = useState("");
  const [areas, setAreas] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/meta/selectors").then((r) => r.json()).then((s) => setAreas(s.areas ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setOpenId(currentGoalParam());
    sync();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setOpenId(typeof detail === "number" ? detail : detail === null ? null : currentGoalParam());
    };
    window.addEventListener(GOAL_PANEL_EVENT, onEvent);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(GOAL_PANEL_EVENT, onEvent);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const load = useCallback(async (id: number) => {
    setErr("");
    const res = await fetch(`/api/goals/${id}`);
    if (!res.ok) { setErr((await res.json()).error ?? "불러올 수 없습니다."); setD(null); return; }
    const data: GoalDetail = await res.json();
    setD(data);
    setManualVal(data.goal.progress != null ? String(data.goal.progress) : "");
  }, []);

  useEffect(() => { if (openId != null) load(openId); else setD(null); }, [openId, load]);

  useEffect(() => {
    if (openId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeGoalPanel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  async function patch(fields: Record<string, unknown>) {
    if (openId == null) return;
    setSave("saving"); setErr("");
    const res = await fetch(`/api/goals/${openId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    if (!res.ok) { setErr((await res.json()).error ?? "저장 실패"); setSave("idle"); return; }
    setSave("saved"); setTimeout(() => setSave("idle"), 1200);
    await load(openId);
    notifyGoalUpdated();
  }

  if (openId == null) return null;

  return (
    <>
      <div className="tdp-backdrop" onClick={() => closeGoalPanel()} />
      <aside className="tdp" role="dialog" aria-label="목표 상세">
        <div className="tdp-head">
          <span className="tdp-crumb">
            목표 상세 {d ? `· ${PERIOD_LABEL[d.goal.periodType] ?? d.goal.periodType}` : ""}
            {d?.goal.scope === "personal" ? " · 개인" : d ? " · 팀" : ""}
          </span>
          <span className={`tdp-save ${save}`}>{save === "saving" ? "저장 중…" : save === "saved" ? "저장됨" : ""}</span>
          <button className="tdp-x" onClick={() => closeGoalPanel()} aria-label="닫기">✕</button>
        </div>

        {!d && !err && <div className="tdp-body"><p className="tdp-muted">불러오는 중…</p></div>}
        {err && !d && <div className="tdp-body"><p className="tdp-err">{err}</p></div>}

        {d && (
          <div className="tdp-body">
            {err && <p className="tdp-err">{err}</p>}
            {d.canEdit ? (
              <input className="tdp-title" defaultValue={d.goal.title} key={`t-${d.goal.id}`}
                onBlur={(e) => { if (e.target.value.trim() && e.target.value !== d.goal.title) patch({ title: e.target.value.trim() }); }} />
            ) : (
              <h2 className="tdp-title" style={{ border: 0 }}>{d.goal.title}</h2>
            )}

            {/* 진척 바 */}
            <div className="gdp-prog">
              <div className="gdp-prog-t">
                <span>진척</span>
                <b>{d.goal.progress == null ? "–" : `${d.goal.progress}%`}</b>
              </div>
              <div className="bar"><i className="edu" style={{ width: `${Math.min(d.goal.progress ?? 0, 100)}%` }} /></div>
            </div>

            {/* 속성 */}
            <div className="tdp-grid">
              <label>기간
                <div className="gdp-ro">{d.goal.periodStart} ~ {d.goal.periodEnd}</div>
              </label>
              <label>진척 방식
                {d.canEdit ? (
                  <select value={d.goal.progressMode} onChange={(e) => patch({ progressMode: e.target.value })}>
                    <option value="auto">자동(업무 완료율)</option>
                    <option value="manual">수동 입력</option>
                  </select>
                ) : <div className="gdp-ro">{d.goal.progressMode === "manual" ? "수동" : "자동"}</div>}
              </label>
              <label>{d.goal.scope === "personal" ? "소유" : "영역"}
                {d.goal.scope === "team" && d.canEdit ? (
                  <select value={d.goal.areaId ?? 0} onChange={(e) => patch({ areaId: Number(e.target.value) || null })}>
                    <option value={0}>영역 없음</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : (
                  <div className="gdp-ro">{d.goal.scope === "personal" ? (d.goal.ownerName ?? "본인") : (d.goal.areaName ?? "—")}</div>
                )}
              </label>
              <label>연결 프로젝트
                <div className="gdp-ro">{d.goal.projectName ?? "—"}</div>
              </label>
            </div>

            {/* 수동 진척 입력 */}
            {d.canEdit && d.goal.progressMode === "manual" && (
              <div className="tdp-sec">
                <div className="tdp-sec-h">수동 진척 (%)</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input type="number" min={0} max={100} value={manualVal}
                    onChange={(e) => setManualVal(e.target.value)} style={{ width: 100 }} className="gdp-num" />
                  <button className="btn small primary" onClick={() => patch({ progress: Number(manualVal) || 0 })}>적용</button>
                </div>
              </div>
            )}

            {/* 연결 업무 (월 목표) */}
            {d.goal.periodType === "month" && (
              <div className="tdp-sec">
                <div className="tdp-sec-h">연결 업무 <em>({d.tasks.length})</em></div>
                {d.tasks.length === 0 && <p className="tdp-muted">연결된 업무가 없습니다. 업무 상세의 "연결 목표"에서 이 목표를 선택하세요.</p>}
                {d.tasks.map((t) => (
                  <div className="gdp-task" key={t.id}>
                    <span className={`gdp-st st-${t.status}`}>{STATUS_LABEL[t.status] ?? t.status}</span>
                    <span className="gdp-task-t">{t.title}</span>
                    <em>{t.assigneeName ?? "미지정"}</em>
                  </div>
                ))}
              </div>
            )}

            {/* 기여도 (팀 목표) — 전체 연결 업무 중 담당 비중. 개별 완료율과 구분. */}
            {d.goal.scope === "team" && d.contribution.length > 0 && (
              <div className="tdp-sec">
                <div className="tdp-sec-h">기여도 <em>(전체 연결 업무 중 담당 비중)</em></div>
                {d.contribution.map((c) => (
                  <div className="gdp-contrib" key={c.actorId ?? "none"}>
                    <span className="gdp-contrib-n">{c.name}</span>
                    <span className="gdp-contrib-m">담당 {c.total} · 완료 {c.done}</span>
                    <div className="bar" style={{ flex: 1 }}><i className="play" style={{ width: `${c.sharePct}%` }} /></div>
                    <b>{c.sharePct}%</b>
                  </div>
                ))}
                <p className="tdp-muted" style={{ marginTop: 6 }}>
                  기여도 = 담당(연결) 업무 수 ÷ 전체 연결 업무 수. 합계 100%. 개별 완료율(완료÷담당)과는 다릅니다.
                </p>
              </div>
            )}

            {/* 설명 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">설명</div>
              {d.canEdit ? (
                <textarea className="tdp-desc" rows={3} defaultValue={d.goal.description} key={`d-${d.goal.id}`}
                  placeholder="목표 설명…" onBlur={(e) => { if (e.target.value !== d.goal.description) patch({ description: e.target.value }); }} />
              ) : (
                <p className="tdp-muted" style={{ whiteSpace: "pre-wrap" }}>{d.goal.description || "설명이 없습니다."}</p>
              )}
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
