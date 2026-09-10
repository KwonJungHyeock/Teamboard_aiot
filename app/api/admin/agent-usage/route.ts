// 에이전트 흔적 집계 — **읽기 전용. 아무것도 지우지 않는다** (MD-P-2026-038 §B-1).
//
// ── 왜 세기부터 하는가 ───────────────────────────────────────────
//
// 철거 범위는 정해졌지만 **프로덕션에 무엇이 몇 건 있는지 아직 아무도 안 봤다.**
// 모르는 채로 지우는 것은 되돌릴 수 없는 판단이다. 그래서 지우기 전에 센다.
//
// 숫자만 내지 않는다 — **그 숫자가 지워도 되는 것인지 판단하려면 내용을 봐야 한다.**
// `task(origin='agent')` 와 `drafts` 는 목록까지 낸다(제목 · 담당 · 만든 날 · 상태).
//
// 쓰기 경로가 없다. DELETE 도 UPDATE 도 이 파일에 없다.
import { NextResponse } from "next/server";
import { requireLiveAdmin } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 각 항목이 **무엇인지** — 숫자 옆에 이 문장이 함께 간다.
 *
 * 이 값은 화면에 **글자 그대로** 그려진다. 마크다운 강조(`**`)를 쓰면 별표가
 * 그대로 보인다 — 실측 캡처에서 "**사람이 이어받아…**" 로 나왔다. 평문으로 쓴다.
 */
const WHAT: Record<string, string> = {
  agentActors: "계정을 발급할 때 자동으로 만들어지는 에이전트 actor. 캘린더 레인이 여기서 늘어난다.",
  agentConfig: "에이전트별 설정(보고 형식 · 담당 영역 · 자동 범위 · 추가 지시문).",
  agentJob: "에이전트가 돌린 작업 기록. 0이면 한 번도 안 돌았다는 뜻이다.",
  drafts: "부사수가 만든 초안. 승인·반려하던 화면이 없어졌으므로 여기가 유일하게 보이는 곳이다.",
  monthlyDrafts: "같은 drafts 표에 들어 있지만 월간 보고다. 월간 보고 기능이 지금도 쓰는 자리라 철거 대상이 아니다.",
  originAgent: "에이전트가 만든 업무. 사람이 이어받아 진행 중일 수 있으니 목록을 보고 정한다.",
  proposed: "에이전트 제안 상태의 업무. 승인 인박스에 뜨는 것들이다.",
};

export async function GET() {
  try {
    // 토큰이 아니라 **DB 의 지금 역할**로 본다 — 강등이 즉시 먹는다.
    // 관리자 API 는 전부 이 게이트를 쓴다(`/api/members`). 여기만 다르면
    // 「관리자 전용」이 자리마다 다른 뜻이 된다.
    await requireLiveAdmin();

    const [counts] = await query<{
      agent_actors: number; agent_config: number; agent_job: number;
      drafts: number; monthly_drafts: number; origin_agent: number; proposed: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM actor WHERE type = 'agent')            AS agent_actors,
         (SELECT count(*)::int FROM agent_config)                          AS agent_config,
         (SELECT count(*)::int FROM agent_job)                             AS agent_job,
         (SELECT count(*)::int FROM drafts WHERE task_type <> 'monthly_report') AS drafts,
         (SELECT count(*)::int FROM drafts WHERE task_type =  'monthly_report') AS monthly_drafts,
         (SELECT count(*)::int FROM task WHERE origin = 'agent')           AS origin_agent,
         (SELECT count(*)::int FROM task WHERE status = 'proposed')        AS proposed`
    );

    // 목록은 **건수만으로는 정할 수 없는 것들**만 낸다.
    const agentTasks = await query<{
      id: number; title: string; assignee: string | null;
      created_at: string; status: string; is_active: boolean;
    }>(
      `SELECT t.id, t.title, ac.display_name AS assignee,
              t.created_at::text, t.status, t.is_active
         FROM task t LEFT JOIN actor ac ON ac.id = t.assignee_id
        WHERE t.origin = 'agent'
        ORDER BY t.created_at DESC, t.id`
    );

    const draftRows = await query<{
      id: number; title: string | null; owner: string | null;
      created_at: string; status: string;
    }>(
      `SELECT d.id, d.title, ac.display_name AS owner, d.created_at::text, d.status
         FROM drafts d LEFT JOIN actor ac ON ac.id = d.user_id
        WHERE d.task_type <> 'monthly_report'
        ORDER BY d.created_at DESC, d.id`
    );

    return NextResponse.json({
      what: WHAT,
      counts: {
        agentActors: counts.agent_actors,
        agentConfig: counts.agent_config,
        agentJob: counts.agent_job,
        drafts: counts.drafts,
        monthlyDrafts: counts.monthly_drafts,
        originAgent: counts.origin_agent,
        proposed: counts.proposed,
      },
      agentTasks: agentTasks.map((t) => ({
        id: t.id, title: t.title, assignee: t.assignee,
        createdAt: t.created_at.slice(0, 10), status: t.status, isActive: t.is_active,
      })),
      drafts: draftRows.map((d) => ({
        id: d.id, title: d.title, owner: d.owner,
        createdAt: d.created_at.slice(0, 10), status: d.status,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
