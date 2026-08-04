// 활동 인박스 (MD-P-2026-007) — 분류 · 채널 분리 · 생성 규칙. 서버 전용.
// 여기가 "무엇을 사람 알림으로 볼 것인가"의 단일 기준점이다. 화면은 이 분류를 그대로 쓴다.
import { query } from "./db";
import { kstToday } from "./home";
import { ACTIVITY_KINDS, type ActivityKind, type Channel } from "./activity-kinds";

export type { ActivityKind, Channel };

export interface ActivityItem {
  id: number;
  kind: ActivityKind;
  channel: Channel;
  type: string;
  refType: string;
  refId: number | null;
  snippet: string;
  read: boolean;
  bundleCount: number;
  actorName: string | null;
  createdAt: string;
}

/**
 * 저장된 알림 한 줄 → 분류.
 * 새 알림 타입을 만들지 않고 (type, ref_type) 조합으로 갈라낸다:
 *   approval + signal = 결정 확정 / approval + 그 외 = 승인 요청.
 */
export function classify(type: string, refType: string): { kind: ActivityKind; channel: Channel } {
  if (type === "mention") return { kind: "mention", channel: "human" };
  if (type === "assign") return { kind: "assign", channel: "human" };
  if (type === "reply") return { kind: "reply", channel: "human" };
  if (type === "share") return { kind: "share", channel: "human" };
  if (type === "approval") {
    return refType === "signal"
      ? { kind: "decision", channel: "human" }   // 결정 확정 통지
      : { kind: "approval", channel: "human" };  // 승인 대기 초안
  }
  // 마감·지연은 사람이 만든 사건이 아니다 → 시스템 채널 (배지 없음)
  if (type === "deadline" || type === "overdue") return { kind: "deadline", channel: "system" };
  // 적립 실패 같은 운영 알림 (MD-P-2026-011 §F) — 사람 알림을 밀어내지 않게 시스템 채널로
  if (type === "system") return { kind: "system", channel: "system" };
  return { kind: "share", channel: "human" };
}

// ───────────────────────── 음소거 (§F) ─────────────────────────

export interface MuteState {
  allUntil: string | null;  // 임시 전체 음소거 만료 시각. 없으면 비활성
  projects: number[];       // 알림을 끈 프로젝트 id
}

export async function getMuteState(userId: number): Promise<MuteState> {
  const rows = await query<{ scope: string; until: string | null }>(
    `SELECT scope, until::text FROM notification_mute
      WHERE user_id = $1 AND (until IS NULL OR until > now())`,
    [userId]
  );
  const projects: number[] = [];
  let allUntil: string | null = null;
  for (const r of rows) {
    if (r.scope === "all") allUntil = r.until;
    else if (r.scope.startsWith("project:")) {
      const id = Number(r.scope.slice(8));
      if (Number.isInteger(id)) projects.push(id);
    }
  }
  return { allUntil, projects };
}

/** 이 알림이 음소거된 프로젝트에 속하는가 — 생성 시점에 걸러 아예 만들지 않는다. */
async function mutedByProject(userId: number, refType: string, refId: number | null): Promise<boolean> {
  if (!refId) return false;
  const { projects } = await getMuteState(userId);
  if (projects.length === 0) return false;
  const sql = refType === "task" ? `SELECT project_id FROM task WHERE id = $1`
    : refType === "signal" ? `SELECT project_id FROM signal WHERE id = $1`
      : null;
  if (!sql) return false;
  const rows = await query<{ project_id: number | null }>(sql, [refId]);
  const pid = rows[0]?.project_id ?? null;
  return pid !== null && projects.includes(pid);
}

/** 알림이 가리키는 프로젝트 — hover 액션 "이 프로젝트 알림 끄기"에 쓴다. */
export async function projectOf(refType: string, refId: number | null): Promise<{ id: number; name: string } | null> {
  if (!refId) return null;
  const sql = refType === "task"
    ? `SELECT p.id, p.name FROM task t JOIN project p ON p.id = t.project_id WHERE t.id = $1`
    : refType === "signal"
      ? `SELECT p.id, p.name FROM signal s JOIN project p ON p.id = s.project_id WHERE s.id = $1`
      : null;
  if (!sql) return null;
  const rows = await query<{ id: number; name: string }>(sql, [refId]);
  return rows[0] ?? null;
}

