// AI 주간 브리핑 (2026-10 · 승인: 「주간브리핑도 승인」 — 팀 업무를 외부 AI 로 보내 요약).
//
// ── 무엇을 보내나 — **팀 공개인 것만** ─────────────────────────────────
//
//   · 팀 공개 업무(visibility = 'team'): 끝낸 것 · 새로 생긴 것 · 기한 지난 것
//   · 회의(팀 것): 끝난 회의 · 확정한 결정
//   · 목표: 이름과 진척
//
// **보내지 않는 것:** 「내 기록」(나만 봄) · 개인 업무 · 하루 한 줄(그날 팀이 보는 것이지
// 쌓아 두고 요약할 것이 아니다) · 이메일 같은 계정 정보. 사람 이름은 담당 표시로만 간다.
//
// ── 숫자는 서버가 센다 ───────────────────────────────────────────────
// AI 는 받은 사실을 문장으로 옮길 뿐이다. 수치를 새로 만들거나 없는 일을 지어내지 않게
// 프롬프트에 못 박는다(월간 보고 `narrateReport` 와 같은 규칙).
//
// ── 어디 남나 ───────────────────────────────────────────────────────
// `config` 의 `weekly_brief:{주 시작일}` 에 한 주 하나. 새 표를 만들지 않는다 —
// 주마다 한 덩어리를 덮어쓰는 값이라 키-값으로 충분하다.
import { query, queryOne } from "./db";
import { kstToday } from "./home";
import { completeText, isDemoMode } from "./llm";

export interface BriefFacts {
  weekStart: string; weekEnd: string;
  done: { id: number; title: string; who: string | null }[];
  created: number;
  late: { id: number; title: string; who: string | null; due: string }[];
  lateTotal: number;
  meetings: { id: number; title: string; decisions: number; actions: number }[];
  decisions: { body: string; meeting: string }[];
  goals: { title: string; progress: number; periodType: string }[];
}
export interface Brief {
  weekStart: string; weekEnd: string; text: string; generatedAt: string; by: string; demo: boolean;
  facts: { done: number; created: number; lateTotal: number; meetings: number; decisions: number };
}

const keyOf = (weekStart: string) => `weekly_brief:${weekStart}`;

