// TEMPORARY — 프로덕션 초기화 성공 직후 삭제. ALLOW_DB_INIT 이중 잠금 적용.
// Claude Code 실행 환경에서 Neon(5432)에 직접 접속이 불가하여, 배포된 앱이
// 대신 스키마 적용 + 운영 시드 + 데모 시드를 실행하기 위한 임시 경로다.
// 이중 잠금:
//   ① 환경변수 ALLOW_DB_INIT === "true" 가 아니면 404 (존재 자체를 숨김)
//   ② 헤더 x-admin-secret 을 AUTH_SECRET 과 대조, 불일치 시 404
// 모든 호출 시도는 성공·실패 모두 activity_log(warn, 호출 IP 포함)에 기록한다.
// 실행 로직은 기존 스크립트(scripts/init-db.mjs, scripts/seed-demo.mjs)를
// 자식 프로세스로 그대로 실행한다 — 로컬 경로와 로직 중복을 만들지 않는다.
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { timingSafeEqual } from "crypto";
import path from "path";
import { logActivity } from "@/lib/activity";

// 로깅 실패가 잠금 응답 상태를 바꾸지 않도록 best-effort
async function safeLog(p: Parameters<typeof logActivity>[0]) {
  try { await logActivity(p); } catch { /* noop */ }
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const run = promisify(execFile);

function secretMatches(given: string | null): boolean {
  const expected = process.env.AUTH_SECRET ?? "";
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function callerIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  const ip = callerIp(request);

  // 잠금 ① — ALLOW_DB_INIT 이 켜져 있지 않으면 존재하지 않는 것처럼 404
  if (process.env.ALLOW_DB_INIT !== "true") {
    await safeLog({
      userId: null,
      message: `admin/init-db 호출 차단 — ALLOW_DB_INIT 미설정 (IP: ${ip})`,
      level: "warn",
    });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 잠금 ② — 시크릿 불일치도 404 (존재 은폐)
  if (!secretMatches(request.headers.get("x-admin-secret"))) {
    await safeLog({
      userId: null,
      message: `admin/init-db 호출 차단 — 시크릿 불일치 (IP: ${ip})`,
      level: "warn",
    });
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await safeLog({
    userId: null,
    message: `admin/init-db 실행 시작 (IP: ${ip})`,
    level: "warn",
  });

  const logs: { step: string; ok: boolean; output: string }[] = [];
  const steps: [string, string][] = [
    ["schema+운영시드", path.join(process.cwd(), "scripts", "init-db.mjs")],
    ["데모시드", path.join(process.cwd(), "scripts", "seed-demo.mjs")],
  ];

  for (const [step, script] of steps) {
    try {
      const { stdout, stderr } = await run(process.execPath, [script], {
        env: process.env as NodeJS.ProcessEnv,
        timeout: 50_000,
      });
      logs.push({ step, ok: true, output: `${stdout}${stderr}`.trim() });
    } catch (error: any) {
      logs.push({
        step,
        ok: false,
        output: `${error?.stdout ?? ""}${error?.stderr ?? ""}${error?.message ?? ""}`.trim(),
      });
      await safeLog({
        userId: null,
        message: `admin/init-db 실패 — ${step} (IP: ${ip})`,
        level: "warn",
      });
      return NextResponse.json({ ok: false, logs }, { status: 500 });
    }
  }
  await safeLog({
    userId: null,
    message: `admin/init-db 실행 완료 (IP: ${ip})`,
    level: "warn",
  });
  return NextResponse.json({ ok: true, logs });
}
