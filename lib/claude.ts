// 부사수 지능 — Claude API (PRD 12장). 서버 전용: 키는 서버 환경변수에만.
import Anthropic from "@anthropic-ai/sdk";
import type { AssistantSettings, TaskType } from "./types";

const MODEL = "claude-opus-4-8";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
    }
    client = new Anthropic();
  }
  return client;
}

// task_type별 출력 포맷 고정 (PRD 12장)
const TASK_TEMPLATES: Record<TaskType, string> = {
  자료조사: `출력 포맷 (마크다운):
## 요약 (3줄 이내)
## 핵심 발견
- 항목별 근거와 함께
## 상세 내용
## 한계·추가 확인 필요 사항`,
  회의록: `출력 포맷 (마크다운):
## 회의 개요 (일시/참석자/안건 — 입력에서 확인된 것만)
## 주요 논의 사항
## 결정 사항
## 액션 아이템 (담당자·기한이 언급된 경우만 표기)`,
  내용정리: `출력 포맷 (마크다운):
## 한 줄 요약
## 핵심 포인트 (불릿)
## 구조화된 정리 (섹션별)`,
  반복업무: `출력 포맷 (마크다운):
## 처리 결과 요약
## 처리 내역 (단계별)
## 다음 반복 시 참고사항`,
};

const COMMON_RULES = `당신은 사내 업무 관리 도구 "팀보드"의 AI 부사수입니다.

공용 규칙 (반드시 준수):
- 모든 출력은 한국어로 작성한다.
- 요점을 먼저 쓴다.
- 당신의 산출물은 "초안"이다. 확정·발송·기록은 반드시 사수(담당자)의 승인을 거친다. 스스로 확정하거나 승인을 가정하지 않는다.
- 추측하지 않는다. 입력에 없는 사실을 지어내지 않으며, 불확실한 부분은 "확인 필요"로 명시한다.
- 첫 줄에 "제목: <업무를 나타내는 간결한 제목>" 형식으로 초안 제목을 쓰고, 그 다음 줄부터 본문을 작성한다.`;

function buildSystemPrompt(assistant: AssistantSettings, taskType: TaskType): string {
  const parts = [COMMON_RULES];
  parts.push(`업무 유형: ${taskType}\n${TASK_TEMPLATES[taskType]}`);
  parts.push(
    assistant.report_style === "brief"
      ? "보고 스타일: 요점 위주. 간결하게, 꼭 필요한 내용만."
      : "보고 스타일: 상세. 배경과 근거를 충분히 포함."
  );
  if (assistant.work_areas.length > 0) {
    parts.push(`담당 업무 영역: ${assistant.work_areas.join(", ")} — 이 관점을 우선 고려한다.`);
  }
  if (assistant.system_prompt_extra.trim()) {
    parts.push(`사용자 커스텀 지침:\n${assistant.system_prompt_extra.trim()}`);
  }
  return parts.join("\n\n");
}

export interface DraftResult {
  title: string;
  body: string;
}

export async function generateDraft(params: {
  assistant: AssistantSettings;
  taskType: TaskType;
  instruction: string;
  previousDraft?: { title: string; body: string; feedback: string } | null;
}): Promise<DraftResult> {
  const { assistant, taskType, instruction, previousDraft } = params;

  let userContent = `위임 업무 (${taskType}): ${instruction}`;
  if (previousDraft) {
    userContent += `\n\n이전 초안이 반려되었습니다. 아래 반려 사유를 반영해 재작업하세요.\n\n[반려 사유]\n${previousDraft.feedback}\n\n[이전 초안: ${previousDraft.title}]\n${previousDraft.body}`;
  }

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: buildSystemPrompt(assistant, taskType),
    messages: [{ role: "user", content: userContent }],
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("부사수가 빈 응답을 반환했습니다.");

  // 첫 줄 "제목: ..." 파싱
  const lines = text.split("\n");
  let title = `[${taskType}] ${instruction.slice(0, 40)}`;
  let bodyStart = 0;
  const match = lines[0]?.match(/^제목\s*[:：]\s*(.+)$/);
  if (match) {
    title = match[1].trim();
    bodyStart = 1;
  }
  const body = lines.slice(bodyStart).join("\n").trim();

  return { title, body };
}
