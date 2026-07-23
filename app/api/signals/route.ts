// 시그널 API (Phase 6, A 수정 반영) — GET: 목록(타입·범위·상태 필터, 정체·미실행결정 판정),
// POST: 생성. 정체 임계값은 config에서 읽는다 — 하드코딩 금지 (검수 포인트 1).
// 가시성: private=작성자만 / review=작성자+대상+lead / 그 외 팀. API 레벨 차단 (검수 3).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { getSignalThresholds, getDecidedStaleDays, signalVisibilityClause } from "@/lib/signals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["decision", "review", "memo", "risk"] as const;
const SCOPES = ["private", "huddle", "team"] as const;
const STATUSES = ["open", "discussing", "decided", "resolved", "archived"] as const;

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const scope = url.searchParams.get("scope");
    const status = url.searchParams.get("status"); // 기본: 미종결(open/discussing/decided)
    const huddle = url.searchParams.get("huddle"); // '1' → huddle_at IS NOT NULL 기준 조회

    // $1 = viewer id, 가시성은 lib/signals 단일 소스
    const where: string[] = ["s.is_active = true", signalVisibilityClause("$1")];
    const params: unknown[] = [session.id];
    if (type && (TYPES as readonly string[]).includes(type)) {
      params.push(type);
      where.push(`s.type = $${params.length}`);
    }
    if (huddle === "1") {
      // 허들 피드: scope 무관, huddle_at 기준 (A-3)
      where.push(`s.huddle_at IS NOT NULL`);
    } else if (scope && (SCOPES as readonly string[]).includes(scope)) {
      params.push(scope);
      where.push(`s.scope = $${params.length}`);
    }
    if (status && (STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    } else if (!status) {
      where.push(`s.status IN ('open','discussing','decided')`);
    }

    const rows = await query<{
      id: number;
      type: string;
      scope: string;
      title: string;
      body: string;
      status: string;
      task_id: number | null;
      target_actor_id: number | null;
      target_name: string | null;
      author_id: number;
      author_name: string;
      author_type: string;
      project_name: string | null;
      color_key: string | null;
      days: string;
      decided_days: string | null;
      comment_count: string;
      huddle_at: string | null;
      created_at: string;
    }>(
      `SELECT s.id, s.type, s.scope, s.title, s.body, s.status, s.task_id,
              s.target_actor_id, ta.display_name AS target_name,
              s.author_id, a.display_name AS author_name, a.type AS author_type,
              p.name AS project_name, p.color_key,
              floor(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400) AS days,
              CASE WHEN s.decided_at IS NOT NULL
                   THEN floor(EXTRACT(EPOCH FROM (now() - s.decided_at)) / 86400) END AS decided_days,
              (SELECT count(*) FROM comment c WHERE c.signal_id = s.id) AS comment_count,
              s.huddle_at::text, s.created_at::text
       FROM signal s
       JOIN actor a ON a.id = s.author_id
       LEFT JOIN actor ta ON ta.id = s.target_actor_id
       LEFT JOIN project p ON p.id = s.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params
    );

    const thresholds = await getSignalThresholds();
    const decidedStaleDays = await getDecidedStaleDays();
    const signals = rows.map((s) => {
      const limit = thresholds[s.type];
      const active = s.status === "open" || s.status === "discussing";
      const stalled =
        active &&
        (s.type === "risk"
          ? true // risk는 임계값 0 — 즉시 고정
          : limit !== null && limit !== undefined && Number(s.days) >= Number(limit));
      // 미실행 결정: decided가 임계일 이상 지속
      const decidedStale =
        s.status === "decided" && s.decided_days !== null && Number(s.decided_days) >= decidedStaleDays;
      return {
        id: s.id,
        type: s.type,
        scope: s.scope,
        title: s.title,
        body: s.body,
        status: s.status,
        taskId: s.task_id,
        targetActorId: s.target_actor_id,
        targetName: s.target_name,
        authorId: s.author_id,
        authorName: s.author_name,
        agent: s.author_type === "agent",
        projectName: s.project_name,
        colorKey: s.color_key,
        days: Number(s.days),
        decidedDays: s.decided_days === null ? null : Number(s.decided_days),
        commentCount: Number(s.comment_count),
        huddledAt: s.huddle_at,
        stalled,
        decidedStale,
        // 나에게 온 확인 요청 — 홈/목록 우선 정렬용
        toMe: s.type === "review" && s.target_actor_id === session.id && active,
      };
    });
    // 정렬: 나에게 온 확인 요청 → risk 고정 → 미실행 결정 → 정체 → 최신
    const rank = (s: (typeof signals)[number]) =>
      s.toMe ? 0 : s.type === "risk" && (s.status === "open" || s.status === "discussing") ? 1 : s.decidedStale ? 2 : s.stalled ? 3 : 4;
    const sorted = [...signals].sort((a, b) => rank(a) - rank(b));
    return NextResponse.json({ signals: sorted });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(); // 시그널 작성은 member 전권 (SPEC 6장)
    const payload = await request.json();
    const type = payload.type as string;
    if (!(TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "타입이 올바르지 않습니다." }, { status: 400 });
    }
    const title = String(payload.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });

    // review는 대상 지정 필수 (A-2)
    let targetActorId: number | null = null;
    if (type === "review") {
      targetActorId = payload.targetActorId ? Number(payload.targetActorId) : null;
      if (!targetActorId) {
        return NextResponse.json({ error: "확인 요청은 대상을 지정해야 합니다." }, { status: 400 });
      }
      const target = await queryOne<{ id: number }>(
        "SELECT id FROM actor WHERE id = $1 AND type = 'human' AND is_active = true",
        [targetActorId]
      );
      if (!target) return NextResponse.json({ error: "대상이 올바르지 않습니다." }, { status: 400 });
    }

    // 공개 범위 (SPEC 2.3): memo 기본 본인만, review는 team(가시성은 대상+작성자+lead로 별도 제어), 그 외 팀
    let scope = (SCOPES as readonly string[]).includes(payload.scope)
      ? (payload.scope as string)
      : type === "memo"
        ? "private"
        : "team";
    if (type !== "memo" && scope === "private") scope = "team"; // 비공개는 메모만
    const huddleAt = scope === "huddle"; // 생성 시점부터 허들이면 huddle_at 기록

    const signal = await queryOne<{ id: number }>(
      `INSERT INTO signal (type, scope, title, body, author_id, target_actor_id, project_id, task_id, huddle_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,${huddleAt ? "now()" : "NULL"}) RETURNING id`,
      [
        type,
        scope,
        title,
        String(payload.body ?? "").slice(0, 4000),
        session.id,
        targetActorId,
        payload.projectId ? Number(payload.projectId) : null,
        payload.taskId ? Number(payload.taskId) : null,
      ]
    );
    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 시그널 생성 (${type}) — "${title}"`,
    });
    return NextResponse.json({ id: signal!.id });
  } catch (error) {
    return jsonError(error);
  }
}
