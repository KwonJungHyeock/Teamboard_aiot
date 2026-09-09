// 도메인 타입 — docs/SPEC.md 5장 스키마 기준

export type Role = "admin" | "lead" | "member" | "viewer";

/**
 * 등급은 **포함 관계**다 (MD-P-2026-035 §B).
 *
 * `role === "lead"` 를 그대로 두면 관리자로 올린 순간 그 사람이 **팀장 권한을
 * 잃는다** — 목표 보관 · 프로젝트 생성 · 리뷰가 막힌다. 등급을 올렸는데 할 수
 * 있는 일이 줄어드는 것은 아무도 기대하지 않는다.
 *
 * 그래서 판정 함수를 둔다. **직접 비교를 남기지 않는다** — 남으면 그 자리만
 * 조용히 다르게 동작하고, 그 사실을 아무도 모른다.
 *
 *   isAdmin  관리자만          — 멤버 관리 · 역할 변경 · 계정 발급
 *   hasLead  관리자 또는 팀장  — 그 밖의 「팀장만」 자리 전부
 */
/**
 * 화면·API 가 발급·변경할 수 있는 역할 목록 — **`account_role_check`(0033) 와 같아야 한다.**
 *
 * 두 라우트가 각자 배열을 들고 있었고 한쪽에만 `admin` 을 넣으면 화면에서 고른
 * 값이 DB 에서 거부된다. 그 이유는 화면에 안 보인다. 한 곳에서 낸다.
 */
export const ROLES = ["admin", "lead", "member", "viewer"] as const;

/**
 * 관리자 판정의 재료 (MD-P-2026-039).
 *
 * `role` 은 **정체**고 `adminGrant` 는 **권한**이다. 팀장이 당분간 관리자 일을
 * 할 때 role 을 admin 으로 바꾸면 화면에 관리자로 보인다 — 정체가 틀려진다.
 * 포함 관계는 권한에만 있고 정체에는 없다(§G). 그래서 둘을 따로 든다.
 *
 * 두 칸 다 **필수**다. 선택으로 두면 `adminGrant` 를 안 넘긴 자리가 조용히
 * 「권한 없음」이 되고, 그 자리만 다르게 판정하는데 아무도 모른다.
 * 필수로 두면 컴파일러가 빠진 곳을 전부 짚어 준다(§G).
 */
export interface AdminSubject {
  role: Role | string | null | undefined;
  adminGrant: boolean | null | undefined;
}

/**
 * **관리자 판정 — 여기 한 곳뿐이다.**
 *
 * 부르는 자리는 그대로다(구성원 화면 · 역할 변경 · 계정 발급 · 에이전트 흔적).
 * 판정만 넓어졌다. 「관리자가 몇 명인가」를 세는 SQL 도 **이 식과 같아야 한다** —
 * 판정과 집계가 다른 기준을 쓰면 그 차이만큼 조용히 틀린다(035 에서 겪은 그대로).
 * 그 SQL 은 `adminCountSql()` 하나로 낸다.
 */
export const isAdmin = (subject: AdminSubject): boolean =>
  subject.role === "admin" || subject.adminGrant === true;

/**
 * 「관리자 권한」 배지를 그리는가 — **정체가 아니라 권한을 가리키는 자리다.**
 *
 * role='admin' 인 사람에게는 안 그린다. 이미 이름표가 「관리자」라서
 * 「관리자」+「관리자 권한」이 나란히 뜨면 두 개가 다른 뜻인 줄로 읽힌다.
 * 배지 조건이 화면마다 달라지지 않도록 여기서 한 번만 정한다.
 */
export const showsAdminGrantBadge = (subject: AdminSubject): boolean =>
  subject.adminGrant === true && subject.role !== "admin";

