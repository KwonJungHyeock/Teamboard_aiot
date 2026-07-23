// 부사수 지능 (PRD 12장) — 공급자 교체 가능 레이어.
// LLM_PROVIDER(openai|anthropic)로 선택. 미지정 시 설정된 API 키 기준 자동 선택.
// 키는 서버 환경변수에만 존재하며 클라이언트에 노출되지 않는다.
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { AssistantSettings, TaskType } from "./types";

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.1";

type Provider = "anthropic" | "openai" | "mock";

function resolveProvider(): Provider {
  const explicit = process.env.LLM_PROVIDER;
  if (explicit === "openai" || explicit === "anthropic" || explicit === "mock") return explicit;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  // 키가 하나도 없으면 데모 모드 — 승인 게이트 흐름을 키 없이 시험할 수 있게 함
  return "mock";
}

// ---------- 프롬프트 (공급자 무관) ----------

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

// ---------- 공급자별 호출 ----------

let anthropicClient: Anthropic | null = null;
async function completeWithAnthropic(system: string, user: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  if (!anthropicClient) anthropicClient = new Anthropic();
  const response = await anthropicClient.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 8192,
    system,
    messages: [{ role: "user", content: user }],
  });
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

let openaiClient: OpenAI | null = null;
async function completeWithOpenAI(system: string, user: string): Promise<string> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다.");
  }
  if (!openaiClient) openaiClient = new OpenAI();
  const response = await openaiClient.chat.completions.create({
    model: OPENAI_MODEL,
    max_completion_tokens: 8192,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });
  return (response.choices[0]?.message?.content ?? "").trim();
}

// LLM 키가 없을 때의 데모 초안 — 흐름 검증용. 키를 설정하면 자동으로 실제 모델 사용.
function completeWithMock(taskType: TaskType, instruction: string): string {
  const sections: Record<TaskType, string> = {
    자료조사: `## 요약 (3줄 이내)
- "${instruction}"에 대한 조사 초안 자리입니다. (데모 모드)

## 핵심 발견
- LLM API 키가 아직 연결되지 않아 실제 조사 내용 대신 데모 초안이 생성되었습니다.

## 상세 내용
위임 내용: ${instruction}

## 한계·추가 확인 필요 사항
- OPENAI_API_KEY 또는 ANTHROPIC_API_KEY를 설정하면 실제 AI 초안이 생성됩니다.`,
    회의록: `## 회의 개요
- 안건: ${instruction} (데모 모드)

## 주요 논의 사항
- LLM API 키 미연결 상태로, 실제 회의 내용 정리 대신 데모 초안이 생성되었습니다.

## 결정 사항
- (키 연결 후 재작성 필요)

## 액션 아이템
- OPENAI_API_KEY 또는 ANTHROPIC_API_KEY 설정`,
    내용정리: `## 한 줄 요약
- "${instruction}" 정리 초안 자리입니다. (데모 모드)

## 핵심 포인트
- LLM API 키가 아직 연결되지 않았습니다.

## 구조화된 정리
위임 내용: ${instruction}`,
    반복업무: `## 처리 결과 요약
- "${instruction}" 처리 초안 자리입니다. (데모 모드)

## 처리 내역
1. LLM API 키 미연결 — 데모 초안 생성

## 다음 반복 시 참고사항
- OPENAI_API_KEY 또는 ANTHROPIC_API_KEY를 설정하면 실제 AI가 처리합니다.`,
  };
  return `제목: [데모] ${instruction.slice(0, 40)}\n${sections[taskType]}`;
}

// ---------- 공개 인터페이스 ----------

export interface DraftResult {
  title: string;
  body: string;
}

/**
 * 월간 보고 문장화 (Phase 7) — 집계 JSON을 받아 섹션별 서술 문단만 생성한다.
 * 수치·항목은 서버(lib/report.ts)가 확정하며, LLM은 주어진 데이터만 문장으로 옮긴다.
 * 반환은 { [sectionKey]: 문단 텍스트 }. 키 없으면 화면이 빈 문단으로 처리한다.
 * (기존 generateDraft 시그니처는 건드리지 않는 내부 확장)
 */
export async function narrateReport(params: {
  periodLabel: string;
  data: unknown;
  sections: { key: string; title: string; hint: string }[];
}): Promise<Record<string, string>> {
  const { periodLabel, data, sections } = params;
  const provider = resolveProvider();

  if (provider === "mock") {
    // 데모 모드 — 집계 JSON을 그대로 나열 (수치 생성 없음)
    const out: Record<string, string> = {};
    for (const s of sections) {
      out[s.key] = `(데모 모드 — LLM 키 미연결) ${s.title}: 아래 표의 집계 데이터를 참고하세요.`;
    }
    return out;
  }

  const system = `당신은 사내 업무 관리 도구 "팀보드"의 보고서 작성 보조입니다.
주어진 집계 데이터(JSON)만 사용하여 각 섹션 상단의 1~2문장 요약 서술만 한국어로 작성합니다.

절대 규칙:
- 주어진 데이터에 없는 수치·항목·사실을 생성·추정·추가하지 않는다.
- 수치를 새로 계산하거나 반올림하지 않는다. 숫자가 필요하면 데이터의 값을 그대로 인용한다.
- 비율·개수·비교 표현(절반, 대부분, 다수, 과반, 대다수, 상당수 등)을 스스로 만들지 않는다.
  개수·비율이 필요하면 반드시 데이터의 summary 객체에 있는 값만 그대로 인용한다.
  (예: summary.goalsBelow30 이 1이면 "30% 미만 목표 1건"으로만 쓴다. "절반" 같은 표현 금지)
- 목록·표는 화면이 집계 데이터로 직접 렌더한다. 당신은 개별 항목을 나열하지 않는다.
  각 섹션은 상황을 요약하는 1~2문장만 쓴다.
- 데이터가 비어 있는 섹션은 "해당 사항 없음"으로 간결히 적는다.
- 출력은 JSON 객체 하나. 키는 섹션 key, 값은 문단 문자열.`;

  const user = `보고 기간: ${periodLabel}

섹션 정의:
${sections.map((s) => `- ${s.key}: ${s.title} — ${s.hint}`).join("\n")}

집계 데이터(JSON) — summary에 서버가 계산한 요약 수치가 있으니 개수·비율은 이 값만 인용:
${JSON.stringify(data)}

위 데이터만 사용해 각 섹션의 1~2문장 요약을 작성하고, {"섹션key": "문단", ...} 형태의 JSON만 출력하세요.`;

  const text =
    provider === "openai"
      ? await completeWithOpenAI(system, user)
      : await completeWithAnthropic(system, user);

  // JSON 파싱 — 코드펜스/잡음 제거 후 첫 객체 추출
  try {
    const cleaned = text.replace(/```json\s*|\s*```/g, "").trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : cleaned);
    const out: Record<string, string> = {};
    for (const s of sections) out[s.key] = typeof parsed[s.key] === "string" ? parsed[s.key] : "";
    return out;
  } catch {
    // 파싱 실패 시 전체 텍스트를 첫 섹션에 담아 사람이 편집하도록 함
    const out: Record<string, string> = {};
    sections.forEach((s, i) => (out[s.key] = i === 0 ? text : ""));
    return out;
  }
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

  const system = buildSystemPrompt(assistant, taskType);
  const provider = resolveProvider();
  const text =
    provider === "mock"
      ? completeWithMock(taskType, instruction)
      : provider === "openai"
        ? await completeWithOpenAI(system, userContent)
        : await completeWithAnthropic(system, userContent);

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
