"use client";

// ⚠️ **사용처 없음 — MD-P-2026-030 §A1 에서 목표-프로젝트 연결을 폐지했다.**
//    미연결 배너는 이제 업무만 센다(UnlinkedTaskPanel).
//    파일 삭제는 승인 후에 한다. 되살리지 말 것.

// 일괄 연결 (MD-P-2026-009 §B3) — 초기 데이터를 한 번에 채우기 위한 배너 + 모달.
// 미연결 프로젝트마다 목표를 골라 한 번에 붙인다. 연결 후 진척이 곧바로 살아난다.
import { useState } from "react";
import type { GoalNode } from "@/lib/goals";
import { toast } from "@/lib/quick";

interface UnlinkedProject { id: number; name: string; color_key: string | null; status: string }

/** 트리를 평탄화해 "연간 > 분기 > 월" 라벨이 붙은 선택지로. */
function flatten(tree: GoalNode[], depth = 0): { id: number; label: string }[] {
  const out: { id: number; label: string }[] = [];
  const PREFIX = ["", "· ", "·· "];
  for (const g of tree) {
    out.push({ id: g.id, label: `${PREFIX[Math.min(depth, 2)]}${g.title}` });
    if (g.children.length) out.push(...flatten(g.children, depth + 1));
  }
  return out;
}

export default function GoalLinkBanner({
  projects, tree, onLinked,
}: { projects: UnlinkedProject[]; tree: GoalNode[]; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<Record<number, number>>({}); // projectId → goalId
  const [busy, setBusy] = useState(false);
  const goals = flatten(tree);

  if (projects.length === 0) return null;

  async function linkAll() {
    const entries = Object.entries(choice).filter(([, gid]) => gid > 0);
    if (entries.length === 0 || busy) return;
    setBusy(true);
    // 목표별로 묶어 한 번씩 호출 (연결 API가 다중 프로젝트를 받는다)
    const byGoal = new Map<number, number[]>();
    for (const [pid, gid] of entries) {
      const list = byGoal.get(gid) ?? [];
      list.push(Number(pid));
      byGoal.set(gid, list);
    }
    let ok = 0;
    for (const [gid, pids] of Array.from(byGoal.entries())) {
      const res = await fetch(`/api/goals/${gid}/projects`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectIds: pids }),
      }).catch(() => null);
      if (res && res.ok) ok += pids.length;
    }
    setBusy(false);
    if (ok === 0) { toast("연결에 실패했어요", "err"); return; }
    toast(`프로젝트 ${ok}개를 목표에 연결했어요`);
    setOpen(false);
    setChoice({});
    onLinked();
  }

  return (
    <>
      <button className="glink-banner" onClick={() => setOpen(true)}>
        <span className="glink-n num">{projects.length}</span>
        <span>
          <b>연결 안 된 프로젝트 {projects.length}개</b>
          <em>목표에 연결해야 진척이 집계됩니다. 지금 한 번에 연결하세요 →</em>
        </span>
      </button>

      {open && (
        <div className="gpp-bg" role="presentation" onClick={() => setOpen(false)}>
          <div className="gpp wide" role="dialog" aria-modal="true" aria-label="프로젝트 일괄 연결" onClick={(e) => e.stopPropagation()}>
            <div className="gpp-h">
              <b>프로젝트 일괄 연결</b>
              <button className="gpanel-x" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
            </div>
            {goals.length === 0 ? (
              <p className="tdp-muted" style={{ padding: "14px 16px" }}>
                먼저 목표를 만들어야 연결할 수 있어요.
              </p>
            ) : (
              <div className="gpp-list">
                {projects.map((p) => (
                  <div className="glink-row" key={p.id}>
                    <span className={`pjdot ${p.color_key ?? "team"}`} />
                    <span className="gpp-name">{p.name}</span>
                    <select value={choice[p.id] ?? 0}
                      onChange={(e) => setChoice((c) => ({ ...c, [p.id]: Number(e.target.value) }))}>
                      <option value={0}>연결 안 함</option>
                      {goals.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <div className="gpp-foot">
              <span className="gpp-note">선택한 프로젝트만 연결됩니다.</span>
              <button className="btn-outline" onClick={() => setOpen(false)}>취소</button>
              <button className="btn-brand" onClick={linkAll}
                disabled={busy || Object.values(choice).filter((v) => v > 0).length === 0}>
                {busy ? "연결 중…" : `연결 (${Object.values(choice).filter((v) => v > 0).length})`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
