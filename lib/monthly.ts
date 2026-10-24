// 월간 보고(개인) — 서버 쪽 (0042_monthly_report.sql).
//
// ── 누가 무엇을 ─────────────────────────────────────────────────────
//   · 쓰는 사람: 초안(AI) · 고치기 · 내기 · 되돌리기 — **자기 것만**
//   · 팀장 · 관리자: 낸 것만 읽고, 확인 · 한 줄 코멘트를 남긴다(글은 못 고친다)
//
// ── AI 초안에 보내는 것 ─────────────────────────────────────────────
// **쓰는 사람이 「AI 초안」을 눌렀을 때만**, 그 사람의 그 달 것만 보낸다:
// 내 기록(본문 · 카테고리 · 날짜) · 내가 끝낸 업무(제목) · 들어간 회의 이름 · 회의 결정.
// 첨부 파일 · 남의 것은 보내지 않는다. 숫자는 서버가 세고, AI 는 글로만 옮긴다.
import { query, queryOne } from "./db";
import { completeText, isDemoMode } from "./llm";
import { createNotification } from "./activity-inbox";
import { hasLead } from "./types";

export class MonthlyError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface MonthlyReport {
  id: number; actorId: number; name: string; month: string; body: string; status: "draft" | "submitted";
  aiAt: string | null; submittedAt: string | null; leadReadAt: string | null; leadReadBy: string | null;
  leadComment: string | null; updatedAt: string;
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
export function checkMonth(m: unknown): string {
  const s = String(m ?? "");
  if (!MONTH.test(s)) throw new MonthlyError("달이 올바르지 않습니다(YYYY-MM).");
  return s;
}

const COLS = `r.id, r.actor_id, a.display_name AS name, r.month, r.body, r.status, r.ai_at::text, r.submitted_at::text,
  r.lead_read_at::text, lr.display_name AS lead_read_by, r.lead_comment, r.updated_at::text`;
type Row = { id: number; actor_id: number; name: string; month: string; body: string; status: "draft" | "submitted";
  ai_at: string | null; submitted_at: string | null; lead_read_at: string | null; lead_read_by: string | null;
  lead_comment: string | null; updated_at: string };
const toReport = (r: Row): MonthlyReport => ({
  id: r.id, actorId: r.actor_id, name: r.name, month: r.month, body: r.body, status: r.status, aiAt: r.ai_at,
  submittedAt: r.submitted_at, leadReadAt: r.lead_read_at, leadReadBy: r.lead_read_by, leadComment: r.lead_comment, updatedAt: r.updated_at,
});
const FROM = `FROM monthly_report r JOIN actor a ON a.id = r.actor_id LEFT JOIN actor lr ON lr.id = r.lead_read_by`;

export async function getMine(actorId: number, month: string): Promise<MonthlyReport | null> {
  const r = await queryOne<Row>(`SELECT ${COLS} ${FROM} WHERE r.actor_id = $1 AND r.month = $2`, [actorId, month]);
  return r ? toReport(r) : null;
}

/** 팀장 화면 — 그 달에 **낸** 보고만. 쓰는 중인 것은 안 보인다 */
export async function listSubmitted(month: string): Promise<MonthlyReport[]> {
  const rows = await query<Row>(`SELECT ${COLS} ${FROM} WHERE r.month = $1 AND r.status = 'submitted' ORDER BY r.submitted_at`, [month]);
  return rows.map(toReport);
}

export async function saveBody(actorId: number, month: string, raw: unknown): Promise<MonthlyReport> {
  const body = String(raw ?? "").slice(0, 20000);
  await query(
    `INSERT INTO monthly_report (actor_id, month, body) VALUES ($1, $2, $3)
     ON CONFLICT (actor_id, month) DO UPDATE SET body = EXCLUDED.body, updated_at = now()`, [actorId, month, body]);
  return (await getMine(actorId, month))!;
}

export async function submit(actorId: number, name: string, month: string): Promise<MonthlyReport> {
  const cur = await getMine(actorId, month);
  if (!cur || !cur.body.trim()) throw new MonthlyError("보고가 비었습니다. 쓰고 나서 내세요.");
  // 다시 낼 때는 지난 확인 · 코멘트를 지운다 — 고친 글에 옛 코멘트가 붙어 있으면 새 글을 읽은 것처럼 보인다
  await query(`UPDATE monthly_report SET status = 'submitted', submitted_at = now(), lead_read_at = NULL, lead_read_by = NULL,
                  lead_comment = NULL, updated_at = now()
                WHERE id = $1`, [cur.id]);
  // 팀장 · 관리자 알림함에 — 「보고 확인 요청」
  const leads = await query<{ id: number; role: string; admin_grant: boolean | null }>(
    `SELECT a.id, ac.role, (to_jsonb(ac) ->> 'admin_grant')::boolean AS admin_grant
       FROM actor a JOIN account ac ON ac.actor_id = a.id WHERE a.is_active AND a.type = 'human'`);
  for (const l of leads) {
    if (l.id === actorId || !(hasLead(l.role) || l.admin_grant)) continue;
    await createNotification({ userId: l.id, type: "approval", refType: "monthly_report", refId: cur.id,
      snippet: `${name} · ${Number(month.slice(5))}월 월간 보고를 냈습니다`, actorId, dedupeKey: `monthly:${cur.id}:${Date.now()}` }).catch(() => {});
  }
  return (await getMine(actorId, month))!;
}

export async function withdraw(actorId: number, month: string): Promise<MonthlyReport> {
  const cur = await getMine(actorId, month);
  if (!cur) throw new MonthlyError("보고가 없습니다.", 404);
  await query(`UPDATE monthly_report SET status = 'draft', submitted_at = NULL, updated_at = now() WHERE id = $1`, [cur.id]);
  return (await getMine(actorId, month))!;
}

/** 팀장 — 확인 · 한 줄 코멘트. 낸 보고에만. 쓴 사람 알림함에 「답글」로 간다 */
export async function leadReview(reportId: number, lead: { id: number; name: string }, rawComment: unknown): Promise<MonthlyReport> {
  const r = await queryOne<Row>(`SELECT ${COLS} ${FROM} WHERE r.id = $1 AND r.status = 'submitted'`, [reportId]);
  if (!r) throw new MonthlyError("낸 보고를 찾을 수 없습니다.", 404);
  const comment = rawComment === undefined ? r.lead_comment : (String(rawComment ?? "").trim().slice(0, 500) || null);
  await query(`UPDATE monthly_report SET lead_read_by = $2, lead_read_at = now(), lead_comment = $3 WHERE id = $1`, [reportId, lead.id, comment]);
  await createNotification({ userId: r.actor_id, type: "reply", refType: "monthly_report", refId: reportId,
    snippet: `${lead.name} · ${Number(r.month.slice(5))}월 보고 확인${comment ? ` — ${comment}` : ""}`, actorId: lead.id, bundle: true }).catch(() => {});
  return toReport((await queryOne<Row>(`SELECT ${COLS} ${FROM} WHERE r.id = $1`, [reportId]))!);
}

/** 그 달의 내 사실 — AI 초안 재료 */
export async function facts(actorId: number, month: string) {
  const from = `${month}-01`;
  const logs = await query<{ day: string; body: string; cat: string | null }>(
    `SELECT w.logged_on::text AS day, w.body, c.name AS cat FROM work_log w LEFT JOIN work_log_category c ON c.id = w.category_id
      WHERE w.owner_actor_id = $1 AND w.is_active AND w.logged_on >= $2::date AND w.logged_on < ($2::date + interval '1 month')
      ORDER BY w.logged_on, w.id LIMIT 300`, [actorId, from]);
  const done = await query<{ title: string }>(
    `SELECT t.title FROM task t WHERE t.is_active AND t.assignee_id = $1 AND t.status = 'done'
        AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date
        AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date < ($2::date + interval '1 month')
      ORDER BY t.completed_at LIMIT 100`, [actorId, from]);
  const meetings = await query<{ title: string }>(
    `SELECT DISTINCT m.title FROM meeting m JOIN meeting_attendee x ON x.meeting_id = m.id AND x.actor_id = $1
      WHERE (m.started_at AT TIME ZONE 'Asia/Seoul')::date >= $2::date
        AND (m.started_at AT TIME ZONE 'Asia/Seoul')::date < ($2::date + interval '1 month') LIMIT 30`, [actorId, from]);
  return { month, logs, done: done.map((d) => d.title), meetings: meetings.map((m) => m.title) };
}

export const SYSTEM = `당신은 「AI 로봇 플랫폼팀」 팀원 한 사람의 월간 업무 보고 초안을 쓰는 보조입니다. 읽는 사람은 팀장입니다.

절대 규칙:
- 주어진 사실(JSON)에 없는 일 · 수치 · 성과 · 평가를 만들지 않는다. 부풀리지 않는다.
- 개수는 JSON 의 값을 그대로 쓴다. 비슷한 기록은 한 줄로 묶어도 되지만 없는 내용을 더하지 않는다.
- 한국어, 짧은 문장. 마크다운 제목은 아래 순서로 쓴다(## 로 시작):
  이번 달 요약 · 한 일 · 끝낸 업무 · 회의 · 다음 달에 이어서 할 것
- 「한 일」은 기록의 카테고리별로 묶는다(카테고리가 없으면 「기타」).
- 「다음 달에 이어서 할 것」은 기록에서 「진행 중 · 다음에 · 이어서」처럼 끝나지 않은 것으로 읽히는 것만. 없으면 「없음」.
- 해당 사실이 없는 칸은 「없음」 한 줄.`;

/** 데모(키 없음) 초안 — 사실을 그대로 묶는다. 문장을 지어내지 않는다 */
export function demoDraft(f: Awaited<ReturnType<typeof facts>>): string {
  const byCat = new Map<string, string[]>();
  for (const l of f.logs) { const k = l.cat ?? "기타"; byCat.set(k, [...(byCat.get(k) ?? []), `${l.day.slice(5)} ${l.body}`]); }
  return [
    `## 이번 달 요약`, `- (데모 — AI 키가 없어 사실만 묶었습니다) 기록 ${f.logs.length}줄 · 끝낸 업무 ${f.done.length}건 · 회의 ${f.meetings.length}번`,
    `## 한 일`, ...Array.from(byCat.entries()).flatMap(([k, xs]) => [`### ${k}`, ...xs.map((x: string) => `- ${x}`)]),
    `## 끝낸 업무`, ...(f.done.length ? f.done.map((t) => `- ${t}`) : ["- 없음"]),
    `## 회의`, ...(f.meetings.length ? f.meetings.map((t) => `- ${t}`) : ["- 없음"]),
    `## 다음 달에 이어서 할 것`, `- (직접 적어 주세요)`,
  ].join("\n");
}
export const draftHeader = (name: string, month: string) => `# ${name} · ${Number(month.slice(0, 4))}년 ${Number(month.slice(5))}월 업무 보고\n\n`;
export const draftUser = (name: string, month: string, f: Awaited<ReturnType<typeof facts>>) =>
  `사람: ${name}\n달: ${month}\n\n사실(JSON):\n${JSON.stringify(f)}\n\n위 사실만으로 월간 보고 초안을 쓰세요.`;

/** AI 초안을 만들어도 되는가 — 낸 보고는 못 덮고, 재료가 없으면 만들지 않는다. 사실을 돌려준다 */
export async function draftReady(actorId: number, month: string) {
  const cur = await getMine(actorId, month);
  if (cur?.status === "submitted") throw new MonthlyError("이미 낸 보고입니다. 되돌린 뒤에 초안을 다시 만드세요.", 409);
  const f = await facts(actorId, month);
  if (!f.logs.length && !f.done.length) throw new MonthlyError("이 달에는 내 기록도 끝낸 업무도 없습니다 — 초안을 만들 재료가 없습니다.");
  return f;
}

/** 흘려 쓴 초안을 저장한다 — 그사이 냈으면 덮지 않는다 */
export async function saveDraft(actorId: number, month: string, body: string): Promise<MonthlyReport | null> {
  const cur = await getMine(actorId, month);
  if (cur?.status === "submitted") return null;
  await saveBody(actorId, month, body);
  await query(`UPDATE monthly_report SET ai_at = now() WHERE actor_id = $1 AND month = $2`, [actorId, month]);
  return getMine(actorId, month);
}

/** AI 초안 — 만든 글을 그 달 보고 본문으로 저장한다(낸 보고는 못 덮는다) */
export async function draftWithAI(actorId: number, name: string, month: string): Promise<MonthlyReport> {
  const f = await draftReady(actorId, month);
  const text = isDemoMode() ? demoDraft(f) : await completeText(SYSTEM, draftUser(name, month, f));
  return (await saveDraft(actorId, month, `${draftHeader(name, month)}${text.trim()}`))!;
}

/**
 * 팀장 화면 「팀원 보고」 — 팀원 전부의 그 달 상태(2026-10 리디자인).
 *   submitted · read(확인함) · writing(쓰는 중) · none(미작성)
 * 쓰는 중인 글은 **본문을 내주지 않는다**(쓰는 중에는 나만 본다 — 0042 규칙).
 */
export interface TeamRow { actorId: number; name: string; state: "none" | "writing" | "submitted" | "read"; report: MonthlyReport | null }
export async function teamStatus(month: string, leadId: number): Promise<TeamRow[]> {
  const people = await query<{ id: number; name: string }>(
    `SELECT a.id, a.display_name AS name FROM actor a JOIN account ac ON ac.actor_id = a.id
      WHERE a.is_active AND a.type = 'human' AND a.id <> $1 ORDER BY a.id`, [leadId]);
  const rows = await query<Row>(`SELECT ${COLS} ${FROM} WHERE r.month = $1`, [month]);
  const by = new Map(rows.map((r) => [r.actor_id, toReport(r)]));
  return people.map((p) => {
    const r = by.get(p.id) ?? null;
    if (!r || (r.status === "draft" && !r.body.trim())) return { actorId: p.id, name: p.name, state: "none", report: null };
    if (r.status === "draft") return { actorId: p.id, name: p.name, state: "writing", report: { ...r, body: "" } };
    return { actorId: p.id, name: p.name, state: r.leadReadAt ? "read" : "submitted", report: r };
  });
}
