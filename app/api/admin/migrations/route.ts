// 마이그레이션 적용 현황 — **읽기 전용. 아무것도 적용하지 않는다.** (MD-P-2026-032 러너 조사)
//
// ── 왜 라우트로 두는가 ────────────────────────────────────────────
//
// `0031` 이 조용히 빠졌을 때 그것을 알아낸 유일한 길은 PM 이 Neon 콘솔에서
// `schema_migrations` 를 직접 조회한 것이었다. DB 접속 없이는 아무도 몰랐다.
//
// > **어디까지 적용됐는지를 앱이 알 수 있어야 한다.**
//
// 그래서 앱에도 같은 질문을 할 창구를 둔다. 판정은 `ok` 한 칸이다 —
// 파일은 있는데 이력에 없는 것이 하나라도 있으면 `false`.
//
// **적용은 하지 않는다.** `getMigrationStatus()` 는 `ensureMigrated()` 를 부르지
// 않는다. 물어보는 행위가 답을 바꾸면 「묻기 전의 상태」를 영영 못 본다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { getMigrationStatus } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    if (session.role !== "lead") {
      return NextResponse.json({ error: "팀장만 사용할 수 있습니다." }, { status: 403 });
    }

    const st = await getMigrationStatus();
    return NextResponse.json({
      ok: st.ok,
      // 마지막 번호 두 개를 나란히 둔다 — 「기대하는 마지막」과 「실제 마지막」이
      // 다르면 그 자리에서 눈에 띈다.
      lastFile: st.files.at(-1) ?? null,
      lastApplied: st.applied.at(-1)?.filename ?? null,
      counts: { files: st.files.length, applied: st.applied.length, missing: st.missing.length },
      // 파일은 있는데 이력에 없는 것. **정상이면 빈 배열이다.**
      missing: st.missing,
      // 이력에는 있는데 파일이 없는 것. 파일을 지웠거나 되돌린 뒤 이력을 안 지운 것.
      unknown: st.unknown,
      applied: st.applied,
    });
  } catch (err) {
    return jsonError(err);
  }
}
