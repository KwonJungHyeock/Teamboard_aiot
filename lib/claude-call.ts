// Claude 가 앱 API 를 「그 사람으로서」 부르는 길 — MCP 연결과 앱 안 에이전트가 같이 쓴다.
// 세션에 `via: "claude"` 를 붙여서, 업무 API 의 울타리(lib/claude-guard.ts)가 걸리게 한다.
// 활동 기록에는 「이름 (Claude)」로 남는다.
import { createSessionToken, SESSION_COOKIE } from "./auth";
import type { SessionUser } from "./types";
import type { Call } from "./mcp";

export function claudeCall(origin: string, user: SessionUser): Call {
  const cookie = `${SESSION_COOKIE}=${createSessionToken({ ...user, name: `${user.name} (Claude)`, via: "claude" })}`;
  return async (path, init = {}) => {
    const r = await fetch(`${origin}${path}`, {
      method: init.method ?? "GET", cache: "no-store", redirect: "manual",
      headers: { cookie, "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
}
