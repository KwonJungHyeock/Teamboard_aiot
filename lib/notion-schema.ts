// Notion "팀 업무 타임라인" DB 스키마 — 코드가 보내는 속성·타입·허용값의 폴백 소스 (Phase 9).
// 실제 선택지는 Notion에서 동적 조회해 config(notion_schema_cache)에 캐시하고,
// 조회·캐시 모두 실패할 때 이 상수로 폴백한다 (Notion 장애 시에도 승인이 동작해야 함).
// 실제 DB 스키마와 일치 (2026-07 캡처 확인): "구분" 속성 없음, "업무 구분"은 단일 select, "상태"는 status 타입.

/** Notion 속성 하나의 정의 — 속성 이름, 타입, 허용값(선택형만) */
export interface NotionPropertySpec {
  /** Notion DB의 실제 속성 이름 (한글) */
  property: string;
  /** Notion 속성 타입. "unknown" = 토큰 확인 전까지 select/multi_select 미확정 */
  type: "select" | "multi_select" | "status" | "people" | "date" | "title" | "rich_text" | "unknown";
  /** select/multi_select/status의 허용 선택지 (없으면 자유값) */
  options?: readonly string[];
  /** 코드가 이 속성을 채우는 방식 설명 */
  note?: string;
}

// ── 선택지 폴백값 (실제 Notion DB 순서에 맞춤) ──
export const NOTION_WORK_AREAS = ["기타", "R&D", "플랫폼", "연구소", "디자인", "교육자료", "현장실습교육"] as const;
export const NOTION_WORK_TYPES = ["팀업무", "개인업무", "상시업무"] as const;
export const NOTION_STATUSES = ["대기", "진행", "완료"] as const; // status 타입 — API로 옵션 추가/삭제 불가, 이름만 지정
export const NOTION_PRIORITIES = ["High", "Mid", "Low"] as const;

/**
 * 승인 시 createTimelinePage가 채우는 속성 스키마 (property 이름·타입·허용값) — 폴백.
 * 주의: "업무 구분"은 스크린샷으로 select/multi_select를 확정할 수 없어 type:"unknown"으로 둔다.
 * 실제 타입은 토큰 등록 후 Notion 동적 조회로 확정되며, 페이로드는 확정된 타입으로 분기한다.
 */
export const NOTION_TIMELINE_SCHEMA = {
  title: { property: "업무명", type: "title", note: "초안 제목 (업무 구분 접두어 자동 삽입)" },
  workArea: { property: "업무 구분", type: "unknown", options: NOTION_WORK_AREAS, note: "select/multi_select 미확정 — Notion 조회로 확정" },
  status: { property: "상태", type: "status", options: NOTION_STATUSES },
  priority: { property: "우선순위", type: "select", options: NOTION_PRIORITIES },
  workType: { property: "업무유형", type: "select", options: NOTION_WORK_TYPES },
  assignee: { property: "담당자", type: "people", note: "account.notion_user_id 매핑" },
  startDate: { property: "시작일", type: "date", note: "업무 시작일" },
  endDate: { property: "종료일", type: "date", note: "업무 종료일 (시작일과 별개 속성)" },
  memo: { property: "메모", type: "rich_text", note: "초안 한 줄 요약 (목록 뷰용)" },
} satisfies Record<string, NotionPropertySpec>;

/** 속성 이름 단축 접근 (createTimelinePage에서 사용) */
export const NP = {
  title: NOTION_TIMELINE_SCHEMA.title.property,
  workArea: NOTION_TIMELINE_SCHEMA.workArea.property,
  status: NOTION_TIMELINE_SCHEMA.status.property,
  priority: NOTION_TIMELINE_SCHEMA.priority.property,
  workType: NOTION_TIMELINE_SCHEMA.workType.property,
  assignee: NOTION_TIMELINE_SCHEMA.assignee.property,
  startDate: NOTION_TIMELINE_SCHEMA.startDate.property,
  endDate: NOTION_TIMELINE_SCHEMA.endDate.property,
  memo: NOTION_TIMELINE_SCHEMA.memo.property,
} as const;

/** 대조 대상 — 선택형(옵션이 있는) 속성만 추출 */
export const NOTION_SELECT_PROPERTIES = (Object.values(NOTION_TIMELINE_SCHEMA) as NotionPropertySpec[]).filter(
  (s): s is NotionPropertySpec & { options: readonly string[] } => !!s.options && s.options.length > 0
);

/**
 * 업무명 접두어 규칙 — 업무 구분 값을 대괄호로 감싸 제목 앞에 삽입.
 * 이미 대괄호 접두어가 있으면 중복 삽입하지 않는다. (팀 관례: "[플랫폼] 제목")
 */
export function applyAreaPrefix(title: string, workArea: string | null | undefined): string {
  const t = title.trim();
  if (/^\[.+?\]/.test(t)) return t; // 이미 [xxx] 접두어 있음
  if (!workArea) return t;
  return `[${workArea}] ${t}`;
}

export class UnknownPropertyTypeError extends Error {
  constructor(public property: string) {
    super(
      `Notion 속성 "${property}"의 타입이 확정되지 않았습니다. 설정에서 "Notion 스키마 새로고침"을 실행하세요.`
    );
  }
}

/**
 * 타입 기반 Notion 속성값 생성 — 단일 소스. 어떤 타입이든 코드 수정 없이 페이로드를 만든다.
 *   select → {select:{name}} / multi_select → {multi_select:[{name}]} / status → {status:{name}}
 *   people → {people:[{id}]} / date → {date:{start}} / title·rich_text → 텍스트
 * value는 배열 또는 단일값을 받아 타입에 맞게 정규화한다.
 * type이 "unknown"이면 확정 전이므로 예외를 던진다(승인 라우트에서 안내로 변환).
 */
export function buildPropertyValue(
  property: string,
  type: string,
  value: string | string[] | null | undefined
): any {
  const arr = (Array.isArray(value) ? value : value == null ? [] : [value]).filter(
    (v) => v !== "" && v != null
  ) as string[];
  const first = arr[0] ?? "";
  switch (type) {
    case "select":
      return first ? { select: { name: first } } : { select: null };
    case "multi_select":
      return { multi_select: arr.map((name) => ({ name })) };
    case "status":
      return first ? { status: { name: first } } : undefined;
    case "people":
      return { people: arr.map((id) => ({ id })) };
    case "date":
      return first ? { date: { start: first } } : undefined;
    case "title":
      return { title: [{ type: "text", text: { content: first.slice(0, 200) } }] };
    case "rich_text":
      return { rich_text: [{ type: "text", text: { content: first.slice(0, 2000) } }] };
    case "unknown":
      throw new UnknownPropertyTypeError(property);
    default:
      throw new Error(`알 수 없는 Notion 속성 타입: ${type} (${property})`);
  }
}
