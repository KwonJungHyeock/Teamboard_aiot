// 개인 일정 (MD-P-2026-025 §D) — **항상 개인이다.**
//
// 팀 캘린더에는 절대 나타나지 않는다. 다른 사람에게는 "바쁨" 표시조차 하지 않는다.
// 그래서 이 엔드포인트는 남의 일정을 돌려주는 경로가 아예 없다 —
// actorId 같은 질의 파라미터를 받지 않는다. 받을 수 있으면 언젠가 쓰이게 된다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function GET(request: Request) {
  try {
    const session = requireSession();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const where = ["owner_actor_id = $1", "is_active = true"];
    const params: unknown[] = [session.id];
    // 범위는 겹침 기준으로 본다 — 다일 일정이 화면 밖에서 시작했어도 걸쳐 있으면 그린다.
    if (isDate(from)) {
      params.push(from);
      where.push(`COALESCE(ends_at, starts_at) >= ($${params.length}::date)::timestamptz`);
    }
    if (isDate(to)) {
      params.push(to);
      where.push(`starts_at < (($${params.length}::date) + 1)::timestamptz`);
    }

    const rows = await query<{
      id: number; title: string; starts_at: string; ends_at: string | null; all_day: boolean;
    }>(
      `SELECT id, title, starts_at::text, ends_at::text, all_day
         FROM personal_event
        WHERE ${where.join(" AND ")}
        ORDER BY starts_at
        LIMIT 500`,
      params
    );
    return NextResponse.json({
      events: rows.map((r) => ({
        id: r.id,
        title: r.title,
        startsAt: r.starts_at,
        endsAt: r.ends_at,
        allDay: r.all_day,
        // 화면이 쓰는 date-only 형태를 함께 준다 (기존 스팬 바 규격과 같은 단위)
        startDate: r.starts_at.slice(0, 10),
        endDate: (r.ends_at ?? r.starts_at).slice(0, 10),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    const title = String(payload.title ?? "").trim().slice(0, 200);
    if (!title) return NextResponse.json({ error: "일정 제목을 입력하세요." }, { status: 400 });

    const start = isDate(payload.startDate) ? payload.startDate : null;
    if (!start) return NextResponse.json({ error: "시작 날짜가 필요합니다." }, { status: 400 });
    const end = isDate(payload.endDate) ? payload.endDate : start;
    if (end < start) {
      return NextResponse.json({ error: "종료일이 시작일보다 앞설 수 없습니다." }, { status: 400 });
    }

    // 종일 일정만 만든다 — 시각 단위 일정은 이번 단계 범위가 아니다(§E "하지 않는 것").
    const row = await queryOne<{ id: number }>(
      `INSERT INTO personal_event (owner_actor_id, title, starts_at, ends_at, all_day)
       VALUES ($1, $2, ($3::date)::timestamptz, (($4::date) + 1)::timestamptz - interval '1 second', true)
       RETURNING id`,
      [session.id, title, start, end]
    );
    // 활동 로그를 남기지 않는다 — 개인 일정은 팀 활동이 아니다.
    return NextResponse.json({ id: row!.id });
  } catch (error) {
    return jsonError(error);
  }
}
