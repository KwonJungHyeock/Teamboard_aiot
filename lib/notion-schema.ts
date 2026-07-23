// Notion "팀 업무 타임라인" DB 스키마 — 코드가 보내는 속성·타입·허용값의 단일 소스 (Phase 9).
// 승인 게이트가 Notion 페이지를 만들 때 쓰는 값이 흩어지지 않도록 여기 한곳에 모은다.
// 운영 첫날 승인 실패를 막기 위해, 실제 Notion DB 선택지와 이 목록을 대조해야 한다
// (임시 라우트 /api/admin/verify-notion-schema).

/** Notion 속성 하나의 정의 — 속성 이름, 타입, 허용값(선택형만) */
export interface NotionPropertySpec {
  /** Notion DB의 실제 속성 이름 (한글) */
  property: string;
  /** Notion 속성 타입 */
  type: "select" | "multi_select" | "status" | "people" | "date" | "title" | "rich_text";
  /** select/multi_select/status의 허용 선택지 (없으면 자유값) */
  options?: readonly string[];
  /** 코드가 이 속성을 채우는 방식 설명 */
  note?: string;
}

// ── 선택지 허용값 (단일 소스) ──
export const NOTION_CATEGORIES = ["팀 메인", "개인 상시"] as const;
export const NOTION_WORK_TYPES = ["팀업무", "개인업무", "상시업무"] as const;
export const NOTION_AREAS = ["R&D", "플랫폼", "연구소", "디자인", "교육자료", "현장실습교육", "기타"] as const;
export const NOTION_STATUSES = ["대기", "진행", "완료"] as const;
export const NOTION_PRIORITIES = ["High", "Mid", "Low"] as const;

/** 승인 시 createTimelinePage가 채우는 속성 스키마 (property 이름·타입·허용값) — 실제 코드와 일치 */
export const NOTION_TIMELINE_SCHEMA = {
  title: { property: "업무명", type: "title", note: "초안 제목" },
  category: { property: "구분", type: "select", options: NOTION_CATEGORIES },
  workType: { property: "업무유형", type: "select", options: NOTION_WORK_TYPES },
  areas: { property: "업무 구분", type: "multi_select", options: NOTION_AREAS },
  status: { property: "상태", type: "status", options: NOTION_STATUSES },
  priority: { property: "우선순위", type: "select", options: NOTION_PRIORITIES },
  assignee: { property: "담당자", type: "people", note: "account.notion_user_id 매핑" },
  startDate: { property: "시작일", type: "date", note: "업무 시작일" },
  endDate: { property: "종료일", type: "date", note: "업무 종료일" },
  memo: { property: "메모", type: "rich_text", note: "승인 기록 메모" },
} satisfies Record<string, NotionPropertySpec>;

/** 속성 이름 단축 접근 (createTimelinePage에서 사용) */
export const NP = {
  title: NOTION_TIMELINE_SCHEMA.title.property,
  category: NOTION_TIMELINE_SCHEMA.category.property,
  workType: NOTION_TIMELINE_SCHEMA.workType.property,
  areas: NOTION_TIMELINE_SCHEMA.areas.property,
  status: NOTION_TIMELINE_SCHEMA.status.property,
  priority: NOTION_TIMELINE_SCHEMA.priority.property,
  assignee: NOTION_TIMELINE_SCHEMA.assignee.property,
  startDate: NOTION_TIMELINE_SCHEMA.startDate.property,
  endDate: NOTION_TIMELINE_SCHEMA.endDate.property,
  memo: NOTION_TIMELINE_SCHEMA.memo.property,
} as const;

/** 대조 대상 — 선택형(옵션이 있는) 속성만 추출 */
export const NOTION_SELECT_PROPERTIES = (Object.values(NOTION_TIMELINE_SCHEMA) as NotionPropertySpec[]).filter(
  (s): s is NotionPropertySpec & { options: readonly string[] } => !!s.options && s.options.length > 0
);
