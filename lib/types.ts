export type Role = "lead" | "member";
export type TaskType = "자료조사" | "회의록" | "내용정리" | "반복업무";
export type DraftStatus = "working" | "pending" | "approved" | "rejected" | "failed";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface AssistantSettings {
  id: number;
  user_id: number;
  name: string;
  report_style: "brief" | "detailed";
  work_areas: string[];
  auto_scope: string;
  system_prompt_extra: string;
}

export interface Draft {
  id: number;
  assistant_id: number;
  user_id: number;
  task_type: TaskType;
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

export interface TimelineItem {
  pageId: string;
  title: string;
  category: string | null; // 구분
  workType: string | null; // 업무유형
  areas: string[]; // 업무 구분
  status: string | null; // 대기/진행/완료
  priority: string | null; // High/Mid/Low
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

// Notion 속성 허용값 (PRD 9장 — create/update 시 이 값만 사용)
export const NOTION_CATEGORIES = ["팀 메인", "개인 상시"] as const;
export const NOTION_WORK_TYPES = ["팀업무", "개인업무", "상시업무"] as const;
export const NOTION_AREAS = ["R&D", "플랫폼", "연구소", "디자인", "교육자료", "현장실습교육", "기타"] as const;
export const NOTION_STATUSES = ["대기", "진행", "완료"] as const;
export const NOTION_PRIORITIES = ["High", "Mid", "Low"] as const;
