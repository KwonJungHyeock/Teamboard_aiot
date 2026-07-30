// 협업 알림 — 서버 전용 헬퍼. @멘션 파싱 + 알림 생성.
import { query } from "@/lib/db";

export type NotifType = "mention" | "assign" | "reply" | "approval" | "share";

export interface NotifyInput {
  userId: number;      // 받는 사람
  type: NotifType;
  refType: string;     // signal | task | activity
  refId: number | null;
  snippet: string;
  actorId: number;     // 유발한 사람
}

/** 알림 1건 생성. 자기 자신에게는 만들지 않는다. */
export async function notify(n: NotifyInput): Promise<void> {
  if (n.userId === n.actorId) return;
  await query(
    `INSERT INTO notification (user_id, type, ref_type, ref_id, snippet, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [n.userId, n.type, n.refType, n.refId, n.snippet.slice(0, 200), n.actorId]
  );
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 본문의 `@이름` → 멘션된 활성 사람 actor. 작성자는 제외.
 *  이름에 공백이 있어도(예: "ROBODYNE 관리자") display_name 전체로 매칭한다. */
export async function resolveMentions(
  body: string,
  authorId: number
): Promise<{ id: number; name: string }[]> {
  if (!body || !body.includes("@")) return [];
  const actors = await query<{ id: number; display_name: string }>(
    `SELECT id, display_name FROM actor WHERE type = 'human' AND is_active = true`
  );
  const hits: { id: number; name: string }[] = [];
  for (const a of actors) {
    if (a.id === authorId) continue;
    // @이름 뒤에 한글/영숫자가 곧바로 이어지면 다른 이름의 접두사이므로 제외
    const re = new RegExp(`@${escapeRegExp(a.display_name)}(?![0-9A-Za-z가-힣])`);
    if (re.test(body)) hits.push({ id: a.id, name: a.display_name });
  }
  return hits;
}

/** 멘션 대상 전원에게 알림 생성(작성자 제외는 resolveMentions에서 처리). */
export async function notifyMentions(
  body: string,
  authorId: number,
  refType: string,
  refId: number | null,
  snippet: string
): Promise<number[]> {
  const mentioned = await resolveMentions(body, authorId);
  for (const m of mentioned) {
    await notify({ userId: m.id, type: "mention", refType, refId, snippet, actorId: authorId });
  }
  return mentioned.map((m) => m.id);
}
