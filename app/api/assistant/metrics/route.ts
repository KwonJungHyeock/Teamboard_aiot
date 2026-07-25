// 에이전트 기여 측정 (신규) — 감이 아니라 숫자로. task.origin·drafts.status 집계.
//   기여율 = 이번 달 생성 업무 중 origin='agent' 비율 (담당=본인)
//   승인율 = 에이전트 제안(초안) 중 승인된 비율
//   반려율 = 에이전트 제안 중 반려·기각된 비율
// 목표치는 아직 설정하지 않는다(기준선 없음). 참고선 현재 비중 20%만 함께 반환.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { kstToday } from "@/lib/home";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function monthBounds(today: string, monthsAgo = 0) {
  const [y, m] = today.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1 - monthsAgo, 1));
  const end = new Date(Date.UTC(y, m - monthsAgo, 1)); // 다음 달 1일(배타)
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function contributionRate(viewerId: number, start: string, end: string): Promise<{ rate: number; agent: number; total: number }> {
  const r = await queryOne<{ agent: string; total: string }>(
    `SELECT count(*) FILTER (WHERE origin = 'agent') AS agent, count(*) AS total
     FROM task
     WHERE is_active = true AND assignee_id = $1
       AND created_at >= $2::timestamptz AND created_at < $3::timestamptz`,
    [viewerId, start, end]
  );
  const agent = Number(r?.agent ?? 0);
  const total = Number(r?.total ?? 0);
  return { rate: total > 0 ? Math.round((agent / total) * 100) : 0, agent, total };
}

async function decisionRates(viewerId: number, start: string, end: string) {
  const r = await queryOne<{ approved: string; rejected: string }>(
    `SELECT count(*) FILTER (WHERE status = 'approved') AS approved,
            count(*) FILTER (WHERE status = 'rejected') AS rejected
     FROM drafts
     WHERE user_id = $1 AND decided_at >= $2::timestamptz AND decided_at < $3::timestamptz`,
    [viewerId, start, end]
  );
  const approved = Number(r?.approved ?? 0);
  const rejected = Number(r?.rejected ?? 0);
  const decided = approved + rejected;
  return {
    approvalRate: decided > 0 ? Math.round((approved / decided) * 100) : 0,
    rejectionRate: decided > 0 ? Math.round((rejected / decided) * 100) : 0,
    approved,
    rejected,
  };
}

export async function GET() {
  try {
    const session = requireSession();
    const today = kstToday();
    const cur = monthBounds(today, 0);
    const prev = monthBounds(today, 1);

    const [contribCur, contribPrev, decCur, decPrev] = await Promise.all([
      contributionRate(session.id, cur.start, cur.end),
      contributionRate(session.id, prev.start, prev.end),
      decisionRates(session.id, cur.start, cur.end),
      decisionRates(session.id, prev.start, prev.end),
    ]);

    return NextResponse.json({
      referenceLine: 20, // 참고선(현재 비중). 목표치는 3개월 측정 후 결정.
      current: {
        contributionRate: contribCur.rate,
        approvalRate: decCur.approvalRate,
        rejectionRate: decCur.rejectionRate,
        contribution: contribCur,
        decision: { approved: decCur.approved, rejected: decCur.rejected },
      },
      previous: {
        contributionRate: contribPrev.rate,
        approvalRate: decPrev.approvalRate,
        rejectionRate: decPrev.rejectionRate,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
