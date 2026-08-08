"use client";

// 목표 상세 슬라이드 패널 (파트 C) — 우측 480px. 업무 상세 패널과 동일 UX.
// 제목·기간·영역·소유·진척모드·연결업무·기여현황·진척바. 편집 권한은 서버가 판단(canEdit).
import { useCallback, useEffect, useState } from "react";
import { basisLabel } from "@/lib/progress";
import { GOAL_PANEL_EVENT, closeGoalPanel, currentGoalRef, notifyGoalUpdated, openGoalFull } from "@/lib/goal-panel";
import GoalTrend, { type TrendPoint } from "./GoalTrend";
import { toast } from "@/lib/quick";
import SectionEmpty from "./SectionEmpty";
import Skeleton from "./Skeleton";
import { pfill } from "@/lib/progress-bar";

interface Contribution { actorId: number | null; name: string; total: number; done: number; sharePct: number }
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
    parentSource: string;
  };
  /** 지시 27-2 — 고를 수 있는 상위 목표. 서버가 주기·스코프·순환을 이미 걸러서 준다. */
  parentCandidates?: { id: number; title: string; periodStart: string }[];
  tasks: { id: number; title: string; status: string; assigneeName: string | null; dueDate: string | null }[];
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
  const [full, setFull] = useState(false);          // §C2 확대 모달 여부
  const [d, setD] = useState<GoalDetail | null>(null);
  const [err, setErr] = useState("");
  // §D2 — 저장 상태를 상시 표시한다. 자동저장인데 아무 표시가 없어서
  // 저장됐는지도, 닫아도 되는지도 알 수 없었다.
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [lastFields, setLastFields] = useState<Record<string, unknown> | null>(null);
  const [manualVal, setManualVal] = useState("");
  const [areas, setAreas] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/meta/selectors").then((r) => r.json()).then((s) => setAreas(s.areas ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => { const r = currentGoalRef(); setOpenId(r?.id ?? null); setFull(!!r?.full); };
    sync();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") { setOpenId(detail.id); setFull(!!detail.full); }
      else if (detail === null) { setOpenId(null); setFull(false); }
      else sync();
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
    setLastFields(fields);
    setSave("saving"); setErr("");
    const res = await fetch(`/api/goals/${openId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    if (!res.ok) {
      // §D2 — 조용히 넘어가지 않는다. 그 자리에 실패를 남기고 다시 시도할 수단을 준다.
      setErr((await res.json().catch(() => ({}))).error ?? "저장 실패");
      setSave("failed");
      return;
    }
    const body = await res.json().catch(() => null);
    setSave("saved"); setSavedAt(Date.now());
    await load(openId);
    notifyGoalUpdated();
    // §A4 — 기간을 바꿔 상위가 옮겨졌으면 한 줄로 알린다.
    if (body?.moved) toast(`${body.moved.fromTitle ?? "상위 없음"} → ${body.moved.toTitle ?? "상위 없음"} 로 옮겨졌습니다`);
  }

  /** §D2 저장 상태 문구 — "방금" 은 시각이 아니라 사람 말이다. */
  function saveLabel(): string {
    if (save === "saving") return "저장 중…";
    if (save === "failed") return "저장 실패";
    if (save === "saved" && savedAt) {
      const s = Math.round((Date.now() - savedAt) / 1000);
      return s < 60 ? "저장됨 · 방금" : `저장됨 · ${Math.round(s / 60)}분 전`;
    }
    return "";
  }

  if (openId == null) return null;

  return (
    <>
      <div className={`tdp-backdrop${full ? " full" : ""}`} onClick={() => closeGoalPanel()} />
      {/* §C2 — 컨테이너만 바뀐다. 내용은 아래 하나뿐이다. 복제하지 않는다. */}
      <aside className={`tdp gdp${full ? " gdp-full" : ""}`} role="dialog" aria-modal={full} aria-label="목표 상세">
        <div className="tdp-head">
          <span className="tdp-crumb">
            목표 상세 {d ? `· ${PERIOD_LABEL[d.goal.periodType] ?? d.goal.periodType}` : ""}
            {d?.goal.scope === "personal" ? " · 개인" : d ? " · 팀" : ""}
          </span>
          <span className="gsp" />
          {/* §D2 — 상시 표시. 실패하면 그 자리에서 다시 시도한다. */}
          <span className={`tdp-save ${save}`}>
            {saveLabel()}
            {save === "failed" && lastFields && (
              <button className="lk gdp-retry" onClick={() => patch(lastFields)}>다시 시도</button>
            )}
          </span>
          {/* §C2 확대 — 모달에서는 되돌리는 버튼을 두지 않는다. 닫으면 그대로 닫힌다. */}
          {!full && openId != null && (
            <button className="tdp-x gdp-zoom" onClick={() => openGoalFull(openId)} aria-label="크게 보기" title="크게 보기">⤢</button>
          )}
          {/* §D1 — 항상 있고, 전보다 크고 눈에 띈다 */}
          <button className="tdp-x gdp-close" onClick={() => closeGoalPanel()} aria-label="닫기" title="닫기 (Esc)">✕</button>
        </div>

        {!d && !err && <div className="tdp-body"><Skeleton variant="page" rows={3} /></div>}
        {err && !d && <div className="tdp-body"><p className="tdp-err">{err}</p></div>}

        {d && (
          <div className="tdp-body">
            {err && <p className="tdp-err">{err}</p>}
            {d.canEdit ? (
              <InlineTitle key={`t-${d.goal.id}`} value={d.goal.title} onSave={(v) => patch({ title: v })} />
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
                {d.goal.progress != null && <em className="gdp-basis">{basisLabel(d.goal.countedTasks)}</em>}
              </div>
              <div className={`bar${d.goal.progress == null ? " empty" : ""}`}>
                <i className="edu" style={pfill(d.goal.progress ?? 0)} />
              </div>
              {d.goal.progress == null && (
                <p className="gdp-nodata">
                  집계할 대상이 없어요 — 0%가 아니라 <b>데이터 없음</b>입니다.
                  {/* MD-P-2026-030 §A1 — 목표에 붙는 것은 업무뿐이다.
                      예전에는 여기서 "프로젝트를 연결하세요"라고 했다. 그 경로는 없앴다. */}
                  {d.canEdit && d.goal.periodType === "month" && (
                    <span className="gdp-nodata-h">아래 <b>연결 업무</b>에서 이 목표에 업무를 붙이세요.</span>
                  )}
                  {d.canEdit && d.goal.periodType !== "month" && (
                    <span className="gdp-nodata-h">하위 월 목표에 업무를 붙이면 여기로 모입니다.</span>
                  )}
                </p>
              )}
              {d.goal.progressManual != null && d.goal.progressAuto != null && (
                <p className="gdp-autonote">집계값은 {d.goal.progressAuto}% — 수동값이 우선 적용됩니다.</p>
              )}
            </div>

            {/* 속성 */}
            {/* §A5 — 수동 상위 지정은 없애지 않고 숨긴다. 기본 닫힘.
                여기서 지정하면 기간을 바꿔도 따라가지 않는다 (A-신1-6). */}
            <AdvancedParent goal={d.goal} canEdit={d.canEdit} onPatch={patch} />

            <div className="tdp-grid">
              <label>기간
                <div className="gdp-ro">{d.goal.periodStart} ~ {d.goal.periodEnd}</div>
              </label>
              <label>진척 방식
                {d.canEdit ? (
                  <select value={d.goal.progressMode} onChange={(e) => patch({ progressMode: e.target.value })}>
                    <option value="auto">자동 (연결된 업무 집계)</option>
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
              <label>집계 대상 업무
                <div className="gdp-ro num">{d.goal.countedTasks}건</div>
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

            {/* 연결된 프로젝트 섹션은 MD-P-2026-030 §A1 에서 없앴다.
                목표에 붙는 것은 업무뿐이다 — 경로가 둘이면 같은 질문에 두 답이 나온다. */}

            {/* 하위 목표가 있으면 진척이 어디서 오는지 한 줄로 밝힌다.
                "월 목표에 업무를 붙였는데 왜 분기에 안 뜨지?"를 여기서 막는다. */}
            {d.childCount > 0 && (
              <p className="gdp-warn">
                이 목표에는 하위 목표가 {d.childCount}개 있습니다.
                진척은 하위 목표까지 포함한 <b>서브트리 전체의 연결 업무</b> 평균입니다.
              </p>
            )}

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
                  <SectionEmpty text={'연결된 업무가 없어요 — 업무 상세의 "연결 목표"에서 이 목표를 선택하세요'} />
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
                    <div className="bar" style={{ flex: 1 }}><i className="play" style={pfill(c.sharePct)} /></div>
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

/**
 * §D3 인라인 편집 — Enter 확정 · Esc 취소 · 포커스가 빠지면 저장.
 * 편집 중에는 오른쪽에 확정(✓)·취소(✕)를 노출한다.
 * 키보드를 모르는 사람에게 확정 수단이 **하나는 보여야** 한다.
 */
function InlineTitle({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const [editing, setEditing] = useState(false);
  const commit = () => {
    const t = v.trim();
    setEditing(false);
    if (t && t !== value) onSave(t); else setV(value);
  };
  const cancel = () => { setV(value); setEditing(false); };
  return (
    <span className={`gdp-inline${editing ? " on" : ""}`}>
      <input
        className="tdp-title"
        value={v}
        onChange={(e) => { setV(e.target.value); setEditing(true); }}
        onFocus={() => setEditing(true)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {editing && (
        <span className="gdp-ic">
          {/* onMouseDown 으로 잡는다 — click 은 blur 뒤에 와서 이미 저장된 뒤다 */}
          <button className="gdp-ok" onMouseDown={(e) => { e.preventDefault(); commit(); }} aria-label="확정" title="확정 (Enter)">✓</button>
          <button className="gdp-no" onMouseDown={(e) => { e.preventDefault(); cancel(); }} aria-label="취소" title="취소 (Esc)">✕</button>
        </span>
      )}
    </span>
  );
}

/**
 * §A5 「고급」 — 상위 목표 수동 지정.
 *
 * 속성 블록에서 빼내 접어 둔다. 기본 닫힘.
 * 대부분의 사람은 평생 열 일이 없고, 열어야 하는 사람은 찾을 수 있어야 한다.
 */
function AdvancedParent({
  goal, canEdit, onPatch,
}: {
  goal: { id: number; parentId?: number | null; parentTitle?: string | null; parentSource?: string | null;
          periodType: string; periodStart: string; scope: string };
  canEdit: boolean;
  onPatch: (f: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [cands, setCands] = useState<{ id: number; title: string }[]>([]);
  useEffect(() => {
    if (!open || goal.periodType === "year") return;
    fetch(`/api/goals/parent?periodType=${goal.periodType}&periodStart=${goal.periodStart}&scope=${goal.scope}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCands(d.candidates ?? []))
      .catch(() => {});
  }, [open, goal.periodType, goal.periodStart, goal.scope]);

  if (goal.periodType === "year") return null;
  const src = goal.parentSource ?? "derived";
  const SRC_KO: Record<string, string> = {
    derived: "기간에서 자동 (기간을 바꾸면 따라갑니다)",
    placed: "만든 자리가 정함 (기간을 바꿔도 그대로)",
    manual: "직접 지정 (기간을 바꿔도 그대로)",
  };

  return (
    <details className="gdp-adv" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>고급</summary>
      <div className="gdp-adv-b">
        <label className="gdp-adv-l">상위 목표</label>
        {canEdit ? (
          <select value={goal.parentId ?? 0} onChange={(e) => onPatch({ parentId: Number(e.target.value) || null })}>
            <option value={0}>상위 없음</option>
            {cands.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        ) : (
          <div className="gdp-ro">{goal.parentTitle ?? "상위 없음"}</div>
        )}
        <p className="gdp-adv-n">{SRC_KO[src] ?? src}</p>
        {canEdit && src !== "derived" && (
          <button className="lk" onClick={() => onPatch({ parentSource: "derived" })}>
            기간을 따라가게 되돌리기
          </button>
        )}
      </div>
    </details>
  );
}
