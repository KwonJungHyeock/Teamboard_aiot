"use client";

// My Agent — 내 에이전트 전체 관리 (홈 Bento 톤).
// FAB는 요약 진입, 이 화면은 전체 관리: 지시 입력 + 작업 이력 + 비용/크레딧 + 설정.
// 에이전트는 제안만 하며, 완료 결과는 승인 대기(초안)로 등록되어 사람이 확정한다.
import PageShell from "./PageShell";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NOTION_WORK_AREAS } from "@/lib/types";
import type { AssistantSettings, SessionUser } from "@/lib/types";
import { computeLiveStatus, STATUS_CHIP } from "@/lib/agent-live";

type JobType = "research" | "organize";
type JobStatus = "queued" | "running" | "done" | "failed";
interface Job {
  id: number; prompt: string; type: JobType; status: JobStatus;
  result: string | null; error: string | null; draft_id: number | null;
  cost_tokens: number; seen_at: string | null; created_at: string;
}
interface Credit { budget: number; spent: number; remaining: number }

const POLL_MS = 4000;
const WON_PER_1K = 6;
function estimateTokens(prompt: string): number {
  return Math.ceil(prompt.length / 2.5) + 320 + 900;
}
function estimateWon(t: number): number {
  return Math.max(1, Math.round((t / 1000) * WON_PER_1K));
}
function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
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
const STATUS: Record<JobStatus, { label: string; cls: string }> = {
  queued: { label: "대기", cls: "wait" },
  running: { label: "실행 중", cls: "run" },
  done: { label: "완료", cls: "done" },
  failed: { label: "실패", cls: "fail" },
};

