"use client";

// 목표 상세 슬라이드 패널 (파트 C) — 우측 480px. 업무 상세 패널과 동일 UX.
// 제목·기간·영역·소유·진척모드·연결업무·기여현황·진척바. 편집 권한은 서버가 판단(canEdit).
import { useCallback, useEffect, useState } from "react";
import { countedLabel } from "@/lib/progress";
import {
  GOAL_PANEL_EVENT,
  currentGoalParam,
  closeGoalPanel,
  notifyGoalUpdated,
} from "@/lib/goal-panel";
import GoalProjectPicker from "./GoalProjectPicker";
import GoalTrend, { type TrendPoint } from "./GoalTrend";
import HoverActions from "./HoverActions";
import { toast } from "@/lib/quick";

interface Contribution { actorId: number | null; name: string; total: number; done: number; sharePct: number }
export interface LinkedProject { id: number; name: string; colorKey: string | null; status: string; progress: number | null }
interface GoalDetail {
  goal: {
    id: number; title: string; description: string; periodType: string; periodStart: string; periodEnd: string;
    progressMode: "auto" | "manual"; progress: number | null;
    progressAuto: number | null; progressManual: number | null; countedTasks: number;
    status: GoalStatus | null; statusManual: boolean;
    scope: "team" | "personal";
    ownerName: string | null; areaId: number | null; areaName: string | null; projectName: string | null;
    /** §A4 — 남의 개인 목표라 업무 목록을 주지 않았다. 진척·건수는 그대로 온다. */
    tasksHidden?: boolean;
    /** 지시 27-2 — 상위 목표 */
    parentId: number | null;
    parentTitle: string | null;
  };
  /** 지시 27-2 — 고를 수 있는 상위 목표. 서버가 주기·스코프·순환을 이미 걸러서 준다. */
  parentCandidates?: { id: number; title: string; periodStart: string }[];
  tasks: { id: number; title: string; status: string; assigneeName: string | null; dueDate: string | null }[];
  linkedProjects: LinkedProject[];
  childCount: number;
  trend: TrendPoint[];
  contribution: Contribution[];
  canEdit: boolean;
}
type GoalStatus = "ontrack" | "risk" | "wait" | "done";
const GOAL_STATUS: Record<GoalStatus, string> = { ontrack: "온트랙", risk: "리스크", wait: "대기", done: "완료" };

const PERIOD_LABEL: Record<string, string> = { year: "연간", quarter: "분기", month: "월간" };
const STATUS_LABEL: Record<string, string> = { todo: "대기", doing: "진행", review: "리뷰", done: "완료", dropped: "중단" };

