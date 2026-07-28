// 에이전트 Liveness — 상태는 실측(agent_job status)에서 파생. 가짜 애니 없음.
export type LiveStatus = "idle" | "working" | "done" | "failed";

interface LiveJob { status: string }

/** 실측 상태 파생 — 우선순위: working > done(미확인) > failed(최근) > idle. */
export function computeLiveStatus(
  jobs: LiveJob[],
  opts: { submitting?: boolean; unseen?: number } = {}
): LiveStatus {
  if (opts.submitting || jobs.some((j) => j.status === "running" || j.status === "queued")) return "working";
  if ((opts.unseen ?? 0) > 0) return "done";
  if (jobs[0]?.status === "failed") return "failed"; // 목록은 최신순
  return "idle";
}

// 상태 칩 — 색 + 텍스트 병행(색맹 대비), mono. 도트는 유니코드.
export const STATUS_CHIP: Record<LiveStatus, { dot: string; label: string }> = {
  idle: { dot: "●", label: "대기 (idle)" },
  working: { dot: "◐", label: "작업 중… (working)" },
  done: { dot: "✓", label: "완료 (done)" },
  failed: { dot: "✕", label: "실패 (failed)" },
};