export default function AssistantView({ user }: { user: SessionUser; notionConnected?: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [credit, setCredit] = useState<Credit | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [assistant, setAssistant] = useState<AssistantSettings | null>(null);
  const [type, setType] = useState<JobType>("research");
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const knownDone = useRef<Set<number> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/agent/jobs");
      if (!res.ok) return;
      const data = await res.json();
      const next: Job[] = data.jobs ?? [];
      setJobs(next);
      setCredit(data.credit ?? null);
      setUnseen(data.unseen ?? 0);
      const doneIds = new Set(next.filter((j) => j.status === "done").map((j) => j.id));
      if (knownDone.current === null) knownDone.current = doneIds;
    } catch {
      /* 폴링 실패 무시 */
    }
  }, []);

  useEffect(() => {
    load();
    fetch("/api/assistant/settings").then((r) => r.json()).then((d) => d.assistant && setAssistant(d.assistant)).catch(() => {});
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  async function dispatch() {
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true); setError(""); setNotice("");
    try {
      const res = await fetch("/api/agent/dispatch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, prompt: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "위임에 실패했어요.");
      } else {
        setPrompt("");
        if (data.job?.status === "failed") setError(data.job.error ?? "처리에 실패했어요.");
        else setNotice("작업이 완료되어 승인 대기에 등록됐어요. 승인 대기에서 확정하세요.");
      }
    } catch {
      setError("네트워크 오류로 위임하지 못했어요.");
    } finally {
      setSubmitting(false);
      await load();
    }
  }

  const est = estimateTokens(prompt);
  const insufficient = credit ? est > credit.remaining : false;

  return (
    <PageShell
      crumb={["워크스페이스", "My Agent"]}
      title={
        <>
          {assistant?.name ? `${assistant.name}` : "내 에이전트"}
          {(() => { const s = computeLiveStatus(jobs, { submitting, unseen }); const c = STATUS_CHIP[s]; return (
            <span className={`agf-chip-live ma-chip-live s-${s}`}><i className="agf-live-dot">{c.dot}</i>{c.label}</span>
          ); })()}
        </>
      }
      subtitle={<>{user.name}님의 AI 에이전트 — 제안만 합니다. 완료 결과는 승인 대기에서 사람이 확정합니다.</>}
      actions={
        <button className="btn-ghost" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? "설정 닫기" : "에이전트 설정"}
        </button>
      }
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        {showSettings && assistant && <SettingsCard assistant={assistant} onSaved={setAssistant} />}

        {/* 크레딧 요약 (tabular) */}
        {credit && (
          <div className="tile ma-credit" aria-label="이번 달 크레딧">
            <div className="is"><span className="v num">{credit.remaining.toLocaleString()}</span><span className="l">잔여 토큰</span></div>
            <div className="is"><span className="v num">{credit.spent.toLocaleString()}</span><span className="l">이번 달 사용</span></div>
            <div className="is"><span className="v num">{credit.budget.toLocaleString()}</span><span className="l">월 예산</span></div>
          </div>
        )}

        {/* 지시 입력부 */}
        <section className="tile ma-dispatch" aria-label="에이전트에게 위임">
          <div className="th"><span className="i" aria-hidden="true">✳️</span><h3>에이전트에게 위임</h3></div>
          <div className="ma-body">
            <div className="ma-seg" role="group" aria-label="작업 유형">
              <button aria-pressed={type === "research"} onClick={() => setType("research")}>웹 자료조사</button>
              <button aria-pressed={type === "organize"} onClick={() => setType("organize")}>내 업무 정리</button>
            </div>
            <textarea
              className="ma-input" rows={4} placeholder={HINTS[type]} value={prompt} maxLength={2000}
              onChange={(e) => setPrompt(e.target.value)} disabled={submitting}
            />
            <div className="ma-cost">
              <span>예상 <b className="num">~{est.toLocaleString()}</b> 토큰 · 약 ₩<span className="num">{estimateWon(est).toLocaleString()}</span></span>
              {credit && <span className={insufficient ? "ma-lo" : ""}>잔여 <span className="num">{credit.remaining.toLocaleString()}</span></span>}
            </div>
            {insufficient && <p className="ma-warn">이번 달 크레딧이 부족해요. 다음 달에 초기화됩니다.</p>}
            {error && <p className="ma-err">{error}</p>}
            {notice && <p className="ma-ok">{notice}</p>}
            <div className="ma-acts">
              <button className="btn-brand ma-run" onClick={dispatch} disabled={submitting || !prompt.trim() || insufficient}>
                {submitting ? <><span className="ma-spin" />에이전트가 작업 중…</> : "실행"}
              </button>
              <Link className="btn-outline" href="/inbox">승인 대기 보기</Link>
            </div>
          </div>
        </section>

        {/* 작업 이력 */}
        <div className="inbox-sh" style={{ marginTop: 22 }}><h2>작업 이력</h2><span className="sub num">{jobs.length}건</span></div>
        {jobs.length === 0 ? (
          <section className="tile inbox-empty" aria-label="작업 이력 없음">
            <div className="empty-state">
              <p className="es-title">아직 지시한 작업이 없어요</p>
              <p className="es-hint">위에서 웹 자료조사나 내 업무 정리를 위임하면, 여기에 작업 이력이 쌓입니다.</p>
            </div>
          </section>
        ) : (
          <div className="pcards">
            {jobs.map((j) => {
              const st = STATUS[j.status];
              return (
                <article className="tile pcard ma-job" key={j.id}>
                  <div className="pcard-top">
                    <span className={`ma-badge s-${st.cls}`}>{st.label}</span>
                    <span className="ma-chip">{j.type === "research" ? "자료조사" : "정리"}</span>
                    <span className="gsp" />
                    <span className="pcard-src num">{relTime(j.created_at)}</span>
                  </div>
                  <b className="pcard-title">{j.prompt}</b>
                  {j.status === "done" && j.result && <p className="pcard-body">{j.result}</p>}
                  {j.status === "failed" && <p className="ma-err">{j.error}</p>}
                  {(j.status === "running" || j.status === "queued") && <p className="ma-run-t"><span className="ma-spin" />처리 중…</p>}
                  <div className="ma-job-f">
                    <span className="ma-cost-n num">{j.cost_tokens.toLocaleString()} 토큰 · ₩{estimateWon(j.cost_tokens).toLocaleString()}</span>
                    {j.status === "done" && <Link className="ma-approve" href="/inbox">승인 대기에서 확정 →</Link>}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </div>
    </PageShell>
  );
}

function SettingsCard({
  assistant,
  onSaved,
}: {
  assistant: AssistantSettings;
  onSaved: (a: AssistantSettings) => void;
}) {
  const [name, setName] = useState(assistant.name);
  const [reportStyle, setReportStyle] = useState(assistant.report_style);
  const [workAreas, setWorkAreas] = useState<string[]>(assistant.work_areas ?? []);
  const [autoScope, setAutoScope] = useState(assistant.auto_scope);
  const [extra, setExtra] = useState(assistant.system_prompt_extra);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleArea(area: string) {
    setWorkAreas((prev) => (prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]));
  }
  async function save() {
    setBusy(true); setSaved(false);
    const res = await fetch("/api/assistant/settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, reportStyle, workAreas, autoScope, systemPromptExtra: extra }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.assistant) { onSaved(data.assistant); setSaved(true); }
  }

  return (
    <section className="tile ma-settings" aria-label="에이전트 설정">
      <div className="th"><span className="i" aria-hidden="true">⚙️</span><h3>에이전트 설정</h3></div>
      <div className="ma-body">
        <div className="grid cols-2">
          <div className="field"><label>이름</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} /></div>
          <div className="field"><label>보고 스타일</label>
            <select value={reportStyle} onChange={(e) => setReportStyle(e.target.value as "brief" | "detailed")}>
              <option value="brief">요점 위주</option><option value="detailed">상세</option>
            </select>
          </div>
        </div>
        <div className="field"><label>담당 업무 영역</label>
          <div className="chips">
            {NOTION_WORK_AREAS.map((area) => (
              <button key={area} type="button" className={`chip ${workAreas.includes(area) ? "on" : ""}`} onClick={() => toggleArea(area)}>{area}</button>
            ))}
          </div>
        </div>
        <div className="grid cols-2">
          <div className="field"><label>자동 조회 범위</label>
            <select value={autoScope} onChange={(e) => setAutoScope(e.target.value)}>
              <option value="own">내 업무만</option><option value="team">팀 전체 타임라인</option>
            </select>
          </div>
        </div>
        <div className="field"><label>커스텀 지침 (시스템 프롬프트 추가분)</label>
          <textarea rows={3} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="예: 표 형식을 선호함, 숫자에는 근거 출처를 병기할 것" />
        </div>
        <div className="ma-acts">
          {saved && <span className="ma-ok">저장됨</span>}
          <button className="btn-brand" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </section>
  );
}
