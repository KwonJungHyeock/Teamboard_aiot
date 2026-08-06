// 에이전트 FAB 로직 — 위임(dispatch)·목록·확인(seen)·월 크레딧.
// 원칙: 결과는 자동 확정하지 않는다. 완료 시 승인 대기(초안 pending)로 등록하고 사람이 확정한다.
import { query, queryOne, getAssistantByOwner } from "./db";
import { generateDraft } from "./llm";
import { logActivity } from "./activity";
import { kstToday } from "./home";
import type { AssistantSettings, TaskType } from "./types";

export type AgentJobType = "research" | "organize";
export type AgentJobStatus = "queued" | "running" | "done" | "failed";

export interface AgentJob {
  id: number;
  user_id: number;
  prompt: string;
  type: AgentJobType;
  status: AgentJobStatus;
  result: string | null;
  error: string | null;
  draft_id: number | null;
  cost_tokens: number;
  seen_at: string | null;
  created_at: string;
}

// FAB 두 유형 → 기존 초안 task_type 매핑 (research=자료조사, organize=내용정리)
const TYPE_TO_TASK: Record<AgentJobType, TaskType> = {
  research: "자료조사",
  organize: "내용정리",
};

// 월 크레딧(토큰 예산) — env로 조정. 미설정 시 넉넉한 기본값.
export const MONTHLY_TOKEN_BUDGET = Number(process.env.AGENT_MONTHLY_TOKEN_BUDGET || 2_000_000);
// 표시용 환산 단가(대략) — 1K 토큰당 원. 정산이 아니라 감을 주기 위한 표기.
const WON_PER_1K = Number(process.env.AGENT_WON_PER_1K || 6);

/** 한글 위주 대략 토큰 추정 — 문자수/2.5 + 기본 오버헤드. 정밀 계량 아님(표기·집계용). */
export function estimateTokens(prompt: string, kind: "input" | "roundtrip" = "roundtrip"): number {
  const input = Math.ceil(prompt.length / 2.5) + 320; // 시스템 프롬프트 오버헤드
  if (kind === "input") return input;
  const expectedOutput = 900; // 초안 1건 평균 출력 추정
  return input + expectedOutput;
}

export function estimateCostWon(tokens: number): number {
  return Math.max(1, Math.round((tokens / 1000) * WON_PER_1K));
}

/** 이번 달(KST) 소비 토큰 합계 */
export async function monthlyUsage(userId: number): Promise<number> {
  const today = kstToday();
  const [y, m] = today.split("-").map(Number);
  const start = `${y}-${String(m).padStart(2, "0")}-01`;
  const row = await queryOne<{ spent: string }>(
    `SELECT COALESCE(SUM(cost_tokens), 0) AS spent
     FROM agent_job
     WHERE user_id = $1 AND created_at >= $2::date`,
    [userId, start]
  );
  return Number(row?.spent ?? 0);
}

export interface CreditState {
  budget: number;
  spent: number;
  remaining: number;
}
export async function creditState(userId: number): Promise<CreditState> {
  const spent = await monthlyUsage(userId);
  return { budget: MONTHLY_TOKEN_BUDGET, spent, remaining: Math.max(0, MONTHLY_TOKEN_BUDGET - spent) };
}

export async function listJobs(userId: number, limit = 20): Promise<AgentJob[]> {
  return query<AgentJob>(
    `SELECT * FROM agent_job WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
}

/** 미확인 완료(done, seen_at NULL) 건수 — FAB 배지 카운트 */
export async function unseenDoneCount(userId: number): Promise<number> {
  const row = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM agent_job WHERE user_id = $1 AND status = 'done' AND seen_at IS NULL`,
    [userId]
  );
  return Number(row?.n ?? 0);
}

/** 완료 알림 확인 처리 — 미확인 done 을 seen 으로 (배지 해제) */
export async function markSeen(userId: number): Promise<void> {
  await query(
    `UPDATE agent_job SET seen_at = now() WHERE user_id = $1 AND status = 'done' AND seen_at IS NULL`,
    [userId]
  );
}

export class CreditError extends Error {}

/**
 * 위임 처리 — 동기 실행(초안 생성까지). 성공 시 승인 대기 초안(pending) 생성 후 job=done.
 * 크레딧 부족이면 CreditError(graceful) — job 자체를 만들지 않는다.
 */
export async function dispatchJob(params: {
  userId: number;
  userName: string;
  type: AgentJobType;
  prompt: string;
}): Promise<AgentJob> {
  const { userId, userName, type, prompt } = params;

  // 크레딧 선검사 — 예상 토큰이 잔여를 넘으면 graceful 거절
  const credit = await creditState(userId);
  const estimate = estimateTokens(prompt);
  if (estimate > credit.remaining) {
    throw new CreditError(
      `이번 달 에이전트 크레딧이 부족해요. (잔여 ${credit.remaining.toLocaleString()} · 예상 ${estimate.toLocaleString()} 토큰) 다음 달에 초기화됩니다.`
    );
  }

  const assistantRow = await getAssistantByOwner(userId);
  if (!assistantRow) {
    throw new Error("에이전트가 설정되지 않았습니다. 내 에이전트에서 먼저 설정하세요.");
  }
  const assistant: AssistantSettings = {
    ...assistantRow,
    work_areas: Array.isArray(assistantRow.work_areas) ? assistantRow.work_areas : [],
  };

  // job(running) 생성 — 폴링에서 진행 상태 노출
  const job = await queryOne<AgentJob>(
    `INSERT INTO agent_job (user_id, prompt, type, status)
     VALUES ($1, $2, $3, 'running') RETURNING *`,
    [userId, prompt, type]
  );
  const jobId = job!.id;
  await logActivity({
    userId,
    message: `에이전트 위임 시작 (${type === "research" ? "자료조사" : "내 업무 정리"}) — "${prompt.slice(0, 60)}"`,
  });

  try {
    const taskType = TYPE_TO_TASK[type];
    const result = await generateDraft({ assistant, taskType, instruction: prompt });

    // 승인 대기 초안(pending) 등록 — 사람이 확정. 자동 확정 없음.
    const draft = await queryOne<{ id: number }>(
      `INSERT INTO drafts (assistant_id, user_id, task_type, instruction, status, title, body)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id`,
      [assistant.id, userId, taskType, prompt, result.title, result.body]
    );

    // 실제 소비 토큰 추정 = 입력 + 결과 길이 기반
    const cost = estimateTokens(prompt, "input") + Math.ceil((result.body.length + result.title.length) / 2.5);
    const summary = result.body.replace(/[#*>-]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

    const done = await queryOne<AgentJob>(
      `UPDATE agent_job
       SET status = 'done', result = $1, draft_id = $2, cost_tokens = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [summary, draft!.id, cost, jobId]
    );
    await logActivity({
      userId,
      assistantId: assistant.id,
      message: `에이전트 완료 — "${result.title}" (승인 대기 등록)`,
      level: "success",
    });
    return done!;
  } catch (err) {
    const message = err instanceof Error ? err.message : "에이전트 처리 실패";
    const failed = await queryOne<AgentJob>(
      `UPDATE agent_job SET status = 'failed', error = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [message.slice(0, 300), jobId]
    );
    await logActivity({ userId, message: `에이전트 실패 (job #${jobId}): ${message}`, level: "error" }).catch(() => {});
    return failed!;
  }
}
