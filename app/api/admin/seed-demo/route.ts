// 데모 시드 주입 (파트 X) — lead 전용. 콘솔 없이 관리 화면 버튼으로 예시 데이터를 넣는다.
// 스키마는 자동 마이그레이션(lib/migrate)이 담당하므로 여기서는 데모 시드만 실행한다.
// seed-demo.mjs 는 config.demo_seeded 마커로 중복 주입을 막는다(재실행 시 no-op).
import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import { requireSession } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const run = promisify(execFile);

export async function POST() {
  try {
    const session = requireSession();
    if (session.role !== "lead") {
      return NextResponse.json({ error: "팀장만 데모 시드를 주입할 수 있습니다." }, { status: 403 });
    }

    const script = path.join(process.cwd(), "scripts", "seed-demo.mjs");
    try {
      const { stdout, stderr } = await run(process.execPath, [script], {
        // 시드 스크립트는 자체 pg 풀 사용 — 앱 자동 마이그레이션과 무관.
        env: { ...process.env, TB_SKIP_MIGRATE: "1" } as NodeJS.ProcessEnv,
        timeout: 50_000,
      });
      const output = `${stdout}${stderr}`.trim();
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 데모 시드 주입 실행`,
        level: "warn",
      });
      return NextResponse.json({ ok: true, output });
    } catch (error: unknown) {
      const e = error as { stdout?: string; stderr?: string; message?: string };
      const output = `${e.stdout ?? ""}${e.stderr ?? ""}${e.message ?? ""}`.trim();
      return NextResponse.json({ ok: false, error: "데모 시드 실패", output }, { status: 500 });
    }
  } catch (error) {
    return jsonError(error);
  }
}
