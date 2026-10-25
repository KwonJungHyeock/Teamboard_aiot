// Claude 를 거친 쓰기의 울타리 (2026-10 — Claude 연결 · 앱 안 에이전트).
//
// ── 무엇을 막는가 ────────────────────────────────────────────────
// Claude 는 사람 말을 잘못 알아들을 수 있다. 그래서 Claude 를 거친 세션(`via: "claude"`)은
//   · 업무를 만들 때: **나에게 · 개인(나만 봄)** 으로만. 프로젝트 · 상위 업무 · 담당 지정은 무시
//   · 업무를 고칠 때: **내가 담당이거나 내가 만든 것**만, 그리고 제목 · 설명 · 상태 · 기한 · 시작일 · 진행률만
//   · 지우기 · 되살리기 · 공개 범위 · 담당 · 목표 · 프로젝트 바꾸기는 못 한다 — 사람이 화면에서 한다
//   · 하루에 만들 수 있는 업무 수에 상한(DAILY_CREATE_CAP)
// 팀 공개로 올리는 것은 사람이 상세 드로어의 「공개」에서 직접 한다.
//
// 도구 코드(lib/mcp.ts)도 같은 값을 보내지만, **API 가 마지막에 한 번 더 막는다** —
// 도구가 바뀌거나 새 도구가 생겨도 이 울타리는 그대로다.
import type { SessionUser } from "./types";
import { queryOne } from "./db";

export const DAILY_CREATE_CAP = 30;
const EDITABLE = new Set(["title", "description", "status", "dueDate", "startDate", "progress"]);

export const viaClaude = (s: SessionUser) => s.via === "claude";

export class ClaudeGuardError extends Error { constructor(message: string, public status = 403) { super(message); } }

/** 만들기 — 받은 값을 「나 · 개인」으로 고쳐 쓴다. 하루 상한을 넘으면 던진다 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function guardCreate<T extends Record<string, any>>(s: SessionUser, payload: T): Promise<T> {
  if (!viaClaude(s)) return payload;
  const n = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM activity_log
      WHERE user_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul'
        AND message LIKE '%(Claude)이(가) 업무 생성%'`, [s.id]);
  if ((n?.n ?? 0) >= DAILY_CREATE_CAP) throw new ClaudeGuardError(`Claude 로 오늘 만들 수 있는 업무(${DAILY_CREATE_CAP}건)를 다 썼습니다. 화면에서 직접 만드세요.`, 429);
  return {
    title: payload.title, description: payload.description, dueDate: payload.dueDate, startDate: payload.startDate,
    areaId: payload.areaId, status: payload.status === "doing" ? "doing" : "todo",
    assigneeId: s.id, visibility: "private", projectId: null, parentTaskId: null,
  } as unknown as T;
}

/** 고치기 — 내 업무인지, 고칠 수 있는 칸만 왔는지 */
export function guardUpdate(s: SessionUser, task: { assignee_id: number | null; created_by: number | null }, payload: Record<string, unknown>): void {
  if (!viaClaude(s)) return;
  if (task.assignee_id !== s.id && task.created_by !== s.id) throw new ClaudeGuardError("Claude 로는 내 업무만 고칠 수 있습니다.");
  const bad = Object.keys(payload).filter((k) => !EDITABLE.has(k));
  if (bad.length) throw new ClaudeGuardError(`Claude 로는 바꿀 수 없는 칸입니다: ${bad.join(", ")} — 앱 화면에서 바꾸세요.`);
}
