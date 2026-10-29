// 일정 수정 · 삭제 — 만든 사람이나 팀장만.
// 날짜 규칙은 ../route.ts 머리말과 같다(종일 · 끝은 종료일 다음 날 0시 KST, 미포함).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import { hasLead } from "@/lib/types";
import { addDays, diffDays, md } from "@/lib/ed/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TZ = "+09:00";
const NOT_FOUND = { error: "일정을 찾을 수 없습니다." };
// ↓ ../route.ts 와 같은 규칙 — route 파일은 다른 이름을 내보낼 수 없어서 둘 다 적는다.
const MAX_SPAN = 60;
const isDate = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && addDays(v, 0) === v;
function checkEvent(title: string, start: unknown, end: unknown): string | null {
  if (!title) return "일정 제목을 입력하세요.";
  if (title.length > 120) return "제목은 120자까지입니다.";
  if (!isDate(start) || !isDate(end)) return "시작일 · 종료일(YYYY-MM-DD)이 필요합니다.";
  if (end < start) return "종료일이 시작일보다 앞설 수 없습니다.";
  if (diffDays(end, start) + 1 > MAX_SPAN) return `일정은 ${MAX_SPAN}일까지 잡을 수 있습니다.`;
  return null;
}
const spanLabel = (start: string, end: string) => `(${md(start)}${end !== start ? `~${md(end)}` : ""})`;

interface Row { id: number; title: string; created_by: number | null; start_date: string; end_date: string }

/** 고칠 수 있는 일정인가 — 없으면 404, 권한이 없으면 403 응답을 돌려준다 */
async function load(idText: string): Promise<{ row: Row; session: ReturnType<typeof requireSession> } | NextResponse> {
  const session = requireSession();
  const id = Number(idText);
  if (!Number.isInteger(id)) return NextResponse.json(NOT_FOUND, { status: 404 });
  const row = await queryOne<Row>(
    `SELECT id, title, created_by,
            to_char(start_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS start_date,
            to_char(GREATEST(start_at, end_at - interval '1 second') AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS end_date
       FROM event WHERE id = $1 AND is_active = true`,
    [id]
  );
  if (!row) return NextResponse.json(NOT_FOUND, { status: 404 });
  if (row.created_by !== session.id && !hasLead(session.role)) {
    return NextResponse.json({ error: "만든 사람이나 팀장만 고칠 수 있습니다." }, { status: 403 });
  }
  return { row, session };
}

/** { title?, startDate?, endDate? } — 날짜를 하나라도 주면 종일 일정으로 다시 적는다 */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const got = await load(params.id);
    if (got instanceof NextResponse) return got;
    const { row, session } = got;
    const payload = await request.json().catch(() => ({}));

    const title = typeof payload.title === "string" ? payload.title.trim() : row.title;
    const datesGiven = payload.startDate !== undefined || payload.endDate !== undefined;
    const start = payload.startDate ?? row.start_date;
    const end = payload.endDate ?? row.end_date;
    const bad = checkEvent(title, start, end);
    if (bad) return NextResponse.json({ error: bad }, { status: 400 });

    if (datesGiven) {
      await query(`UPDATE event SET title = $2, start_at = $3::timestamptz, end_at = $4::timestamptz WHERE id = $1`,
        [row.id, title, `${start}T00:00:00${TZ}`, `${addDays(end, 1)}T00:00:00${TZ}`]);
    } else {
      // 제목만 — 시각이 있는 옛 일정의 시각을 건드리지 않는다
      await query(`UPDATE event SET title = $2 WHERE id = $1`, [row.id, title]);
    }
    await logActivity({ userId: session.id, message: `${session.name}이(가) 일정 수정 — "${title}" ${spanLabel(start, end)}` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}

/** 지우기 — is_active = false (줄은 남긴다) */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const got = await load(params.id);
    if (got instanceof NextResponse) return got;
    const { row, session } = got;
    await query(`UPDATE event SET is_active = false WHERE id = $1`, [row.id]);
    await logActivity({ userId: session.id, message: `${session.name}이(가) 일정 삭제 — "${row.title}"` });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
