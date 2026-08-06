"use client";

// 에이전트 FAB (우측 하단) — 전원 각자의 에이전트에 위임하는 상시 진입점.
// 탭 ①알림: 완료·진행 작업(→ 승인 대기 연결) ②지시: 프롬프트 위임(자료조사·내 업무 정리).
// 완료는 자동 확정하지 않는다 — 승인 대기(제안)로 등록되고 사람이 확정한다.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { SessionUser } from "@/lib/types";
import { computeLiveStatus, STATUS_CHIP } from "@/lib/agent-live";
import { TASK_PANEL_EVENT, currentTaskRef } from "@/lib/task-panel";
import { GOAL_PANEL_EVENT, currentGoalParam } from "@/lib/goal-panel";

type JobType = "research" | "organize";
type JobStatus = "queued" | "running" | "done" | "failed";
interface Job {
  id: number;
  prompt: string;
  type: JobType;
  status: JobStatus;
  result: string | null;
  error: string | null;
  draft_id: number | null;
  cost_tokens: number;
  seen_at: string | null;
  created_at: string;
}
interface Credit { budget: number; spent: number; remaining: number }

const POLL_MS = 4000;
// lib/agent.ts와 동일한 추정식(표기용) — 정산이 아니라 감을 주기 위한 근사.
const WON_PER_1K = 6;
function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 2.5) + 320 + 900;
}
function estimateWon(tokens: number): number {
  return Math.max(1, Math.round((tokens / 1000) * WON_PER_1K));
}
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

const HINTS: Record<JobType, string> = {
  research: "예: 국내 초·중등 AIoT 교구 시장 규모와 경쟁 제품 3가지 조사",
  organize: "예: 이번 주 내 업무를 우선순위별로 정리하고 다음 액션 제안",
};

