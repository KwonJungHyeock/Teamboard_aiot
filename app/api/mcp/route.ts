// Claude 연결 창구 — MCP(Streamable HTTP, 상태 없음 · JSON 응답) (2026-10 Claude 연동 · 0040).
//
// Claude 데스크톱 · Claude Code 가 「내 정보」에서 만든 개인 키를 `Authorization: Bearer` 로
// 들고 온다. 키 → 사람을 찾고, 그 사람의 **세션을 잠깐 만들어** 앱의 기존 API 를 부른다
// (`lib/mcp.ts`). 그래서 권한 규칙이 화면과 한 벌이다.
//
// 세션 이름에 「(Claude)」를 붙인다 — 업무 활동 기록에 「○○ (Claude)이(가) …」로 남아
// 사람이 직접 한 것과 Claude 가 한 것이 갈린다.
import { NextResponse } from "next/server";
import { resolveToken } from "@/lib/api-token";
import { INSTRUCTIONS, runTool, TOOLS, type Call } from "@/lib/mcp";
import { claudeCall } from "@/lib/claude-call";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

function unauthorized(why: string) {
  return NextResponse.json(fail(null, -32001, why), {
    status: 401, headers: { "WWW-Authenticate": 'Bearer realm="teamboard", error="invalid_token"' } });
}

export async function POST(request: Request) {
  const raw = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) return unauthorized("연결 키가 없습니다. 「내 정보 → Claude 연결」에서 키를 만들어 붙여 주세요.");
  const user = await resolveToken(raw);
  if (!user) return unauthorized("연결 키가 맞지 않거나 끊겼습니다. 「내 정보 → Claude 연결」을 확인하세요.");

  let body: Rpc | Rpc[];
  try { body = await request.json(); }
  catch { return NextResponse.json(fail(null, -32700, "JSON 이 아닙니다."), { status: 400 }); }

  // 그 사람으로서 앱 API 를 부른다 — 쿠키는 이 요청 안에서만 쓰고 버린다
  // 업무 API 울타리(lib/claude-guard.ts)가 걸리는 세션으로 부른다
  const call: Call = claudeCall(new URL(request.url).origin, user);

  const handle = async (m: Rpc): Promise<object | null> => {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") return fail(m?.id, -32600, "잘못된 요청입니다.");
    if (m.id === undefined || m.id === null) return null;          // 알림(notifications/*) — 답하지 않는다
    switch (m.method) {
      case "initialize": {
        const asked = String(m.params?.protocolVersion ?? "");
        return ok(m.id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "teamboard", title: "AI 로봇 플랫폼팀 통합업무관리", version: "1.0.0" },
          instructions: `${INSTRUCTIONS}\n· 이 연결의 사람: ${user.name}`,
        });
      }
      case "ping": return ok(m.id, {});
      case "tools/list": return ok(m.id, { tools: TOOLS });
      case "tools/call": {
        const name = String(m.params?.name ?? "");
        if (!TOOLS.some((t) => t.name === name)) return fail(m.id, -32602, `모르는 도구입니다: ${name}`);
        try {
          const r = await runTool(name, m.params?.arguments ?? {}, { id: user.id }, call);
          return ok(m.id, { content: [{ type: "text", text: r.text }], isError: !!r.isError });
        } catch (e) {
          return ok(m.id, { content: [{ type: "text", text: `처리 중 오류 — ${String((e as Error)?.message ?? e).slice(0, 200)}` }], isError: true });
        }
      }
      default: return fail(m.id, -32601, `지원하지 않는 요청입니다: ${m.method}`);
    }
  };

  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean);
    return out.length ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
  }
  const one = await handle(body);
  return one ? NextResponse.json(one) : new NextResponse(null, { status: 202 });
}

// 서버가 먼저 보내는 흐름(SSE)은 열지 않는다 — 도구만 있는 창구다
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