/** 서울 기준 월요일. `offset` -1 = 지난주 */
export function weekOf(offset = 0, today = kstToday()): { start: string; end: string } {
  const d = new Date(`${today}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;                // 월 0 … 일 6
  const start = new Date(d.getTime() - dow * 86400000 + offset * 7 * 86400000);
  const end = new Date(start.getTime() + 6 * 86400000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** 한 주의 사실 — 팀 공개인 것만 */
export async function gatherFacts(weekStart: string, weekEnd: string): Promise<BriefFacts> {
  const range = [weekStart, weekEnd];
  const done = await query<{ id: number; title: string; who: string | null }>(
    `SELECT t.id, t.title, a.display_name AS who FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
      WHERE t.is_active AND t.visibility = 'team' AND t.status = 'done'
        AND (t.completed_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date
      ORDER BY t.completed_at DESC LIMIT 40`, range);
  const created = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM task t WHERE t.is_active AND t.visibility = 'team' AND t.status <> 'proposed'
        AND (t.created_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date`, range);
  // 기한 지남은 「그 주 끝」 기준 — 지난주 브리핑이 오늘의 지연을 말하지 않게
  const late = await query<{ id: number; title: string; who: string | null; due: string }>(
    `SELECT t.id, t.title, a.display_name AS who, t.due_date::text AS due FROM task t LEFT JOIN actor a ON a.id = t.assignee_id
      WHERE t.is_active AND t.visibility = 'team' AND t.status IN ('todo','doing','review')
        AND t.due_date < $1::date + 1 AND t.due_date >= $1::date - 21
      ORDER BY t.due_date LIMIT 15`, [weekEnd]);
  const lateTotal = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM task t WHERE t.is_active AND t.visibility = 'team'
        AND t.status IN ('todo','doing','review') AND t.due_date <= $1::date`, [weekEnd]);
  const meetings = await query<{ id: number; title: string; decisions: string; actions: string }>(
    `SELECT m.id, m.title,
            (SELECT count(*) FROM meeting_item i WHERE i.meeting_id = m.id AND i.is_active AND i.kind = 'decision' AND i.meta ? 'decidedAt') AS decisions,
            (SELECT count(*) FROM meeting_item i WHERE i.meeting_id = m.id AND i.is_active AND i.kind = 'action') AS actions
       FROM meeting m WHERE (m.started_at AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date
      ORDER BY m.started_at LIMIT 20`, range);
  const decisions = await query<{ body: string; meeting: string }>(
    `SELECT i.body, m.title AS meeting FROM meeting_item i JOIN meeting m ON m.id = i.meeting_id
      WHERE i.is_active AND i.kind = 'decision' AND i.meta ? 'decidedAt'
        AND ((i.meta->>'decidedAt')::timestamptz AT TIME ZONE 'Asia/Seoul')::date BETWEEN $1::date AND $2::date
      ORDER BY i.meta->>'decidedAt' LIMIT 20`, range);
  const goals = await query<{ title: string; progress: string; period_type: string }>(
    `SELECT title, progress, period_type FROM goal
      WHERE is_active AND period_start <= $2::date AND period_end >= $1::date
      ORDER BY CASE period_type WHEN 'year' THEN 0 WHEN 'quarter' THEN 1 ELSE 2 END, id LIMIT 12`, range);
  return {
    weekStart, weekEnd, done, created: Number(created?.n ?? 0), late, lateTotal: Number(lateTotal?.n ?? 0),
    meetings: meetings.map((m) => ({ id: m.id, title: m.title, decisions: Number(m.decisions), actions: Number(m.actions) })),
    decisions, goals: goals.map((g) => ({ title: g.title, progress: Math.round(Number(g.progress)), periodType: g.period_type })),
  };
}

const SECTIONS = ["한 주 요약", "끝낸 것", "정한 것", "밀리는 것", "다음 주에 볼 것"];

const SYSTEM = `당신은 「AI 로봇 플랫폼팀」의 주간 브리핑을 쓰는 보조입니다. 팀원 모두가 같은 글을 읽습니다.

절대 규칙:
- 주어진 사실(JSON)에 없는 일 · 수치 · 사람 · 원인을 만들지 않는다. 추측하지 않는다.
- 개수는 JSON 의 값을 그대로 쓴다. 새로 계산하거나 「절반」 「대부분」 같은 말로 바꾸지 않는다.
- 사람을 탓하거나 평가하지 않는다. 밀리는 일은 일의 이름과 기한만 말한다.
- 한국어, 짧은 문장. 마크다운 제목은 아래 다섯 개를 이 순서로 쓴다(## 로 시작):
  ${SECTIONS.join(" · ")}
- 「한 주 요약」은 3줄 이내. 다른 칸은 글머리표(-)로 많아야 6줄.
- 해당 사실이 없으면 그 칸에 「없음」 한 줄.
- 「다음 주에 볼 것」은 밀리는 것 · 정한 것에서 이어지는 것만. 새 할 일을 지어내지 않는다.`;

/** 키가 없을 때(데모) — 사실을 그대로 나열한다. 문장을 지어내지 않는다 */
function demoText(f: BriefFacts): string {
  const li = (xs: string[]) => (xs.length ? xs.map((x) => `- ${x}`).join("\n") : "- 없음");
  return [
    `## 한 주 요약`,
    `- (데모 — AI 키가 연결되지 않아 사실만 나열합니다) 끝낸 업무 ${f.done.length}건 · 새 업무 ${f.created}건 · 기한 지남 ${f.lateTotal}건 · 회의 ${f.meetings.length}번 · 확정한 결정 ${f.decisions.length}건`,
    `## 끝낸 것`, li(f.done.slice(0, 6).map((t) => `${t.title}${t.who ? ` (${t.who})` : ""}`)),
    `## 정한 것`, li(f.decisions.slice(0, 6).map((d) => `${d.body} — ${d.meeting}`)),
    `## 밀리는 것`, li(f.late.slice(0, 6).map((t) => `${t.title} · 기한 ${t.due}${t.who ? ` (${t.who})` : ""}`)),
    `## 다음 주에 볼 것`, li(f.late.slice(0, 3).map((t) => `${t.title} 기한 다시 잡기`)),
  ].join("\n");
}

export async function getBrief(weekStart: string): Promise<Brief | null> {
  const row = await queryOne<{ value: Brief }>(`SELECT value FROM config WHERE key = $1`, [keyOf(weekStart)]);
  return row?.value ?? null;
}

/** 브리핑을 만든다(또는 다시 만든다). AI 를 한 번 부른다 */
export async function makeBrief(weekStart: string, weekEnd: string, by: { id: number; name: string }): Promise<Brief> {
  const facts = await gatherFacts(weekStart, weekEnd);
  const demo = isDemoMode();
  const text = demo ? demoText(facts) : await completeText(SYSTEM,
    `기간: ${weekStart} ~ ${weekEnd} (서울)\n\n사실(JSON):\n${JSON.stringify(facts)}\n\n위 사실만으로 주간 브리핑을 쓰세요.`);
  const brief: Brief = {
    weekStart, weekEnd, text: text.slice(0, 8000), generatedAt: new Date().toISOString(), by: by.name, demo,
    facts: { done: facts.done.length, created: facts.created, lateTotal: facts.lateTotal,
             meetings: facts.meetings.length, decisions: facts.decisions.length },
  };
  await query(
    `INSERT INTO config (key, value, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [keyOf(weekStart), JSON.stringify(brief), by.id]);
  return brief;
}
