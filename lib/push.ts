// 데스크톱 알림 — 웹 푸시 보내기 (0041_push_subscription.sql).
//
// 열쇠(VAPID)는 환경 변수 셋: `VAPID_PUBLIC_KEY` · `VAPID_PRIVATE_KEY` · `VAPID_SUBJECT`(mailto:…).
// 없으면 알림은 **조용히 꺼진 상태**다 — 화면이 「설정이 필요합니다」를 말하고, 업무 저장 같은
// 본 일은 절대 막지 않는다(보내기 실패는 삼킨다).
//
// 보내는 쪽(업무 배정 · 회의 시작 · 아침 마감)은 `notify()` 하나만 부른다. 기다리는 시간은 짧게
// 자른다 — 알림 때문에 업무 저장이 느려지면 안 된다.
import webpush from "web-push";
import { query } from "./db";

export type PushKind = "assign" | "meeting" | "due";
export const PUSH_KINDS: { key: PushKind; label: string }[] = [
  { key: "assign", label: "나에게 업무가 오면" },
  { key: "meeting", label: "회의가 열리면" },
  { key: "due", label: "아침 9시 마감 알림" },
];
export interface PushMessage { title: string; body: string; url: string; tag?: string }

export function pushPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}
let configured: boolean | null = null;
function ready(): boolean {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim(), priv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!pub || !priv) return (configured = false);
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || "mailto:admin@example.com", pub, priv);
  return (configured = true);
}

/**
 * 기기 하나에 — 404 · 410 이면 끊긴 기기로 표시.
 * 암호화 · VAPID 서명은 web-push 가 만들고(`generateRequestDetails`), 보내기는 `fetch` 로 한다 —
 * 같은 바이트다. 이렇게 해야 로컬 검사기(`scripts/push-walk.mjs`)의 흉내 서버(http)에도 보낼 수 있다.
 */
async function sendOne(s: { id: number; endpoint: string; p256dh: string; auth: string }, msg: PushMessage): Promise<boolean> {
  let code = 0;
  try {
    const req = webpush.generateRequestDetails({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
      JSON.stringify(msg), { TTL: 60 * 60 * 6 });
    const r = await fetch(req.endpoint, { method: req.method, headers: req.headers as Record<string, string>,
      body: req.body as unknown as BodyInit, signal: AbortSignal.timeout(4000) });
    code = r.status;
    if (r.ok) {
      await query(`UPDATE push_subscription SET last_ok_at = now(), fail_count = 0 WHERE id = $1`, [s.id]);
      return true;
    }
  } catch { /* 네트워크 실패 — 아래에서 센다 */ }
  await query(
    code === 404 || code === 410
      ? `UPDATE push_subscription SET disabled_at = now() WHERE id = $1`
      : `UPDATE push_subscription SET fail_count = fail_count + 1 WHERE id = $1`, [s.id]).catch(() => {});
  return false;
}

/**
 * 사람들에게 알림. 그 종류를 켠 기기에만 간다. 실패는 삼키고 보낸 수만 돌려준다.
 * `waitMs` 를 넘기면 기다리지 않고 돌아온다(보내기는 계속된다 — 서버리스에서는 잘릴 수 있다).
 */
export async function notify(actorIds: number[], kind: PushKind, msg: PushMessage, waitMs = 3500): Promise<number> {
  if (!ready() || !actorIds.length) return 0;
  try {
    const subs = await query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
      `SELECT id, endpoint, p256dh, auth FROM push_subscription
        WHERE actor_id = ANY($1) AND disabled_at IS NULL AND $2 = ANY(kinds)`, [actorIds, kind]);
    const all = Promise.all(subs.map((s) => sendOne(s, msg))).then((r) => r.filter(Boolean).length);
    return await Promise.race([all, new Promise<number>((res) => setTimeout(() => res(-1), waitMs))]);
  } catch {
    return 0;
  }
}

/** 시험 알림 — 이 사람의 기기 전부(종류 상관없이) */
export async function notifyTest(actorId: number): Promise<{ sent: number; devices: number }> {
  if (!ready()) return { sent: 0, devices: 0 };
  const subs = await query<{ id: number; endpoint: string; p256dh: string; auth: string }>(
    `SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE actor_id = $1 AND disabled_at IS NULL`, [actorId]);
  const r = await Promise.all(subs.map((s) => sendOne(s, {
    title: "알림이 켜졌습니다", body: "AI 로봇 플랫폼팀 통합업무관리 — 이 기기로 알림이 옵니다.", url: "/v3/control", tag: "test" })));
  return { sent: r.filter(Boolean).length, devices: subs.length };
}

/**
 * 아침 9시 마감 알림 — 사람마다 한 통: 「오늘 마감 N · 기한 지남 M」.
 * 아침 관제 작업(`/api/cron/team-watch`)이 부른다. 둘 다 0 인 사람에게는 안 보낸다.
 */
export async function pushMorningDue(today: string): Promise<number> {
  if (!ready()) return 0;
  const rows = await query<{ actor_id: number; today_n: string; late_n: string; first: string | null }>(
    `SELECT t.assignee_id AS actor_id,
            count(*) FILTER (WHERE t.due_date = $1::date) AS today_n,
            count(*) FILTER (WHERE t.due_date < $1::date) AS late_n,
            (array_agg(t.title ORDER BY t.due_date, t.id))[1] AS first
       FROM task t JOIN actor a ON a.id = t.assignee_id AND a.is_active
      WHERE t.is_active AND t.status IN ('todo','doing','review') AND t.due_date <= $1::date
      GROUP BY t.assignee_id`, [today]);
  let sent = 0;
  for (const r of rows) {
    const n = Number(r.today_n), late = Number(r.late_n);
    const parts = [n ? `오늘 마감 ${n}건` : "", late ? `기한 지남 ${late}건` : ""].filter(Boolean);
    const got = await notify([r.actor_id], "due", {
      title: parts.join(" · "), body: r.first ? `가장 급한 것: ${r.first}` : "", url: "/v3/tasks?mine=1", tag: `due-${today}`,
    }, 8000);
    if (got > 0) sent += got;
  }
  return sent;
}
