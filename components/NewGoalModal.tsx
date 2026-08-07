"use client";

// 새 목표 생성 폼 (모달) — 제목·유형(팀/개인)·기간 계층(연간→분기→월)·상위 연결·담당(영역)·설명.
// 진척은 서버가 연결 업무 가중평균으로 자동 산출. 팀 목표=lead / 개인 목표=본인(서버에서 강제).
import { useEffect, useMemo, useState } from "react";
import type { GoalNode } from "@/lib/goals";
import type { SessionUser } from "@/lib/types";
import { toast } from "@/lib/quick";

type Scope = "team" | "personal";
type Period = "year" | "quarter" | "month";

function flatten(nodes: GoalNode[]): GoalNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children ?? [])]);
}
function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export default function NewGoalModal({
  user, scope: initialScope, year, tree, onClose, onCreated,
}: {
  user: SessionUser;
  scope: Scope;
  year: number;
  tree: GoalNode[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const canTeam = user.role === "lead";
  const [scope, setScope] = useState<Scope>(canTeam ? initialScope : "personal");
  const [period, setPeriod] = useState<Period>("month");
  const [gy, setGy] = useState(year);
  const [quarter, setQuarter] = useState(1);
  const [month, setMonth] = useState(1);
  const [parentId, setParentId] = useState<number | "">("");
  const [areaId, setAreaId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [areas, setAreas] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/meta/selectors").then((r) => r.json()).then((d) => setAreas(d.areas ?? [])).catch(() => {});
  }, []);

  const all = useMemo(() => flatten(tree), [tree]);
  // 상위 후보 — 분기: 연간(같은 해·스코프) / 월: 분기(같은 해·스코프)
  const parentLevel: Period | null = period === "quarter" ? "year" : period === "month" ? "quarter" : null;
  const parents = useMemo(() => {
    if (!parentLevel) return [];
    return all.filter((g) => g.periodType === parentLevel && g.scope === scope && g.periodStart.slice(0, 4) === String(gy));
  }, [all, parentLevel, scope, gy]);

  function computePeriod(): { start: string; end: string } {
    if (period === "year") return { start: `${gy}-01-01`, end: `${gy}-12-31` };
    if (period === "quarter") {
      const sm = (quarter - 1) * 3 + 1;
      const em = sm + 2;
      return { start: `${gy}-${pad(sm)}-01`, end: `${gy}-${pad(em)}-${pad(lastDay(gy, em))}` };
    }
    return { start: `${gy}-${pad(month)}-01`, end: `${gy}-${pad(month)}-${pad(lastDay(gy, month))}` };
  }

  async function submit() {
    if (!title.trim()) { setErr("제목을 입력하세요."); return; }
    setBusy(true); setErr("");
    const { start, end } = computePeriod();
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        scope, periodType: period, periodStart: start, periodEnd: end,
        title: title.trim(), description,
        parentId: parentId || null,
        areaId: scope === "team" && areaId ? areaId : undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) { setErr(data.error ?? "목표 생성 실패"); return; }
    // 27-4 — 같은 주기·같은 기간에 같은 제목이 이미 있었다면 **알려만 준다.**
    // 저장은 이미 끝났다. 막지 않기로 한 원칙(B-2)과 같다 — 판단은 사람이 한다.
    if (data.duplicateTitleOf) {
      toast(`같은 기간에 제목이 같은 목표(#${data.duplicateTitleOf})가 이미 있어요 — 확인해 보세요`, "err");
    }
    onCreated();
    onClose();
  }

  const QUARTERS = [1, 2, 3, 4];
  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
  const yearOpts = [year - 1, year, year + 1];

  return (
    <>
      <div className="ngm-backdrop" onClick={onClose} />
      <div className="ngm" role="dialog" aria-label="새 목표">
        <div className="ngm-head">
          <b>새 목표</b>
          <button className="ngm-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="ngm-body">
          {err && <p className="ma-err">{err}</p>}

          <label className="ngm-f">유형
            <div className="ma-seg" role="group">
              <button aria-pressed={scope === "team"} disabled={!canTeam} onClick={() => setScope("team")}>팀 목표</button>
              <button aria-pressed={scope === "personal"} onClick={() => setScope("personal")}>내 목표</button>
            </div>
          </label>

          <label className="ngm-f">기간 계층
            <div className="ma-seg" role="group">
              {(["year", "quarter", "month"] as Period[]).map((p) => (
                <button key={p} aria-pressed={period === p} onClick={() => { setPeriod(p); setParentId(""); }}>
                  {p === "year" ? "연간" : p === "quarter" ? "분기" : "월"}
                </button>
              ))}
            </div>
          </label>

          <div className="ngm-grid">
            <label className="ngm-f">연도
              <select value={gy} onChange={(e) => setGy(Number(e.target.value))}>
                {yearOpts.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
            </label>
            {(period === "quarter") && (
              <label className="ngm-f">분기
                <select value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
                  {QUARTERS.map((q) => <option key={q} value={q}>{q}분기</option>)}
                </select>
              </label>
            )}
            {(period === "month") && (
              <label className="ngm-f">월
                <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTHS.map((m) => <option key={m} value={m}>{m}월</option>)}
                </select>
              </label>
            )}
          </div>

          {parentLevel && (
            <label className="ngm-f">상위 목표 <em>({parentLevel === "year" ? "연간" : "분기"})</em>
              <select value={parentId} onChange={(e) => setParentId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">연결 안 함</option>
                {parents.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              {parents.length === 0 && <span className="ngm-hint">먼저 상위 {parentLevel === "year" ? "연간" : "분기"} 목표를 만들면 연결할 수 있어요.</span>}
            </label>
          )}

          {scope === "team" && (
            <label className="ngm-f">담당 영역 <em>(선택)</em>
              <select value={areaId} onChange={(e) => setAreaId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">영역 없음</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          )}
          {scope === "personal" && <p className="ngm-hint">개인 목표는 {user.name}님만 볼 수 있어요. 진척은 연결한 내 업무로 자동 집계됩니다.</p>}

          <label className="ngm-f">제목
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: EDUINO AI 커리큘럼 1차 완성" maxLength={200} autoFocus />
          </label>
          <label className="ngm-f">설명 <em>(선택)</em>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="목표의 배경·성공 기준 등" />
          </label>
        </div>
        <div className="ngm-foot">
          <button className="btn-brand" onClick={submit} disabled={busy || !title.trim()}>{busy ? "만드는 중…" : "목표 만들기"}</button>
          <span style={{ flex: 1 }} />
          <button className="btn-outline" onClick={onClose}>취소</button>
        </div>
      </div>
    </>
  );
}
