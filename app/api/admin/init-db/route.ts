// TEMPORARY — 2차 운영 초기화 완료 후 삭제. ALLOW_DB_INIT 이중 잠금.
// Claude Code 실행 환경에서 Neon(5432)에 직접 접속이 불가하여, 배포된 앱이
// 대신 스키마 적용 + 운영 시드 (+ 선택적 데모 시드)를 실행하기 위한 임시 경로다.
// 이중 잠금(둘 다 통과해야 실행, 아니면 404로 존재 은폐):
//   ① ALLOW_DB_INIT 이 'true'(대소문자·공백 무시) 가 아니면 404
//   ② 헤더 x-admin-secret 을 AUTH_SECRET(양쪽 trim) 과 대조, 불일치 시 404
// 차단 시 사유를 console.error 로 남긴다(Vercel Functions 로그로 진단). HTTP 응답에는
// 사유·시크릿을 노출하지 않는다. 진단용 GET 은 시크릿 없이 부울 4개만 반환한다.
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { logActivity } from "@/lib/activity";
import { adminLockReason } from "@/lib/admin-lock";

// 로깅 실패가 잠금 응답 상태를 바꾸지 않도록 best-effort
async function safeLog(p: Parameters<typeof logActivity>[0]) {
  try { await logActivity(p); } catch { /* noop */ }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const run = promisify(execFile);

function callerIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// 진단 전용 — 시크릿 없이 호출 가능. 환경변수 "값"은 절대 반환하지 않고 존재/일치 여부만.
// 라우트 도달 여부 + 환경변수 인식 여부를 한 번에 판별한다. 실제 초기화는 하지 않는다.
export async function GET() {
  const raw = process.env.ALLOW_DB_INIT;
  const secret = (process.env.AUTH_SECRET ?? "").trim();
  const body = {
    routeReachable: true,
    allowFlagPresent: raw != null && raw.trim() !== "",
    allowFlagValue: (raw ?? "").trim().toLowerCase() === "true",
    secretConfigured: secret.length > 0,
  };
  console.info("[admin/init-db] GET 진단:", JSON.stringify(body));
  return NextResponse.json(body);
}

export async function POST(request: Request) {
  const ip = callerIp(request);

  // 이중 잠금 검사 — 사유는 로그 전용(HTTP 응답은 404로 존재 은폐 유지)
  const reason = adminLockReason(request);
  if (reason) {
    console.error(`[admin/init-db] 잠금 차단 — ${reason} (IP: ${ip})`);
    await safeLog({
      userId: null,
      message: `admin/init-db 호출 차단 — ${reason} (IP: ${ip})`,
      level: "warn",
    });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 데모 시드 포함 여부 — ?demo=true 일 때만
  const withDemo = new URL(request.url).searchParams.get("demo") === "true";

  console.info(`[admin/init-db] 잠금 통과 — 실행 시작 (demo=${withDemo}, IP: ${ip})`);
  await safeLog({
    userId: null,
    message: `admin/init-db 실행 시작 (demo=${withDemo}, IP: ${ip})`,
    level: "warn",
  });

  const logs: { step: string; ok: boolean; output: string }[] = [];
  const steps: [string, string][] = [
    ["schema+운영시드", path.join(process.cwd(), "scripts", "init-db.mjs")],
  ];
  if (withDemo) steps.push(["데모시드", path.join(process.cwd(), "scripts", "seed-demo.mjs")]);

  for (const [step, script] of steps) {
    try {
      const { stdout, stderr } = await run(process.execPath, [script], {
        env: process.env as NodeJS.ProcessEnv,
        timeout: 50_000,
      });
      logs.push({ step, ok: true, output: `${stdout}${stderr}`.trim() });
    } catch (error: any) {
      const output = `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`.trim();
      logs.push({ step, ok: false, output });
      console.error(`[admin/init-db] 실패 — ${step} (IP: ${ip}): ${output}`);
      await safeLog({
        userId: null,
        message: `admin/init-db 실패 — ${step} (IP: ${ip})`,
        level: "warn",
      });
      return NextResponse.json({ ok: false, logs }, { status: 500 });
    }
  }
  console.info(`[admin/init-db] 실행 완료 (IP: ${ip})`);
  await safeLog({
    userId: null,
    message: `admin/init-db 실행 완료 (IP: ${ip})`,
    level: "warn",
  });
  return NextResponse.json({ ok: true, logs });
}
