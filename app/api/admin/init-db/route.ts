// TEMPORARY — Phase 5 시작 시 삭제. 프로덕션 DB 일회성 초기화 라우트.
// Claude Code 실행 환경에서 Neon(5432)에 직접 접속이 불가하여, 배포된 앱이
// 대신 스키마 적용 + 운영 시드 + 데모 시드를 실행하기 위한 임시 경로다.
// 보안: 헤더 x-admin-secret 을 AUTH_SECRET 과 대조, 불일치 시 403.
// 실행 로직은 기존 스크립트(scripts/init-db.mjs, scripts/seed-demo.mjs)를
// 자식 프로세스로 그대로 실행한다 — 로컬 경로와 로직 중복을 만들지 않는다.
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { timingSafeEqual } from "crypto";
import path from "path";

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

export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-admin-secret"))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

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
      return NextResponse.json({ ok: false, logs }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, logs });
}