export default function GoalDetailPanel() {
  const [openId, setOpenId] = useState<number | null>(null);
  const [d, setD] = useState<GoalDetail | null>(null);
  const [err, setErr] = useState("");
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [manualVal, setManualVal] = useState("");
  const [areas, setAreas] = useState<{ id: number; name: string }[]>([]);
  const [picking, setPicking] = useState(false);   // 프로젝트 연결 팝오버 (§B1)

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
    setManualVal(data.goal.progressManual != null ? String(data.goal.progressManual) : "");
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

            {/* 진척 — 0%와 "-"(집계 대상 없음)를 반드시 구분한다 (§C·제약) */}
            <div className="gdp-prog">
              <div className="gdp-prog-t">
                <span>진척</span>
                {d.goal.progressManual != null && <span className="gdp-manual">수동</span>}
                {d.goal.status && (
                  <span className={`gdp-status st-${d.goal.status}`}>
                    {GOAL_STATUS[d.goal.status]}{d.goal.statusManual ? " · 수동" : ""}
                  </span>
                )}
                <span className="gsp" style={{ flex: 1 }} />
                <b>{d.goal.progress == null ? "집계 없음" : `${d.goal.progress}%`}</b>
                {/* 진척 근거 — 분모를 옆에 붙인다 (MD-P-2026-024 지시 1) */}
                {d.goal.progress != null && <em className="gdp-basis">{countedLabel(d.goal.countedTasks)}</em>}
              </div>
              <div className={`bar${d.goal.progress == null ? " empty" : ""}`}>
                <i className="edu" style={{ width: `${Math.min(d.goal.progress ?? 0, 100)}%` }} />
              </div>
              {d.goal.progress == null && (
                <p className="gdp-nodata">
                  집계할 대상이 없어요 — 0%가 아니라 <b>데이터 없음</b>입니다.
                  {d.canEdit && <button className="lk" onClick={() => setPicking(true)}>프로젝트를 연결하세요 →</button>}
                </p>
              )}
              {d.goal.progressManual != null && d.goal.progressAuto != null && (
                <p className="gdp-autonote">집계값은 {d.goal.progressAuto}% — 수동값이 우선 적용됩니다.</p>
              )}
            </div>

            {/* 속성 */}
            <div className="tdp-grid">
              <label>기간
                <div className="gdp-ro">{d.goal.periodStart} ~ {d.goal.periodEnd}</div>
              </label>
              <label>진척 방식
                {d.canEdit ? (
                  <select value={d.goal.progressMode} onChange={(e) => patch({ progressMode: e.target.value })}>
                    <option value="auto">자동(프로젝트·업무 집계)</option>
                    <option value="manual">수동 입력(집계보다 우선)</option>
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
              {/* 지시 27-2 — 상위 목표. 이 항목이 없어서 상위가 틀린 목표를 고치지 못하고
                  분기 레벨에 새로 만들어 중복이 남았다(판정 A). 연간 목표에는 상위가 없다. */}
              {d.goal.periodType !== "year" && (
                <label>상위 목표
                  {d.canEdit ? (
                    <select value={d.goal.parentId ?? 0}
                      onChange={(e) => patch({ parentId: Number(e.target.value) || null })}>
                      <option value={0}>상위 없음</option>
                      {(d.parentCandidates ?? []).map((c) => (
                        <option key={c.id} value={c.id}>{c.title}</option>
                      ))}
                    </select>
                  ) : <div className="gdp-ro">{d.goal.parentTitle ?? "—"}</div>}
                </label>
              )}
              <label>연결 프로젝트
                <div className="gdp-ro num">{d.linkedProjects.length}개</div>
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

            {/* 월별 추이 (MD-P-2026-011 §E) — 스냅샷이 있는 달만 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">월별 추이 <em>(최근 6개월)</em></div>
              <GoalTrend points={d.trend ?? []} />
            </div>

            {/* 연결된 프로젝트 (§B1) — 여기 진척이 곧 목표 진척의 재료다 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">
                연결된 프로젝트 <em>({d.linkedProjects.length})</em>
                {d.canEdit && (
                  <button className="lk gdp-addp" onClick={() => setPicking(true)}>＋ 프로젝트 연결</button>
                )}
              </div>
              {d.linkedProjects.length === 0 ? (
                <p className="tdp-muted">
                  연결된 프로젝트가 없습니다. 연결하면 프로젝트 진척(업무 기간 가중 평균)이 이 목표로 모입니다.
                </p>
              ) : (
                d.linkedProjects.map((p) => (
                  <div className="gdp-proj ha-host" key={p.id}>
                    <span className={`pjdot ${p.colorKey ?? "team"}`} />
                    <span className="gdp-proj-t">{p.name}</span>
                    <span className={`gdp-proj-p num${p.progress === null ? " none" : ""}`}>
                      {p.progress === null ? "–" : `${p.progress}%`}
                    </span>
                    {d.canEdit && (
                      <HoverActions more={[{
                        label: "연결 해제", danger: true,
                        onClick: async () => {
                          const res = await fetch(`/api/goals/${d.goal.id}/projects?projectId=${p.id}`, { method: "DELETE" }).catch(() => null);
                          if (!res || !res.ok) { toast("해제에 실패했어요", "err"); return; }
                          toast("연결을 해제했어요");
                          await load(d.goal.id);
                          notifyGoalUpdated();
                        },
                      }]} />
                    )}
                  </div>
                ))
              )}
              {d.linkedProjects.some((p) => p.progress === null) && (
                <p className="tdp-muted" style={{ marginTop: 6 }}>
                  진척이 “–”인 프로젝트는 업무가 없어 평균 분모에서 빠집니다.
                </p>
              )}
              {d.childCount > 0 && d.linkedProjects.length > 0 && (
                <p className="gdp-warn">
                  이 목표에는 하위 목표가 {d.childCount}개 있어 진척은 <b>하위 평균</b>으로 계산됩니다.
                  위 프로젝트는 집계에 반영되지 않습니다.
                </p>
              )}
            </div>

            {/* 연결 업무 (월 목표) */}
            {d.goal.periodType === "month" && (
              <div className="tdp-sec">
                <div className="tdp-sec-h">
                  연결 업무 <em>({d.goal.tasksHidden ? d.goal.countedTasks : d.tasks.length})</em>
                </div>
                {/* §A4 — 팀장은 개인 목표의 진척(숫자)까지만 본다.
                    비어 있는 게 아니라 **안 보이는 것**이라고 말해야 오해가 없다. */}
                {d.goal.tasksHidden ? (
                  <p className="tdp-muted">
                    개인 목표입니다. 진척과 집계 건수는 보이지만 업무 목록은 열리지 않습니다.
                  </p>
                ) : d.tasks.length === 0 ? (
                  <p className="tdp-muted">연결된 업무가 없습니다. 업무 상세의 "연결 목표"에서 이 목표를 선택하세요.</p>
                ) : null}
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
        {picking && d && (
          <GoalProjectPicker
            goalId={d.goal.id}
            onClose={() => setPicking(false)}
            onLinked={async () => { setPicking(false); await load(d.goal.id); notifyGoalUpdated(); }}
          />
        )}
      </aside>
    </>
  );
}
