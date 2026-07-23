// 도메인 타입 — docs/SPEC.md 5장 스키마 기준

export type Role = "lead" | "member" | "viewer";
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
}

export interface Actor {
  id: number;
  type: ActorType;
  display_name: string;
  owner_actor_id: number | null;
  avatar_url: string | null;
  is_active: boolean;
}

// 부사수 설정 — actor(type='agent') + agent_config 조인 결과.
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
}

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
  category: string | null;
  workType: string | null;
  areas: string[];
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
}

export const TASK_TYPES: TaskType[] = ["자료조사", "회의록", "내용정리", "반복업무"];

// Notion 속성 허용값 (승인 게이트 → Notion 기록 시 이 값만 사용)
export const NOTION_CATEGORIES = ["팀 메인", "개인 상시"] as const;
export const NOTION_WORK_TYPES = ["팀업무", "개인업무", "상시업무"] as const;
export const NOTION_AREAS = ["R&D", "플랫폼", "연구소", "디자인", "교육자료", "현장실습교육", "기타"] as const;
export const NOTION_STATUSES = ["대기", "진행", "완료"] as const;
export const NOTION_PRIORITIES = ["High", "Mid", "Low"] as const;
