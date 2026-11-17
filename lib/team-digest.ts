// 주간 요약 · 업무일지 빈 날 알림 (2026-11 모니터링) — 아침 관제(`/api/cron/team-watch`, 09:00 서울)가 함께 부른다.
//
//   · 월요일 아침 — 주간 요약. 사람마다 「지난주 완료 · 지남 · 이번 주 기한 · 기록한 날」 한 장(본인 것),
//     팀장에게는 팀 한 장(지난주 완료 · 기한 준수율 · 지남 · 이번 주 기한 · 기록이 빈 사람).
//   · 평일 아침 — 어제(월요일이면 금요일) 업무일지가 비었으면 본인에게 한 번, 팀장에게는 이름을 모아 한 번.
//     그날 끝낸 업무가 있으면 일지에 「완료」 줄로 이미 보이므로 빈 날로 치지 않는다.
//   주말은 세지 않는다. 같은 알림은 두 번 만들지 않는다(dedupeKey).
//   팀장 숫자는 팀 공개 업무만 센다 — 남의 비공개 업무를 숫자로라도 새지 않는다(lib/control-watch.ts 와 같은 규칙).
import { query } from "./db";
import { createNotification } from "./activity-inbox";

const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();   // 0 일 … 6 토
const md = (iso: string) => `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
const WD = ["일", "월", "화", "수", "목", "금", "토"];
const OPEN = `('todo','doing','review','hold')`;

interface Person { id: number; name: string; lead: boolean }
async function people(): Promise<Person[]> {
  const rows = await query<{ id: number; name: string; role: string; admin_grant: boolean | null }>(
    `SELECT a.id, a.display_name AS name, ac.role, ac.admin_grant FROM actor a JOIN account ac ON ac.actor_id = a.id
      WHERE a.type = 'human' AND a.is_active ORDER BY a.id`);
  return rows.map((r) => ({ id: r.id, name: r.name, lead: r.role === "lead" || r.role === "admin" || r.admin_grant === true }));
}

/** 그 날 업무일지(기록 · 끝낸 업무)가 있는 사람 */
async function loggedOn(day: string): Promise<Set<number>> {
  const rows = await query<{ id: number }>(
    `SELECT owner_actor_id AS id FROM work_log WHERE is_active AND logged_on = $1::date
     UNION SELECT assignee_id FROM task WHERE is_active AND status = 'done' AND assignee_id IS NOT NULL
        AND (completed_at AT TIME ZONE 'Asia/Seoul')::date = $1::date`, [day]);
  return new Set(rows.map((r) => r.id));
}

/** 평일 아침 — 어제(평일) 업무일지가 빈 사람에게 */
export async function remindNoLog(today: string): Promise<{ day: string | null; missing: number; sent: number }> {
  const w = dow(today);
  if (w === 0 || w === 6) return { day: null, missing: 0, sent: 0 };
  const day = addDays(today, w === 1 ? -3 : -1);
  const ps = await people();
  const has = await loggedOn(day);
  const miss = ps.filter((p) => !has.has(p.id));
  let sent = 0;
  for (const p of miss) {
    const r = await createNotification({ userId: p.id, type: "system", refType: "worklog", refId: null, actorId: null,
      snippet: `${md(day)}(${WD[dow(day)]}) 업무일지가 비어 있습니다 — 한 줄 남겨 주세요`, dedupeKey: `nolog:${day}:${p.id}` });
    if (r === "created") sent++;
  }
  const others = miss.filter((p) => !p.lead);
  if (others.length) {
    for (const l of ps.filter((p) => p.lead)) {
      const r = await createNotification({ userId: l.id, type: "system", refType: "worklog", refId: null, actorId: null,
        snippet: `${md(day)}(${WD[dow(day)]}) 업무일지 없음 — ${others.map((p) => p.name).join(" · ")}`, dedupeKey: `nolog-lead:${day}:${l.id}` });
      if (r === "created") sent++;
    }
  }
  return { day, missing: miss.length, sent };
}

/** 월요일 아침 — 주간 요약 */
export async function runWeeklyDigest(today: string): Promise<{ week: string | null; sent: number }> {
  if (dow(today) !== 1) return { week: null, sent: 0 };
  const a = addDays(today, -7), b = addDays(today, -1), e = addDays(today, 6);
  const ps = await people();
  const rows = await query<{ assignee_id: number; vis: string; status: string; due: string | null; done_on: string | null; touched: string }>(
    `SELECT t.assignee_id, t.visibility AS vis, t.status, t.due_date::text AS due,
            ((t.completed_at AT TIME ZONE 'Asia/Seoul')::date)::text AS done_on, (t.updated_at AT TIME ZONE 'Asia/Seoul')::date::text AS touched
       FROM task t WHERE t.is_active AND t.parent_task_id IS NULL AND t.assignee_id IS NOT NULL AND t.status <> 'proposed'
        AND (t.status IN ${OPEN} OR ((t.completed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date))`, [a, b]);
  const logs = await query<{ id: number; days: string }>(
    `SELECT owner_actor_id AS id, count(DISTINCT logged_on) AS days FROM work_log
      WHERE is_active AND logged_on BETWEEN $1::date AND $2::date AND extract(isodow FROM logged_on) < 6 GROUP BY owner_actor_id`, [a, b]);
  const logDays = new Map(logs.map((l) => [l.id, Number(l.days)]));
  const sum = (xs: typeof rows) => {
    const done = xs.filter((r) => r.status === "done" && r.done_on && r.done_on >= a && r.done_on <= b);
    const dueDone = done.filter((r) => r.due);
    const open = xs.filter((r) => r.status !== "done" && r.status !== "dropped");
    return {
      done: done.length, onTime: dueDone.filter((r) => r.done_on! <= r.due!).length, dueDone: dueDone.length,
      over: open.filter((r) => r.due && r.due < today).length,
      week: open.filter((r) => r.due && r.due >= today && r.due <= e).length,
      quiet: open.filter((r) => (r.status === "doing" || r.status === "review") && r.touched < addDays(today, -5)).length,
    };
  };
  let sent = 0;
  const label = `${md(a)}~${md(b)}`;
  for (const p of ps) {
    const s = sum(rows.filter((r) => r.assignee_id === p.id));
    const parts = [`완료 ${s.done}`, s.over ? `지남 ${s.over}` : "", `이번 주 기한 ${s.week}`, `기록 ${logDays.get(p.id) ?? 0}/5일`].filter(Boolean);
    const r = await createNotification({ userId: p.id, type: "system", refType: "person", refId: p.id, actorId: null,
      snippet: `주간 요약 ${label} — ${parts.join(" · ")}`, dedupeKey: `weekly:${today}:${p.id}` });
    if (r === "created") sent++;
  }
  const team = sum(rows.filter((r) => r.vis === "team"));
  const lowLog = ps.filter((p) => !p.lead && (logDays.get(p.id) ?? 0) < 3).map((p) => p.name);
  const parts = [
    `완료 ${team.done}${team.dueDone ? `(기한 준수 ${Math.round((team.onTime / team.dueDone) * 100)}%)` : ""}`,
    team.over ? `지남 ${team.over}` : "", `이번 주 기한 ${team.week}`, team.quiet ? `멈춘 업무 ${team.quiet}` : "",
    lowLog.length ? `기록 3일 미만 ${lowLog.join("·")}` : "",
  ].filter(Boolean);
  for (const l of ps.filter((p) => p.lead)) {
    const r = await createNotification({ userId: l.id, type: "system", refType: "stats", refId: null, actorId: null,
      snippet: `팀 주간 요약 ${label} — ${parts.join(" · ")}`, dedupeKey: `weekly-team:${today}:${l.id}` });
    if (r === "created") sent++;
  }
  return { week: label, sent };
}