// ───────────────────────── 생성 (§E) ─────────────────────────

export interface CreateInput {
  userId: number;
  type: string;
  refType: string;
  refId: number | null;
  snippet: string;
  actorId: number | null;
  /** 같은 사건을 두 번 만들지 않기 위한 키. 있으면 중복 시 무시된다. */
  dedupeKey?: string;
  /** 같은 대상의 안읽은 알림이 있으면 새 줄 대신 묶는다(답글 N개). */
  bundle?: boolean;
}

/**
 * 알림 1건 생성. 규칙 셋을 여기서 한 번에 적용한다 (§E):
 *   1. 본인이 유발한 이벤트는 본인에게 만들지 않는다.
 *   2. dedupeKey가 같은 알림은 두 번 만들지 않는다.
 *   3. bundle=true면 같은 대상의 안읽은 알림에 합쳐 "N개"로 센다.
 */
export async function createNotification(n: CreateInput): Promise<"created" | "bundled" | "skipped"> {
  if (n.actorId !== null && n.userId === n.actorId) return "skipped";
  if (await mutedByProject(n.userId, n.refType, n.refId)) return "skipped";

  if (n.bundle && n.refId !== null) {
    const bumped = await query<{ id: number }>(
      `UPDATE notification
          SET bundle_count = bundle_count + 1, created_at = now(), snippet = $5, archived = false
        WHERE user_id = $1 AND type = $2 AND ref_type = $3 AND ref_id = $4 AND read = false
        RETURNING id`,
      [n.userId, n.type, n.refType, n.refId, n.snippet.slice(0, 200)]
    );
    if (bumped.length > 0) return "bundled";
  }

  const inserted = await query<{ id: number }>(
    `INSERT INTO notification (user_id, type, ref_type, ref_id, snippet, actor_id, dedupe_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
     RETURNING id`,
    [n.userId, n.type, n.refType, n.refId, n.snippet.slice(0, 200), n.actorId, n.dedupeKey ?? null]
  );
  return inserted.length > 0 ? "created" : "skipped";
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

// 조회 폴링(사이드바 8초·활동 12초)마다 동기화를 돌리면 무의미한 쿼리가 쌓인다.
// 결과는 dedupe_key 덕분에 멱등하므로, 프로세스 안에서 5분에 한 번으로 줄인다.
// 인스턴스가 여러 개여도 최악이 "인스턴스마다 5분에 한 번"이라 안전하다.
const SYNC_TTL_MS = 5 * 60 * 1000;
const lastSync = new Map<number, number>();

/** 이번 요청에서 동기화를 돌려야 하는가. */
export function shouldSync(userId: number): boolean {
  const now = Date.now();
  const prev = lastSync.get(userId) ?? 0;
  if (now - prev < SYNC_TTL_MS) return false;
  lastSync.set(userId, now);
  return true;
}

/**
 * 마감 알림 동기화 (§E) — 업무당 D-2 · D-DAY · 지연 최초 1회만.
 * dedupe_key가 (업무, 시점)으로 고정돼 있어 하루에 몇 번을 조회해도 늘어나지 않는다.
 * 활동 조회 시 호출된다(별도 스케줄러 없이 동작하게).
 */
export async function syncDeadlineNotifications(userId: number): Promise<void> {
  const today = kstToday();
  const rows = await query<{ id: number; title: string; due_date: string }>(
    `SELECT id, title, due_date::text FROM task
      WHERE is_active = true AND status IN ('todo','doing','review')
        AND assignee_id = $1 AND due_date IS NOT NULL
        AND due_date <= (($2::date) + 2)
      ORDER BY due_date ASC LIMIT 40`,
    [userId, today]
  );
  for (const t of rows) {
    // D-1에는 새 알림을 만들지 않는다 — D-2 · D-DAY · 지연 최초 1회만.
    const milestone = t.due_date < today ? "overdue"
      : t.due_date === today ? "dday"
        : daysBetween(today, t.due_date) === 2 ? "d2"
          : null;
    if (!milestone) continue;
    const label = milestone === "overdue" ? "지연" : milestone === "dday" ? "오늘 마감" : "마감 D-2";
    await createNotification({
      userId,
      type: milestone === "overdue" ? "overdue" : "deadline",
      refType: "task",
      refId: t.id,
      snippet: `${label} · ${t.title}`,
      actorId: null,
      dedupeKey: `deadline:${t.id}:${milestone}`,
    });
  }
}

/**
 * 승인 대기 동기화 (§A 필터 레일 "승인 요청") — 내 앞으로 온 에이전트 초안.
 * 기존 approval 타입을 그대로 쓰고, 초안 1건당 알림 1건으로 고정한다.
 */
export async function syncApprovalNotifications(userId: number): Promise<void> {
  const drafts = await query<{ id: number; title: string; agent_name: string | null }>(
    `SELECT d.id, d.title, ag.display_name AS agent_name
       FROM drafts d LEFT JOIN actor ag ON ag.id = d.assistant_id
      WHERE d.status = 'pending' AND d.user_id = $1
      ORDER BY d.created_at DESC LIMIT 20`,
    [userId]
  );
  for (const d of drafts) {
    await createNotification({
      userId,
      type: "approval",
      refType: "draft",
      refId: d.id,
      snippet: `승인 대기 · ${d.title || "제목 없는 초안"}${d.agent_name ? ` (${d.agent_name})` : ""}`,
      actorId: null,
      dedupeKey: `approval:draft:${d.id}`,
    });
  }
}

// ───────────────────────── 조회 ─────────────────────────

export interface ListFilter {
  kind?: ActivityKind | "all";
  channel?: Channel | "all";
  unreadOnly?: boolean;
  /** 저장된 뷰 "오늘 처리할 것" — 승인 요청 + 마감 + 안읽음 멘션 */
  todo?: boolean;
}

/** 보관되지 않은 내 알림 전부(분류 포함). 필터는 이 위에서 적용한다. */
export async function listActivity(userId: number): Promise<ActivityItem[]> {
  const rows = await query<{
    id: number; type: string; ref_type: string; ref_id: number | null; snippet: string;
    read: boolean; bundle_count: number; actor_name: string | null; created_at: string;
  }>(
    `SELECT n.id, n.type, n.ref_type, n.ref_id, n.snippet, n.read, n.bundle_count,
            a.display_name AS actor_name, n.created_at::text
       FROM notification n
       LEFT JOIN actor a ON a.id = n.actor_id
      WHERE n.user_id = $1 AND n.archived = false
      ORDER BY n.created_at DESC
      LIMIT 200`,
    [userId]
  );
  return rows.map((r) => {
    const c = classify(r.type, r.ref_type);
    return {
      id: r.id, kind: c.kind, channel: c.channel, type: r.type,
      refType: r.ref_type, refId: r.ref_id, snippet: r.snippet,
      read: r.read, bundleCount: r.bundle_count,
      actorName: r.actor_name, createdAt: r.created_at,
    };
  });
}

export function applyFilter(items: ActivityItem[], f: ListFilter): ActivityItem[] {
  if (f.todo) {
    // 오늘 처리할 것 = 승인 요청 + 마감(생성 규칙상 D-2 이내만 존재) + 안읽음 멘션
    return items.filter((i) =>
      i.kind === "approval" || i.kind === "deadline" || (i.kind === "mention" && !i.read));
  }
  let out = items;
  if (f.channel && f.channel !== "all") out = out.filter((i) => i.channel === f.channel);
  if (f.kind && f.kind !== "all") out = out.filter((i) => i.kind === f.kind);
  if (f.unreadOnly) out = out.filter((i) => !i.read);
  return out;
}

/** 필터 레일에 붙는 안읽음 수 — 채널별 · 종류별. */
export function countsFor(items: ActivityItem[]): { human: number; system: number; byKind: Record<string, number> } {
  const byKind: Record<string, number> = {};
  for (const k of ACTIVITY_KINDS) byKind[k] = 0;
  let human = 0, system = 0;
  for (const i of items) {
    if (i.read) continue;
    byKind[i.kind] = (byKind[i.kind] ?? 0) + 1;
    if (i.channel === "human") human += 1; else system += 1;
  }
  return { human, system, byKind };
}