/**
 * `isAdmin` 과 **같은 기준**을 SQL 로 쓴 것. 「관리자가 몇 명인가」는 이걸로만 센다.
 *
 * 판정은 TypeScript 에 있고 집계는 SQL 에 있어서 둘이 저절로 같아지지는 않는다.
 * 그래서 **바로 옆에 둔다** — 한쪽을 고치면서 다른 쪽을 못 보고 지나가는 일을
 * 줄이는 것이 목적이다. 035 에서 `activeLeadCount` 가 admin 을 안 세서
 * 판정은 통과하는데 집계는 「1명뿐」이라 막던 일이 있었다.
 */
export const adminWhereSql = (accountAlias: string): string =>
  `(${accountAlias}.role = 'admin' OR ${accountAlias}.admin_grant = true)`;

/**
 * 팀장 권한 — **039 에서 건드리지 않았다.**
 * 관리자 권한이 팀장 권한을 포함하는지는 별개 문제다. 지금 관리자 권한을 받는
 * 팀장은 이미 `role='lead'` 라 그대로 다 되고, 대표는 `role='admin'` 이라
 * 아래 `admin` 가지에 걸린다(035 에서 그렇게 만들어 뒀다).
 */
export const hasLead = (role: Role | string | null | undefined): boolean =>
  role === "admin" || role === "lead";

/**
 * 역할의 **이름**. 권한 판정과 다른 물건이다.
 *
 * `hasLead` 는 「이 사람이 팀장 자리를 쓸 수 있는가」를 답한다. 그걸 이름표에
 * 쓰면 관리자가 화면에서 **팀장으로 보인다** — 등급을 올려 놓고 올린 사실이
 * 어디에도 안 보인다. 포함 관계는 **권한**에만 있고 **정체**에는 없다.
 *
 * `Record<Role, string>` 이라 역할이 하나 늘면 여기가 컴파일에 걸린다 —
 * 이름 없는 역할이 화면에 raw 문자열로 새는 길을 막는다.
 */
export const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  lead: "팀장",
  member: "팀원",
  viewer: "뷰어",
};
export const roleLabel = (role: Role | string | null | undefined): string =>
  ROLE_LABEL[role as Role] ?? String(role ?? "—");
export type ActorType = "human" | "agent";
export type TaskType = "자료조사" | "회의록" | "내용정리" | "반복업무";
export type DraftTaskType = TaskType | "monthly_report";
export type DraftStatus = "working" | "pending" | "approved" | "rejected" | "failed";
export type TaskStatus = "proposed" | "todo" | "doing" | "review" | "done" | "dropped";
export type TaskPriority = "high" | "mid" | "low";
export type GoalPeriodType = "year" | "quarter" | "month";
export type SignalType = "decision" | "review" | "memo" | "risk";
export type SignalScope = "private" | "huddle" | "team";
export type SignalStatus = "open" | "discussing" | "resolved" | "archived";
export type ArtifactKind = "notion" | "github" | "figma" | "file" | "link";

export interface SessionUser {
  id: number; // actor.id (type='human')
  email: string;
  name: string;
  role: Role;
  /**
   * 관리자 권한 (039). **필수**다 — 빠뜨린 자리를 컴파일러가 짚게 한다.
   *
   * 옛 쿠키에는 이 칸이 없다. 그런 토큰은 `false` 로 읽는다 — 없는 값을
   * 권한 있음으로 읽는 쪽이 훨씬 나쁘다.
   */
  adminGrant: boolean;
}

export interface Actor {
  id: number;
  type: ActorType;
  display_name: string;
  owner_actor_id: number | null;
  avatar_url: string | null;
  is_active: boolean;
}

// 에이전트 설정 — actor(type='agent') + agent_config 조인 결과.
// 기존 API 응답 형태 유지: id = agent actor id, user_id = owner(human) actor id
export interface AssistantSettings {
  id: number;
  user_id: number;
  name: string;
  report_style: "brief" | "detailed";
  work_areas: string[];
  auto_scope: string;
  system_prompt_extra: string;
}

