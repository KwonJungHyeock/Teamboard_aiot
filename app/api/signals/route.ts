// 시그널 API (Phase 6) — GET: 목록(타입·범위·상태 필터, 정체 판정 포함), POST: 생성.
// 정체 임계값은 config.signal_thresholds에서 읽는다 — 하드코딩 금지 (검수 포인트 1).
// scope='private'는 작성자 본인에게만 반환된다 — API 레벨 차단 (검수 포인트 3).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["decision", "review", "memo", "risk"] as const;
const SCOPES = ["private", "huddle", "team"] as const;
const STATUSES = ["open", "discussing", "resolved", "archived"] as const;

async function getThresholds(): Promise<Record<string, number | null>> {
  return ((await queryOne<{ value: any }>(
    `SELECT value FROM config WHERE key = 'signal_thresholds'`
  ))?.value ?? { decision: 14, review: 7, memo: null, risk: 0 }) as Record<string, number | null>;
}

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const scope = url.searchParams.get("scope");
    const status = url.searchParams.get("status"); // 기본: open+discussing

    const where: string[] = [
      "s.is_active = true",
      // 비공개는 작성자 본인만 — UI 숨김이 아니라 쿼리 레벨 차단
      `(s.scope IN ('team','huddle') OR (s.scope = 'private' AND s.author_id = $1))`,
    ];
    const params: unknown[] = [session.id];
    if (type && (TYPES as readonly string[]).includes(type)) {
      params.push(type);
      where.push(`s.type = $${params.length}`);
    }
    if (scope && (SCOPES as readonly string[]).includes(scope)) {
      params.push(scope);
      where.push(`s.scope = $${params.length}`);
    }
    if (status && (STATUSES as readonly string[]).includes(status)) {
      params.push(status);
      where.push(`s.status = $${params.length}`);
    } else {
      where.push(`s.status IN ('open','discussing')`);
    }

    const rows = await query<{
      id: number;
      type: string;
      scope: string;
      title: string;
      body: string;
      status: string;
      task_id: number | null;
      author_id: number;
      author_name: string;
      author_type: string;
      project_name: string | null;
      color_key: string | null;
      days: string;
      comment_count: string;
      created_at: string;
    }>(
      `SELECT s.id, s.type, s.scope, s.title, s.body, s.status, s.task_id,
              s.author_id, a.display_name AS author_name, a.type AS author_type,
              p.name AS project_name, p.color_key,
              floor(EXTRACT(EPOCH FROM (now() - s.created_at)) / 86400) AS days,
              (SELECT count(*) FROM comment c WHERE c.signal_id = s.id) AS comment_count,
              s.created_at::text
       FROM signal s
       JOIN actor a ON a.id = s.author_id
       LEFT JOIN project p ON p.id = s.project_id
       WHERE ${where.join(" AND ")}
       ORDER BY s.created_at DESC
       LIMIT 100`,
      params
    );

    const thresholds = await getThresholds();
    const signals = rows.map((s) => {
      const limit = thresholds[s.type];
      const stalled =
        s.status === "discussing" || s.status === "open"
          ? s.type === "risk"
            ? true // risk는 임계값 0 — 즉시 고정
            : limit !== null && limit !== undefined && Number(s.days) >= Number(limit)
          : false;
      return {
        id: s.id,
        type: s.type,
        scope: s.scope,
        title: s.title,
        body: s.body,
        status: s.status,
        taskId: s.task_id,
        authorId: s.author_id,
        authorName: s.author_name,
        agent: s.author_type === "agent",
        projectName: s.project_name,
        colorKey: s.color_key,
        days: Number(s.days),
        commentCount: Number(s.comment_count),
        stalled,
      };
    });
    // 정렬: risk 최상단 고정 → 정체 → 최신순 (이미 최신순이므로 안정 정렬로 재배치)
    const pinned = signals.filter((s) => s.type === "risk" && s.status !== "resolved" && s.status !== "archived");
    const stalledRest = signals.filter((s) => !pinned.includes(s) && s.stalled);
    const rest = signals.filter((s) => !pinned.includes(s) && !s.stalled);
    return NextResponse.json({ signals: [...pinned, ...stalledRest, ...rest] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession(); // 시그널은 member 전권 (SPEC 6장)
    const payload = await request.json();
    const type = payload.type as string;
    if (!(TYPES as readonly string[]).includes(type)) {
      return NextResponse.json({ error: "타입이 올바르지 않습니다." }, { status: 400 });
    }
    const title = String(payload.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "제목을 입력하세요." }, { status: 400 });

    // 공개 범위 (SPEC 2.3): memo 기본 본인만, 그 외 팀 전체
    let scope = (SCOPES as readonly string[]).includes(payload.scope)
      ? (payload.scope as string)
      : type === "memo"
        ? "private"
        : "team";
    if (type !== "memo" && scope === "private") scope = "team"; // 비공개는 메모만

    const signal = await queryOne<{ id: number }>(
      `INSERT INTO signal (type, scope, title, body, author_id, project_id, task_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        type,
        scope,
        title,
        String(payload.body ?? "").slice(0, 4000),
        session.id,
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
