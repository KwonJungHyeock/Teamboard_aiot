// 기간이 가리키는 상위 목표를 미리 물어본다 (MD-P-2026-029 §A2 · §A3).
//
// 화면은 저장하기 **전에** 알아야 한다:
//   후보 0개 → "2026 Q3 목표가 없습니다. 함께 만들까요?" 를 보여줘야 하고
//   후보 1개 → 아무것도 묻지 않고 그대로 들어가고
//   후보 2개 이상 → 어느 쪽인지 고르게 해야 한다
// 저장해 보고 나서 알려주면 이미 만들어진 뒤라 "함께 만들까요?" 가 성립하지 않는다.
//
// 읽기 전용이다. 아무것도 만들지 않는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { findParentCandidates, parentSpecOf, type GoalPeriod } from "@/lib/goal-hierarchy";

export const dynamic = "force-dynamic";

const PERIODS = ["year", "quarter", "month"] as const;

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const periodType = url.searchParams.get("periodType") ?? "";
    const periodStart = url.searchParams.get("periodStart") ?? "";
    const scope = url.searchParams.get("scope") === "personal" ? "personal" : "team";

    if (!(PERIODS as readonly string[]).includes(periodType)) {
      return NextResponse.json({ error: "periodType 이 올바르지 않습니다." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) {
      return NextResponse.json({ error: "periodStart(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    }

    const spec = parentSpecOf(periodType as GoalPeriod, periodStart);
    if (!spec) return NextResponse.json({ spec: null, candidates: [] });   // 연간은 상위가 없다

    const candidates = await findParentCandidates({
      periodType: periodType as GoalPeriod, periodStart, scope,
      ownerActorId: scope === "personal" ? session.id : null,
    });

    // 화면에 그대로 쓸 이름까지 만들어 준다 — "2026 Q3" 를 화면마다 다시 조립하지 않는다.
    const y = spec.periodStart.slice(0, 4);
    const m = Number(spec.periodStart.slice(5, 7));
    const label = spec.periodType === "year" ? `${y} 연간` : `${y} Q${Math.floor((m - 1) / 3) + 1}`;

    return NextResponse.json({ spec: { ...spec, label }, candidates });
  } catch (error) {
    return jsonError(error);
  }
}
