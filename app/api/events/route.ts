// 일정 — 조회(캘린더 주·월 뷰) · 팀 일정 등록.
//
// 날짜 규칙(종일 일정) — 화면은 날짜만 주고받는다(YYYY-MM-DD, KST).
//   start_at = 시작일 00:00 KST
//   end_at   = 종료일 **다음 날** 00:00 KST (끝 미포함)
//   예) 10/29~10/30 → 2026-10-29T00:00+09:00 ~ 2026-10-31T00:00+09:00
// 돌려줄 때는 startDate · endDate(종료일 포함)로 다시 바꿔 준다. 시각이 있는 옛 일정(데모 회의 등)도 같은 규칙으로 날짜가 나온다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { isoify } from "@/lib/home";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { addDays, diffDays, md } from "@/lib/ed/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "+09:00";
// ↓ 확인 규칙 셋은 [id]/route.ts 에 같은 것이 있다 — route 파일은 다른 이름을 내보낼 수 없어서 둘 다 적는다.
const MAX_SPAN = 60; // 일 — 실수로 몇 달짜리 막대가 깔리지 않게
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v; // 2월 30일 같은 날을 거른다

/** 제목 · 날짜 확인 — 틀리면 문구, 맞으면 null */
function checkEvent(title: string, start: unknown, end: unknown): string | null {
  if (!title) return "일정 제목을 입력하세요.";
  if (title.length > 120) return "제목은 120자까지입니다.";
  if (!isDate(start) || !isDate(end)) return "시작일 · 종료일(YYYY-MM-DD)이 필요합니다.";
  if (end < start) return "종료일이 시작일보다 앞설 수 없습니다.";
  if (diffDays(end, start) + 1 > MAX_SPAN) return `일정은 ${MAX_SPAN}일까지 잡을 수 있습니다.`;
  return null;
}
/** 종일 일정 → 저장값 (끝은 종료일 다음 날 0시, 미포함) */
const toRange = (start: string, end: string): [string, string] =>
  [`${start}T00:00:00${TZ}`, `${addDays(end, 1)}T00:00:00${TZ}`];
/** 로그용 `(10.29~10.30)` · 하루면 `(10.29)` */
const spanLabel = (start: string, end: string) => `(${md(start)}${end !== start ? `~${md(end)}` : ""})`;

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from ?? "") || !/^\d{4}-\d{2}-\d{2}$/.test(to ?? "")) {
      return NextResponse.json({ error: "from/to(YYYY-MM-DD)가 필요합니다." }, { status: 400 });
    }
    const rows = await query<{
      id: number;
      title: string;
      start_at: string;
      end_at: string;
      start_date: string;
      end_date: string;
      start_time: string;
      all_day: boolean;
      color_key: string | null;
      is_team: boolean;
      created_by: number | null;
      created_by_name: string | null;
      participant_ids: number[] | null;
    }>(
      `SELECT e.id, e.title, e.start_at::text, e.end_at::text, p.color_key, e.is_team,
              to_char(e.start_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS start_date,
              to_char(GREATEST(e.start_at, e.end_at - interval '1 second') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS end_date,
              to_char(e.start_at AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS start_time,
              (e.end_at > e.start_at
                AND (e.start_at AT TIME ZONE 'Asia/Seoul')::time = '00:00'
                AND (e.end_at AT TIME ZONE 'Asia/Seoul')::time = '00:00') AS all_day,
              e.created_by, a.display_name AS created_by_name,
              array_agg(ep.actor_id) FILTER (WHERE ep.actor_id IS NOT NULL) AS participant_ids
       FROM event e
       LEFT JOIN project p ON p.id = e.project_id
       LEFT JOIN actor a ON a.id = e.created_by
       LEFT JOIN event_participant ep ON ep.event_id = e.id
       WHERE e.is_active = true AND e.start_at < $2::timestamptz AND e.end_at > $1::timestamptz
       GROUP BY e.id, p.color_key, a.display_name
       ORDER BY e.start_at`,
      [`${from}T00:00:00${TZ}`, `${to}T00:00:00${TZ}`]
    );
    return NextResponse.json({
      events: rows.map((e) => ({
        id: e.id,
        title: e.title,
        startAt: isoify(e.start_at),
        endAt: isoify(e.end_at),
        startDate: e.start_date,
        endDate: e.end_date,
        allDay: e.all_day,
        startTime: e.all_day ? null : e.start_time,
        colorKey: e.color_key,
        isTeam: e.is_team,
        createdBy: e.created_by,
        createdByName: e.created_by_name,
        participantIds: e.participant_ids ?? [],
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** 팀 일정 등록 — { title, startDate, endDate? } (종료일이 없으면 하루짜리) */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json().catch(() => ({}));
    const title = String(payload.title ?? "").trim();
    const start = payload.startDate;
    const end = payload.endDate ?? start;
    const bad = checkEvent(title, start, end);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    const [s, e] = toRange(start, end);
    const row = await queryOne<{ id: number }>(
      `INSERT INTO event (title, start_at, end_at, is_team, created_by)
       VALUES ($1, $2::timestamptz, $3::timestamptz, true, $4) RETURNING id`,
      [title, s, e, session.id]
    );
    await logActivity({ userId: session.id, message: `${session.name}이(가) 일정 등록 — "${title}" ${spanLabel(start, end)}` });
    return NextResponse.json({ id: row!.id });
  } catch (error) {
    return jsonError(error);
  }
}