export default function AgentFab({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  // 상세 패널(업무·목표) 등 오버레이가 열리면 FAB 숨김 — 하단 액션(삭제·저장·완료)과 겹침 방지
  const [taskPanel, setTaskPanel] = useState(false);
  const [goalPanel, setGoalPanel] = useState(false);
  useEffect(() => {
    setTaskPanel(currentTaskRef() !== null);
    setGoalPanel(currentGoalParam() !== null);
    const onTask = (e: Event) => setTaskPanel((e as CustomEvent).detail != null);
    const onGoal = (e: Event) => setGoalPanel((e as CustomEvent).detail != null);
    window.addEventListener(TASK_PANEL_EVENT, onTask);
    window.addEventListener(GOAL_PANEL_EVENT, onGoal);
    return () => {
      window.removeEventListener(TASK_PANEL_EVENT, onTask);
      window.removeEventListener(GOAL_PANEL_EVENT, onGoal);
    };
  }, []);
  const panelOpen = taskPanel || goalPanel;
  // 미확인 알림 수 — 사이드바 폴링과 같은 소스(tb:notif-count 이벤트)로 동기
  const [notifCount, setNotifCount] = useState(0);
  useEffect(() => {
    const onCount = (e: Event) => setNotifCount((e as CustomEvent).detail ?? 0);
    window.addEventListener("tb:notif-count", onCount);
    return () => window.removeEventListener("tb:notif-count", onCount);
  }, []);
  const [tab, setTab] = useState<"notify" | "dispatch">("notify");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [unseen, setUnseen] = useState(0);
  const [credit, setCredit] = useState<Credit | null>(null);

  const [type, setType] = useState<JobType>("research");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const knownDone = useRef<Set<number> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 5000);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/jobs");
      if (!res.ok) return;
      const data = await res.json();
      const next: Job[] = data.jobs ?? [];
      setJobs(next);
      setUnseen(data.unseen ?? 0);
      setCredit(data.credit ?? null);

      // 새로 완료된 작업 감지 → 토스트 (최초 로드는 기준선만 세팅)
      const doneIds = new Set(next.filter((j) => j.status === "done").map((j) => j.id));
      if (knownDone.current === null) {
        knownDone.current = doneIds;
      } else {
        const fresh = Array.from(doneIds).filter((id) => !knownDone.current!.has(id));
        if (fresh.length > 0) showToast(`에이전트가 작업을 완료했어요 — 승인 대기에서 확정하세요`);
        knownDone.current = doneIds;
      }
    } catch {
      /* 폴링 실패는 조용히 무시 */
    }
  }, [showToast]);

  // 상시 폴링 (패널 열림 여부와 무관하게 배지·토스트 유지)
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  // 알림 탭을 열면 미확인 완료를 seen 처리 (배지 해제)
  async function openNotify() {
    setTab("notify");
    setOpen(true);
    if (unseen > 0) {
      await fetch("/api/agent/seen", { method: "POST" }).catch(() => {});
      setUnseen(0);
    }
  }

  async function submit() {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/agent/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, prompt: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "위임에 실패했어요.");
        setSubmitting(false);
        return;
      }
      setPrompt("");
      setSubmitting(false);
      await load();
      // 방금 위임분은 알림 탭에 완료로 표시 (동기 처리)
      if (data.job?.status === "failed") {
        setError(data.job.error ?? "처리에 실패했어요.");
      } else {
        setTab("notify");
        showToast("작업이 완료되어 승인 대기에 등록됐어요");
        // 방금 만든 done은 확인한 것으로 처리
        if (data.job?.id) knownDone.current?.add(data.job.id);
      }
    } catch {
      setError("네트워크 오류로 위임하지 못했어요.");
      setSubmitting(false);
    }
  }

  const est = estimateTokens(prompt);
  const insufficient = credit ? est > credit.remaining : false;
  // Liveness — 실측 job 상태에서 파생 (idle/working/done/failed)
  const status = computeLiveStatus(jobs, { submitting, unseen });
  const chip = STATUS_CHIP[status];

  return (
    <>
      {/* 토스트 */}
      {toast && (
        <div className="agf-toast" role="status" onClick={openNotify}>
          <span className="agf-toast-dot" />
          {toast}
        </div>
      )}

      {/* FAB — 3상태(대기·작업중·완료). 색+상태로 살아있음. 업무 상세 열리면 숨김(겹침 방지). */}
      {!panelOpen && (
        <button
          className={`agf-fab s-${status}${open ? " on" : ""}`}
          aria-label={`에이전트 (${chip.label})`}
          aria-expanded={open}
          onClick={() => (open ? setOpen(false) : openNotify())}
        >
          {status === "working" && <span className="agf-ring" aria-hidden="true" />}
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="8" width="16" height="12" rx="3" />
            <path d="M12 4v4M9 14h.01M15 14h.01M2 13h2M20 13h2" />
          </svg>
          {unseen > 0 && <span className="agf-badge">{unseen > 9 ? "9+" : unseen}</span>}
          {notifCount > 0 && <span className="agf-notif" aria-label={`알림 ${notifCount}건`}>{notifCount > 9 ? "9+" : notifCount}</span>}
        </button>
      )}

      {/* 패널 */}
      {open && !panelOpen && (
        <div className="agf-panel" role="dialog" aria-label="에이전트">
          <div className="agf-head">
            <div className="agf-title">
              <b>에이전트</b>
              <span className={`agf-chip-live s-${status}`}><i className="agf-live-dot">{chip.dot}</i>{chip.label}</span>
            </div>
            <button className="agf-x" aria-label="닫기" onClick={() => setOpen(false)}>
              <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          <div className="agf-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "notify"} onClick={openNotify}>
              알림{unseen > 0 ? ` (${unseen})` : ""}
            </button>
            <button role="tab" aria-selected={tab === "dispatch"} onClick={() => setTab("dispatch")}>
              지시
            </button>
          </div>

          {tab === "notify" ? (
            <div className="agf-body">
              {jobs.length === 0 ? (
                <div className="agf-empty">
                  <p>아직 위임한 작업이 없어요.</p>
                  <button className="lk" onClick={() => setTab("dispatch")}>지시 탭에서 위임하기 →</button>
                </div>
              ) : (
                <ul className="agf-jobs">
                  {jobs.map((j) => (
                    <li key={j.id} className={`agf-job st-${j.status}`}>
                      <div className="agf-job-top">
                        <span className={`agf-chip c-${j.type}`}>{j.type === "research" ? "자료조사" : "정리"}</span>
                        <span className={`agf-status s-${j.status}`}>
                          {j.status === "done" ? "완료" : j.status === "failed" ? "실패" : j.status === "running" ? "진행 중" : "대기"}
                        </span>
                        <span className="agf-time">{relTime(j.created_at)}</span>
                      </div>
                      <div className="agf-job-p">{j.prompt}</div>
                      {j.status === "done" && (
                        <div className="agf-job-f">
                          {j.result && <p className="agf-result">{j.result}</p>}
                          <Link className="agf-approve" href="/inbox" onClick={() => setOpen(false)}>
                            승인 대기에서 확정 →
                          </Link>
                        </div>
                      )}
                      {j.status === "failed" && <p className="agf-err">{j.error}</p>}
                      {(j.status === "running" || j.status === "queued") && (
                        <p className="agf-run"><span className="agf-spin" />처리 중…</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="agf-body">
              <div className="agf-seg" role="group" aria-label="작업 유형">
                <button aria-pressed={type === "research"} onClick={() => setType("research")}>웹 자료조사</button>
                <button aria-pressed={type === "organize"} onClick={() => setType("organize")}>내 업무 정리</button>
              </div>
              <textarea
                className="agf-input"
                rows={4}
                placeholder={HINTS[type]}
                value={prompt}
                maxLength={2000}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={submitting}
              />
              <div className="agf-cost">
                <span>
                  예상 <b>~{est.toLocaleString()}</b> 토큰 · 약 ₩{estimateWon(est).toLocaleString()}
                </span>
                {credit && (
                  <span className={insufficient ? "agf-lo" : ""}>
                    잔여 {credit.remaining.toLocaleString()}
                  </span>
                )}
              </div>
              {insufficient && (
                <p className="agf-warn">이번 달 크레딧이 부족해요. 다음 달에 초기화됩니다.</p>
              )}
              {error && <p className="agf-err">{error}</p>}
              <button
                className="btn-brand agf-send"
                onClick={submit}
                disabled={submitting || !prompt.trim() || insufficient}
              >
                {submitting ? <><span className="agf-spin" />에이전트가 작업 중…</> : "에이전트에게 위임"}
              </button>
              <p className="agf-note">결과는 승인 대기에 초안으로 등록됩니다. 확정은 직접 하세요.</p>
            </div>
          )}

          <Link className="agf-foot" href="/assistant" onClick={() => setOpen(false)}>
            전체 보기 → 내 에이전트
          </Link>
        </div>
      )}
    </>
  );
}
