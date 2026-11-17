// 업무일지 한 달 — 기록 + 카테고리 + 끝낸 업무(「완료」 줄) + 걸린 업무 이름. 쓰기는 기존 `/api/worklog` 그대로.
//   ?owner=ID — 팀장이 팀원의 업무일지를 본다(읽기만, 2026-11). 팀장이 아니면 403.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { queryOne } from "@/lib/db";
import { isLeadUser } from "@/lib/task-permission";
import { doneTasksOfMonth, listMonth, parseMonth, taskTitles } from "@/lib/worklog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const s = requireSession();
    const u = new URL(request.url);
    const month = parseMonth(u.searchParams.get("month"));
    const ownerRaw = Number(u.searchParams.get("owner"));
    const owner = Number.isInteger(ownerRaw) && ownerRaw > 0 ? ownerRaw : s.id;
    if (owner !== s.id && !isLeadUser(s)) return NextResponse.json({ error: "팀원의 업무일지는 팀장만 봅니다." }, { status: 403 });
    const who = owner === s.id ? null : await queryOne<{ id: number; name: string }>(
      `SELECT id, display_name AS name FROM actor WHERE id = $1 AND type = 'human'`, [owner]);
    if (owner !== s.id && !who) return NextResponse.json({ error: "사람을 찾을 수 없습니다." }, { status: 404 });
    const [m, done] = await Promise.all([listMonth(owner, month), doneTasksOfMonth(owner, month)]);
    const tasks = await taskTitles(Array.from(new Set(m.entries.map((e) => e.taskId).filter((x): x is number => !!x))), s.id);
    return NextResponse.json({ month, ...m, done, tasks, owner: who, readOnly: owner !== s.id });
  } catch (error) { return jsonError(error); }
}
