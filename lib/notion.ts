// Notion 연동 (PRD 9장) — 서버(API Routes)에서만 호출. 토큰은 서버 환경변수에만.
// 삭제 금지 원칙: 페이지 삭제 API는 사용하지 않는다 (PRD 11장).
import { queryOne } from "./db";
import type { TimelineItem } from "./types";
import { applyAreaPrefix, buildPropertyValue, NOTION_TIMELINE_SCHEMA } from "./notion-schema";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03"; // data_source 지원 버전

function token(): string {
  const t = process.env.NOTION_TOKEN;
  if (!t) throw new Error("NOTION_TOKEN 환경변수가 설정되지 않았습니다.");
  return t;
}

export async function getTimelineDataSourceId(): Promise<string> {
  const row = await queryOne<{ value: { dataSourceId?: string } }>(
    "SELECT value FROM config WHERE key = 'notion_scope'"
  );
  const fromDb = row?.value?.dataSourceId;
  const fromEnv = process.env.NOTION_TIMELINE_DS_ID;
  const id = fromDb || fromEnv;
  if (!id) throw new Error("Notion 타임라인 data source id가 설정되지 않았습니다.");
  return id;
}

async function notionFetch(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Notion API 오류 (${res.status}): ${detail.slice(0, 500)}`);
  }
  return res.json();
}

/**
 * data source의 속성 스키마 조회 (Phase 9 검증용) — 선택형 속성의 실제 선택지를 반환.
 * 반환: { [속성이름]: { type, options[] } }. 코드 허용값과 대조하는 데 쓴다.
 */
export async function getDataSourceSchema(): Promise<
  Record<string, { type: string; options: string[] }>
> {
  const dsId = await getTimelineDataSourceId();
  const data = await notionFetch(`/data_sources/${dsId}`);
  const props = data.properties ?? {};
  const out: Record<string, { type: string; options: string[] }> = {};
  for (const [name, spec] of Object.entries<any>(props)) {
    const type = spec?.type ?? "";
    let options: string[] = [];
    if (type === "select") options = (spec.select?.options ?? []).map((o: any) => o.name);
    else if (type === "multi_select") options = (spec.multi_select?.options ?? []).map((o: any) => o.name);
    else if (type === "status") options = (spec.status?.options ?? []).map((o: any) => o.name);
    out[name] = { type, options };
  }
  return out;
}

/** 워크스페이스 사용자 목록 (Phase 9 검증용) — init-db의 notion_user_id 매핑 대조에 사용 */
export async function getWorkspaceUsers(): Promise<{ id: string; name: string; type: string }[]> {
  const data = await notionFetch(`/users`);
  return (data.results ?? [])
    .filter((u: any) => u.type === "person")
    .map((u: any) => ({ id: u.id, name: u.name ?? "", type: u.type }));
}

function plainText(richText: any[] | undefined): string {
  return (richText ?? []).map((t: any) => t?.plain_text ?? "").join("");
}

function pageToTimelineItem(page: any): TimelineItem {
  const props = page.properties ?? {};
  return {
    pageId: page.id,
    title: plainText(props["업무명"]?.title) || "(제목 없음)",
    // 업무 구분은 select/multi_select 어느 쪽이든 읽는다 (타입 미확정 대비)
    workArea:
      props["업무 구분"]?.select?.name ??
      props["업무 구분"]?.multi_select?.[0]?.name ??
      null,
    workType: props["업무유형"]?.select?.name ?? null,
    status: props["상태"]?.status?.name ?? null,
    priority: props["우선순위"]?.select?.name ?? null,
    assignees: (props["담당자"]?.people ?? []).map((p: any) => ({
      id: p.id,
      name: p.name ?? "",
    })),
    startDate: props["시작일"]?.date?.start ?? null,
    endDate: props["종료일"]?.date?.start ?? null,
    memo: plainText(props["메모"]?.rich_text) || null,
    url: page.url ?? null,
  };
}

export async function queryTimeline(): Promise<TimelineItem[]> {
  const dsId = await getTimelineDataSourceId();
  const items: TimelineItem[] = [];
  let cursor: string | undefined;
  do {
    const body: any = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const data = await notionFetch(`/data_sources/${dsId}/query`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    for (const page of data.results ?? []) items.push(pageToTimelineItem(page));
    cursor = data.has_more ? data.next_cursor : undefined;
  } while (cursor);
  return items;
}

export interface CreateTimelinePageParams {
  title: string;
  workAreas: string[]; // 업무 구분 — 배열로 유지(실제가 select면 첫 원소, multi_select면 전체 사용)
  workType: string; // 업무유형: 팀업무 | 개인업무 | 상시업무
  status: string; // 상태(status 타입): 대기 | 진행 | 완료
  priority: string; // High | Mid | Low
  assigneeNotionId: string | null;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  memo: string;
  bodyMarkdown: string;
}

// 마크다운 초안을 Notion 블록(단순 문단/헤딩/불릿)으로 변환
function markdownToBlocks(markdown: string): any[] {
  const blocks: any[] = [];
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    const text = (content: string) => [{ type: "text", text: { content: content.slice(0, 2000) } }];
    if (line.startsWith("### ")) {
      blocks.push({ type: "heading_3", heading_3: { rich_text: text(line.slice(4)) } });
    } else if (line.startsWith("## ")) {
      blocks.push({ type: "heading_2", heading_2: { rich_text: text(line.slice(3)) } });
    } else if (line.startsWith("# ")) {
      blocks.push({ type: "heading_1", heading_1: { rich_text: text(line.slice(2)) } });
    } else if (/^[-*]\s+/.test(line.trim())) {
      blocks.push({
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: text(line.trim().replace(/^[-*]\s+/, "")) },
      });
    } else {
      blocks.push({ type: "paragraph", paragraph: { rich_text: text(line) } });
    }
    if (blocks.length >= 90) break; // Notion 요청당 블록 수 제한 보호
  }
  return blocks;
}

export async function createTimelinePage(
  params: CreateTimelinePageParams
): Promise<{ pageId: string; url: string | null }> {
  const dsId = await getTimelineDataSourceId();

  // 실제 스키마(타입+선택지)를 캐시/Notion에서 해석 — 동적 import로 순환 참조 회피.
  // "업무 구분"이 select인지 multi_select인지는 여기서 확정된 타입으로 분기한다.
  const { getResolvedSchema } = await import("./notion-schema-cache");
  const { schema } = await getResolvedSchema();
  const typeOf = (spec: { property: string; type: string }) =>
    schema[spec.property]?.type ?? spec.type;

  const prefixArea = params.workAreas[0]; // 접두어는 대표(첫) 업무 구분 값
  const finalTitle = applyAreaPrefix(params.title, prefixArea).slice(0, 200);

  // 모든 속성을 타입 기반 buildPropertyValue로 생성 (타입이 바뀌어도 코드 수정 불필요).
  // "구분" 속성은 실제 DB에 없어 전송하지 않는다.
  const S = NOTION_TIMELINE_SCHEMA;
  const properties: any = {};
  const put = (spec: { property: string; type: string }, value: string | string[]) => {
    const built = buildPropertyValue(spec.property, typeOf(spec), value);
    if (built !== undefined) properties[spec.property] = built;
  };
  put(S.title, finalTitle);
  put(S.workArea, params.workAreas); // 배열 전달 — select면 첫 원소, multi_select면 전체
  put(S.workType, params.workType);
  put(S.status, params.status);
  put(S.priority, params.priority);
  put(S.startDate, params.startDate);
  put(S.endDate, params.endDate);
  if (params.assigneeNotionId) put(S.assignee, params.assigneeNotionId);
  if (params.memo) put(S.memo, params.memo);

  const page = await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "data_source_id", data_source_id: dsId },
      properties,
      children: markdownToBlocks(params.bodyMarkdown),
    }),
  });

  return { pageId: page.id, url: page.url ?? null };
}
