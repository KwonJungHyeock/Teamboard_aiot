// 앱 안 에이전트 — 화면의 「에이전트」 버튼에서 말로 업무를 찾고 · 등록하고 · 고친다 (2026-10).
//
// Claude 연결(MCP)과 **같은 도구 · 같은 울타리**를 쓴다: 도구는 lib/mcp.ts 의 TOOLS · runTool,
// 쓰기는 `via: "claude"` 세션(lib/claude-call.ts)으로 가서 업무 API 가 「내 개인 업무만」으로 막는다.
// 도구를 부르는 동안 무엇을 하는지 한 줄씩 흘려 보내고, 마지막 답을 보낸다.
import Anthropic from "@anthropic-ai/sdk";
import { INSTRUCTIONS, TOOLS, runTool, type Call } from "./mcp";
import { llmInfo } from "./llm";

export type AgentEvent = { t: "tool"; name: string; label: string } | { t: "text"; d: string } | { t: "error"; d: string } | { t: "done" };
export interface Turn { role: "user" | "assistant"; text: string }

const MAX_STEPS = 8;
const LABEL: Record<string, string> = {
  add_worklog: "업무일지에 남기는 중", list_worklog: "업무일지 읽는 중", update_worklog: "업무일지 고치는 중",
  list_my_tasks: "내 업무 찾는 중", search_tasks: "팀 업무 찾는 중", get_task: "업무 읽는 중",
  create_task: "내 업무에 등록하는 중", update_task: "업무 고치는 중", set_today: "오늘 줄 정하는 중", get_weekly_brief: "주간 브리핑 읽는 중",
};

let client: Anthropic | null = null;

export async function* runAgent(turns: Turn[], me: { id: number; name: string }, call: Call): AsyncGenerator<AgentEvent> {
  const info = llmInfo();
  if (info.provider !== "anthropic") {
    yield { t: "text", d: "Claude 키가 아직 연결되지 않았습니다. 관리자가 ANTHROPIC_API_KEY 를 넣으면 바로 씁니다." };
    yield { t: "done" };
    return;
  }
  client ??= new Anthropic();
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const system = `${INSTRUCTIONS}\n· 지금 쓰는 사람: ${me.name}\n· 오늘(서울): ${today}\n· 앱 화면 안의 에이전트다. 답은 짧은 한국어로, 찾은 업무는 번호 · 제목 · 기한만 줄마다.`;
  const tools = TOOLS.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
  const messages: Anthropic.MessageParam[] = turns.slice(-12).map((m) => ({ role: m.role, content: m.text }));

  const create = async (): Promise<Anthropic.Message> => {
    const base = { model: info.model!, max_tokens: 16000, system, tools, messages };
    try {
      // 안전 분류기가 거절하면 서버가 다른 모델로 이어 쓰게 한다(server-side fallback)
      return (await client!.beta.messages.create({ ...base, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as never)) as unknown as Anthropic.Message;
    } catch (e) {
      if (!(e instanceof Anthropic.BadRequestError)) throw e;
      return client!.messages.create(base);
    }
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await create();
    if ((res.stop_reason as string) === "refusal") { yield { t: "error", d: "이 요청은 처리하지 않았습니다." }; break; }
    messages.push({ role: "assistant", content: res.content });
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (res.stop_reason === "pause_turn") continue;
    if (res.stop_reason !== "tool_use" || !uses.length) {
      const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
      yield { t: "text", d: text || "(답 없음)" };
      break;
    }
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      yield { t: "tool", name: u.name, label: LABEL[u.name] ?? u.name };
      try {
        const r = await runTool(u.name, (u.input ?? {}) as Record<string, unknown>, { id: me.id }, call);
        results.push({ type: "tool_result", tool_use_id: u.id, content: r.text, is_error: !!r.isError });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: u.id, content: `처리 중 오류 — ${String((e as Error)?.message ?? e).slice(0, 200)}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) yield { t: "text", d: "여러 번 시도했지만 끝내지 못했습니다. 조금 더 구체적으로 말해 주세요." };
  }
  yield { t: "done" };
}
