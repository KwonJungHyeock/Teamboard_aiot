// 아침 관제 알림 — 매일 09:00(서울) 한 번 (2026-10 관제 패널).
//
// ── 누구에게 무엇을 ─────────────────────────────────────────────
//   · 담당자 본인 — 기한 지남(업무마다 한 번) · 소식 없음(손댄 뒤 다시 조용해질 때마다 한 번)
//   · 팀장 · 관리자 — **하루 한 장 요약.** 업무마다 보내면 팀장 인박스가 관제 화면이 된다
//   지시: 「알림은 본인과 팀장에게만」. 팀 전체에 뿌리지 않는다.
//
// ── 같은 알림을 두 번 만들지 않는다 ──────────────────────────────
// 기한 지남 키는 인박스가 열릴 때 만드는 것(`syncDeadlineNotifications`)과 **같은 키**
// `deadline:{업무}:overdue` 다. 어느 쪽이 먼저 만들어도 한 건이다.
//
// ── 비공개 업무는 담당자 본인에게만 ───────────────────────────────
// 팀장 요약은 `visibility = 'team'` 만 센다. 남의 비공개 업무를 숫자로라도 새지 않는다.
import { query } from "./db";
import { kstToday } from "./home";
import { createNotification } from "./activity-inbox";
import { QUIET_DAYS, HEAVY_WEEK, HEAVY_OPEN } from "./control";

const OPEN = `('todo','doing','review')`;

function weekEnd(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? 0 : 7 - dow));
  return d.toISOString().slice(0, 10);
}

export interface WatchResult { day: string; late: number; quiet: number; heavy: number; sent: number }

export async function runControlWatch(): Promise<WatchResult> {
  const day = kstToday();
  let sent = 0;
  const count = (r: string) => { if (r === "created") sent++; };

  // ① 담당자 — 기한 지남
  const late = await query<{ id: number; title: string; assignee_id: number; days: number; vis: string }>(
    `SELECT t.id, t.title, t.assignee_id, ($1::date - t.due_date) AS days, t.visibility AS vis
       FROM task t JOIN actor a ON a.id = t.assignee_id AND a.is_active
      WHERE t.is_active AND t.status IN ${OPEN} AND t.due_date < $1::date`,
    [day]
  );
  for (const t of late) {
    count(await createNotification({
      userId: t.assignee_id, type: "overdue", refType: "task", refId: t.id, actorId: null,
      snippet: `기한 ${t.days}일 지남 · ${t.title}`, dedupeKey: `deadline:${t.id}:overdue`,
    }));
  }

  // ② 담당자 — 소식 없음 (지남은 ①이 이미 말했으니 뺀다)
  const quiet = await query<{ id: number; title: string; assignee_id: number; days: number; touched: string; vis: string }>(
    `SELECT t.id, t.title, t.assignee_id, t.visibility AS vis,
            ($1::date - (t.updated_at AT TIME ZONE 'Asia/Seoul')::date) AS days,
            (t.updated_at AT TIME ZONE 'Asia/Seoul')::date::text AS touched
       FROM task t JOIN actor a ON a.id = t.assignee_id AND a.is_active
      WHERE t.is_active AND t.status IN ('doing','review')
        AND t.updated_at < now() - interval '${QUIET_DAYS} days'
        AND (t.due_date IS NULL OR t.due_date >= $1::date)`,
    [day]
  );
  for (const t of quiet) {
    count(await createNotification({
      userId: t.assignee_id, type: "system", refType: "task", refId: t.id, actorId: null,
      snippet: `${t.days}일째 소식 없음 · ${t.title} — 진행을 한 줄 남기거나 상태를 바꿔 주세요`,
      // 손댄 날이 키에 들어간다 — 손대면 키가 바뀌어, 다시 조용해질 때 한 번 더 온다.
      dedupeKey: `watch-quiet:${t.id}:${t.touched}`,
    }));
  }

  // ③ 몰림 — 팀 공개 업무만 센다
  const heavy = await query<{ id: number; name: string; open: string; week: string }>(
    `SELECT a.id, a.display_name AS name,
            count(*) FILTER (WHERE t.status IN ${OPEN}) AS open,
            count(*) FILTER (WHERE t.status IN ${OPEN} AND t.due_date BETWEEN $1::date AND $2::date) AS week
       FROM actor a JOIN task t ON t.assignee_id = a.id AND t.is_active AND t.visibility = 'team'
      WHERE a.type = 'human' AND a.is_active
      GROUP BY a.id, a.display_name
     HAVING count(*) FILTER (WHERE t.status IN ${OPEN} AND t.due_date BETWEEN $1::date AND $2::date) >= ${HEAVY_WEEK}
         OR count(*) FILTER (WHERE t.status IN ${OPEN}) >= ${HEAVY_OPEN}`,
    [day, weekEnd(day)]
  );

  // ④ 팀장 · 관리자 — 하루 한 장
  const teamLate = late.filter((t) => t.vis === "team").length;
  const teamQuiet = quiet.filter((t) => t.vis === "team").length;
  if (teamLate + teamQuiet + heavy.length > 0) {
    const leads = await query<{ actor_id: number }>(
      `SELECT ac.actor_id FROM account ac JOIN actor a ON a.id = ac.actor_id
        WHERE (ac.role IN ('admin','lead')) AND a.is_active`
    );
    const parts = [
      teamLate ? `기한 지남 ${teamLate}` : "",
      teamQuiet ? `${QUIET_DAYS}일 넘게 소식 없음 ${teamQuiet}` : "",
      heavy.length ? `몰림 ${heavy.map((h) => h.name).join("·")}` : "",
    ].filter(Boolean).join(" · ");
    for (const l of leads) {
      count(await createNotification({
        userId: l.actor_id, type: "system", refType: "system", refId: null, actorId: null,
        snippet: `오늘 관제 — ${parts}`, dedupeKey: `watch-digest:${day}`,
      }));
    }
  }

  return { day, late: late.length, quiet: quiet.length, heavy: heavy.length, sent };
}
