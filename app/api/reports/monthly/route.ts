// 월별 성과 리포트 데이터 (MD-P-2026-010) — 모든 수치는 여기서 집계해 내려보낸다.
// 권한 (§F): 팀 리포트는 전원 / 개인 리포트는 본인과 팀장만. 타인 것은 403.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { buildPerfReport, type ReportScope } from "@/lib/perf-report";
import { kstTodayForGoals } from "@/lib/goals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const today = kstTodayForGoals();

    const year = Number(url.searchParams.get("year")) || Number(today.slice(0, 4));
    const month = Number(url.searchParams.get("month")) || Number(today.slice(5, 7));
    if (year < 2000 || year > 2100 || month < 1 || month > 12) {
      return NextResponse.json({ error: "기간이 올바르지 않습니다." }, { status: 400 });
    }
    // 미래 월은 만들지 않는다 — 아직 일어나지 않은 성과는 없다.
    const ym = `${year}-${String(month).padStart(2, "0")}`;
    if (ym > today.slice(0, 7)) {
      return NextResponse.json({ error: "미래 월 리포트는 만들 수 없습니다." }, { status: 400 });
    }

    const scope: ReportScope = url.searchParams.get("scope") === "personal" ? "personal" : "team";
    const requested = Number(url.searchParams.get("actorId"));
    const actorId = scope === "personal"
      ? (Number.isInteger(requested) && requested > 0 ? requested : session.id)
      : null;

    // §F — 개인 리포트는 본인 + 팀장만
    if (scope === "personal" && actorId !== session.id && session.role !== "lead") {
      return NextResponse.json({ error: "다른 구성원의 개인 리포트는 열람할 수 없습니다." }, { status: 403 });
    }

    const report = await buildPerfReport({ year, month, scope, actorId, viewerId: session.id });

    // 팀장에게만 대상자 선택지를 함께 내려준다
    const members = session.role === "lead"
      ? await query<{ id: number; display_name: string }>(
          `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true ORDER BY id`
        )
      : [];

    return NextResponse.json({
      report,
      members: members.map((m) => ({ id: m.id, name: m.display_name })),
      viewer: { id: session.id, isLead: session.role === "lead" },
    });
  } catch (error) {
    return jsonError(error);
  }
}
