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
import { query } from "@/lib/db";
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

    /*
     * ── 「없다」와 「있는데 못 찾는다」는 다르다 (MD-P-2026-038 §A) ────
     *
     * `findParentCandidates` 는 `period_start` **완전 일치**로 찾는다.
     * 그래서 분기 목표의 시작일이 분기 첫날이 아니면 — 예를 들어 2026-07-15 로
     * 잘못 들어가 있으면 — 그 분기의 월 목표는 상위를 **하나도 못 찾는다.**
     *
     * 그때 화면이 「2026 Q3 목표가 없습니다」라고만 하면 사람은 없는 줄 알고
     * **새로 만든다. 그러면 같은 분기 목표가 둘이 된다.**
     *
     * **판정은 그대로 둔다** — 완전 일치를 겹침으로 바꾸는 것은 새 규칙이고
     * 이번에 하지 않는다. 대신 **왜 못 찾았는지 말할 재료**를 하나 더 낸다:
     * 같은 기간에 걸쳐 있지만 시작일이 달라 후보가 못 된 것들.
     */
    const nearMisses = await query<{ id: number; title: string; period_start: string }>(
      `SELECT id, title, period_start::text
         FROM goal
        WHERE is_active = true
          AND period_type = $1
          AND scope = $2
          AND ($3::int IS NULL OR owner_actor_id = $3)
          AND period_start <> $4::date
          AND period_start <= $5::date AND period_end >= $4::date
        ORDER BY period_start`,
      [
        spec.periodType, scope, scope === "personal" ? session.id : null,
        spec.periodStart,
        // 그 상위 기간의 마지막 날 — 분기면 시작일 + 3개월 - 1일.
        spec.periodType === "year"
          ? `${spec.periodStart.slice(0, 4)}-12-31`
          : new Date(Date.UTC(Number(spec.periodStart.slice(0, 4)),
                              Number(spec.periodStart.slice(5, 7)) - 1 + 3, 0))
              .toISOString().slice(0, 10),
      ]
    );

    return NextResponse.json({
      spec: { ...spec, label },
      candidates,
      scope,
      /** 후보 0개일 때 화면이 「있는데 시작일이 다르다」를 말할 재료. 정상이면 빈 배열. */
      nearMisses: nearMisses.map((g) => ({ id: g.id, title: g.title, periodStart: g.period_start })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