export interface Project {
  id: number;
  name: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  color_key: string | null;
  notion_url: string | null;
  is_active: boolean;
  area_id: number;
  /** 사이드바 트리 — 미해결 논의 수 (MD-P-2026-005 §D) */
  open_discussions?: number;
}

export interface Area {
  id: number;
  name: string;
  color_key: string | null;
  sort_order: number;
  is_active: boolean;
  kind: "workspace" | "link_only";
  notion_url: string | null;
}

export interface AreaWithProjects extends Area {
  projects: Project[];
}

export type WorkType = "team" | "personal" | "routine";

export interface Goal {
  id: number;
  parent_id: number | null;
  period_type: GoalPeriodType;
  period_start: string;
  period_end: string;
  title: string;
  description: string;
  target_metric: string | null;
  target_value: number | null;
  current_value: number | null;
  progress_mode: "auto" | "manual";
  progress: number;
  owner_actor_id: number | null;
  project_id: number | null;
  is_active: boolean;
}

export interface Task {
  id: number;
  project_id: number | null;
  title: string;
  description: string;
  status: TaskStatus;
  assignee_id: number | null;
  start_date: string | null;
  due_date: string | null;
  priority: TaskPriority;
  origin: "human" | "agent";
  created_by: number | null;
  completed_at: string | null;
  is_active: boolean;
  created_at: string;
}

export interface TeamEvent {
  id: number;
  project_id: number | null;
  title: string;
  start_at: string;
  end_at: string;
  is_team: boolean;
  created_by: number | null;
  is_active: boolean;
}

export interface Artifact {
  id: number;
  project_id: number | null;
  kind: ArtifactKind;
  title: string;
  url: string;
  external_updated_at: string | null;
  is_active: boolean;
}

export interface Signal {
  id: number;
  type: SignalType;
  scope: SignalScope;
  title: string;
  body: string;
  author_id: number;
  project_id: number | null;
  task_id: number | null;
  status: SignalStatus;
  resolved_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SignalComment {
  id: number;
  signal_id: number;
  author_id: number;
  body: string;
  created_at: string;
}

export interface Report {
  id: number;
  period_year: number;
  period_month: number;
  draft_id: number | null;
  content: unknown;
  status: "draft" | "approved";
  approved_by: number | null;
  notion_page_id: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface Draft {
  id: number;
  assistant_id: number;
  user_id: number;
  task_type: DraftTaskType;
  instruction: string;
  title: string;
  body: string;
  status: DraftStatus;
  feedback: string | null;
  rework_of: number | null;
  approver_id: number | null;
  notion_page_id: string | null;
  created_at: string;
  decided_at: string | null;
}

// Notion 타임라인 항목 (보조 뷰 — SPEC 1.2 단방향 미러의 읽기 표현)
export interface TimelineItem {
  pageId: string;
  title: string;
  workArea: string | null; // 업무 구분 (단일 select)
  workType: string | null;
  status: string | null;
  priority: string | null;
  assignees: { id: string; name: string }[];
  startDate: string | null;
  endDate: string | null;
  memo: string | null;
  url: string | null;
}

export interface ActivityEntry {
  id: number;
  user_id: number | null;
  user_name?: string | null;
  assistant_id: number | null;
  message: string;
  level: "info" | "success" | "warn" | "error";
  created_at: string;
  /** 귀속 업무. `SELECT a.*` 로 늘 실려 왔는데 타입에만 없었다 — 묶기가 이 값을 쓴다. */
  task_id?: number | null;
}

export const TASK_TYPES: TaskType[] = ["자료조사", "회의록", "내용정리", "반복업무"];

// Notion 속성 허용값 — 폴백 소스는 lib/notion-schema.ts. 기존 import 호환을 위해 재수출.
export {
  NOTION_WORK_TYPES,
  NOTION_WORK_AREAS,
  NOTION_STATUSES,
  NOTION_PRIORITIES,
} from "./notion-schema";
