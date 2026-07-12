// Notion 연동 (PRD 9장) — 서버(API Routes)에서만 호출. 토큰은 서버 환경변수에만.
// 삭제 금지 원칙: 페이지 삭제 API는 사용하지 않는다 (PRD 11장).
import { queryOne } from "./db";
import type { TimelineItem } from "./types";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2025-09-03"; // data_source 지원 버전

function token(): string {
  const t = process.env.NOTION_TOKEN;
  if (!t) throw new Error("NOTION_TOKEN 환경변수가 설정되지 않았습니다.");
  return t;
}

export async function getTimelineDataSourceId(): Promise<string> {
  const row = await queryOne<{ value: { dataSourceId?: string } }>(
    "SELECT value FROM app_settings WHERE key = 'notion_scope'"
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

function plainText(richText: any[] | undefined): string {
  return (richText ?? []).map((t: any) => t?.plain_text ?? "").join("");
}

function pageToTimelineItem(page: any): TimelineItem {
  const props = page.properties ?? {};
  return {
    pageId: page.id,
    title: plainText(props["업무명"]?.title) || "(제목 없음)",
    category: props["구분"]?.select?.name ?? null,
    workType: props["업무유형"]?.select?.name ?? null,
    areas: (props["업무 구분"]?.multi_select ?? []).map((s: any) => s.name),
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
  category: string; // 구분: 팀 메인 | 개인 상시
  workType: string; // 업무유형: 팀업무 | 개인업무 | 상시업무
  areas: string[]; // 업무 구분
  status: string; // 대기 | 진행 | 완료
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
  const properties: any = {
    업무명: { title: [{ type: "text", text: { content: params.title.slice(0, 200) } }] },
    구분: { select: { name: params.category } },
    업무유형: { select: { name: params.workType } },
    "업무 구분": { multi_select: params.areas.map((name) => ({ name })) },
    상태: { status: { name: params.status } },
    우선순위: { select: { name: params.priority } },
    시작일: { date: { start: params.startDate } },
    종료일: { date: { start: params.endDate } },
  };
  if (params.assigneeNotionId) {
    properties["담당자"] = { people: [{ id: params.assigneeNotionId }] };
  }
  if (params.memo) {
    properties["메모"] = {
      rich_text: [{ type: "text", text: { content: params.memo.slice(0, 2000) } }],
    };
  }

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
