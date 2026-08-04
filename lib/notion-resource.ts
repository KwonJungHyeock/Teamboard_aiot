// Notion 리소스 연동 (MD-P-2026-012) — 서버 전용. 토큰은 절대 클라이언트로 나가지 않는다.
//
// 하는 일: 페이지 메타 조회 / 페이지 생성(백링크 포함) / 연결 테스트.
// 하지 않는 일: 상태·일정 양방향 동기화, Notion을 업무 저장소로 쓰기 (§제외).
import { queryOne, query } from "./db";

const NOTION_VERSION = "2022-06-28"; // 페이지 CRUD에 안정적인 버전
// 테스트·목(mock) 환경에서 엔드포인트를 바꿔 끼울 수 있게 (운영 기본값은 실제 API)
const API_BASE = process.env.NOTION_API_BASE ?? "https://api.notion.com/v1";

export function notionConfigured(): boolean {
  return !!process.env.NOTION_TOKEN;
}

/** Notion 호출 결과 — 실패를 예외로 던지지 않고 사유를 실어 돌려준다(카드가 깨지지 않게). */
export type NotionResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "unconfigured" | "forbidden" | "notfound" | "error"; message: string };

async function call<T>(path: string, init?: RequestInit): Promise<NotionResult<T>> {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    return { ok: false, kind: "unconfigured", message: "NOTION_TOKEN이 설정되지 않았습니다." };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false, kind: "forbidden",
        message: "접근 권한이 없습니다. Notion에서 이 페이지에 연동을 초대하세요.",
      };
    }
    if (res.status === 404) {
      // Notion은 권한이 없는 페이지도 404로 답한다 — 사용자에게는 초대 안내가 더 정확하다.
      return {
        ok: false, kind: "notfound",
        message: "페이지를 찾을 수 없습니다. 삭제되었거나 연동이 초대되지 않았습니다.",
      };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { ok: false, kind: "error", message: `Notion API 오류 (${res.status}) ${detail.slice(0, 120)}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    const message = e instanceof Error ? e.message : "알 수 없는 오류";
    return { ok: false, kind: "error", message: `Notion에 연결하지 못했습니다 — ${message}` };
  }
}

// ── 메타 조회 ──

export interface NotionPageMeta {
  title: string;
  iconUrl: string | null;
  lastEditedTime: string | null;
  url: string | null;
}

interface RichText { plain_text?: string }
interface NotionPage {
  id: string;
  url?: string;
  last_edited_time?: string;
  icon?: { type?: string; emoji?: string; external?: { url?: string }; file?: { url?: string } } | null;
  properties?: Record<string, { type?: string; title?: RichText[] }>;
}

function extractTitle(page: NotionPage): string {
  for (const v of Object.values(page.properties ?? {})) {
    if (v?.type === "title" && Array.isArray(v.title)) {
      const t = v.title.map((r) => r.plain_text ?? "").join("").trim();
      if (t) return t;
    }
  }
  return "제목 없는 Notion 페이지";
}

function extractIcon(page: NotionPage): string | null {
  const i = page.icon;
  if (!i) return null;
  if (i.type === "emoji" && i.emoji) return `emoji:${i.emoji}`;
  return i.external?.url ?? i.file?.url ?? null;
}

export async function fetchPageMeta(pageId: string): Promise<NotionResult<NotionPageMeta>> {
  const r = await call<NotionPage>(`/pages/${pageId}`);
  if (!r.ok) return r;
  return {
    ok: true,
    data: {
      title: extractTitle(r.data),
      iconUrl: extractIcon(r.data),
      lastEditedTime: r.data.last_edited_time ?? null,
      url: r.data.url ?? null,
    },
  };
}

/**
 * Notion rate limit은 평균 초당 3요청이다. 여러 링크를 새로고침할 때
 * 병렬로 쏘지 않고 순차 + 간격을 둔다 (§C).
 */
const RATE_GAP_MS = 350;
export async function mapSequential<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, RATE_GAP_MS));
    out.push(await fn(items[i]));
  }
  return out;
}

// ── 연결 테스트 (§B) ──

export interface NotionStatus {
  configured: boolean;
  ok: boolean;
  botName: string | null;
  workspaceName: string | null;
  message: string;
  checkedAt: string;
  parentPageId: string | null;
}

interface BotUser { name?: string; bot?: { workspace_name?: string } }

export async function testConnection(): Promise<NotionStatus> {
  const checkedAt = new Date().toISOString();
  const parentPageId = await getParentPageId();
  if (!notionConfigured()) {
    return {
      configured: false, ok: false, botName: null, workspaceName: null, parentPageId, checkedAt,
      message: "연구소 Notion 계정에서 Integration을 생성하고, 공유할 페이지에 초대한 뒤 토큰을 등록하세요.",
    };
  }
  const r = await call<BotUser>("/users/me");
  if (!r.ok) {
    return { configured: true, ok: false, botName: null, workspaceName: null, parentPageId, checkedAt, message: r.message };
  }
  await saveStatusCache({ ok: true, checkedAt });
  return {
    configured: true, ok: true,
    botName: r.data.name ?? null,
    workspaceName: r.data.bot?.workspace_name ?? null,
    parentPageId, checkedAt,
    message: "연결되었습니다.",
  };
}

async function saveStatusCache(v: { ok: boolean; checkedAt: string }): Promise<void> {
  await query(
    `INSERT INTO config (key, value) VALUES ('notion_status', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(v)]
  );
}

export async function lastCheckedAt(): Promise<string | null> {
  const r = await queryOne<{ value: { checkedAt?: string } }>(
    `SELECT value FROM config WHERE key = 'notion_status'`
  );
  return r?.value?.checkedAt ?? null;
}

// ── 문서 생성 상위 페이지 (§D) ──

export async function getParentPageId(): Promise<string | null> {
  const r = await queryOne<{ value: { parentPageId?: string } }>(
    `SELECT value FROM config WHERE key = 'notion_resource_parent'`
  );
  return r?.value?.parentPageId ?? null;
}

export async function setParentPageId(pageId: string | null): Promise<void> {
  await query(
    `INSERT INTO config (key, value) VALUES ('notion_resource_parent', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify({ parentPageId: pageId })]
  );
}

// ── 페이지 생성 (§D) ──

/**
 * 상위 페이지 아래에 문서를 만든다. 본문 첫 줄은 Mission Deck 백링크다 —
 * Notion 쪽에서 열었을 때 "이게 어느 업무의 기록인지" 바로 돌아올 수 있게.
 */
export async function createResourcePage(input: {
  title: string;
  backlinkLabel: string;   // "#82 · EDUINO AI"
  backlinkUrl: string;     // 절대 URL
}): Promise<NotionResult<{ pageId: string; url: string | null }>> {
  const parent = await getParentPageId();
  if (!parent) {
    return {
      ok: false, kind: "error",
      message: "Notion 문서를 만들 상위 페이지가 지정되지 않았습니다. 설정에서 먼저 지정하세요.",
    };
  }
  const r = await call<{ id: string; url?: string }>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { type: "page_id", page_id: parent },
      properties: { title: [{ type: "text", text: { content: input.title.slice(0, 200) } }] },
      children: [
        {
          object: "block", type: "paragraph",
          paragraph: {
            rich_text: [
              { type: "text", text: { content: "Mission Deck · " } },
              { type: "text", text: { content: input.backlinkLabel, link: { url: input.backlinkUrl } } },
            ],
          },
        },
        {
          object: "block", type: "callout",
          callout: {
            icon: { type: "emoji", emoji: "📌" },
            rich_text: [{
              type: "text",
              text: { content: "상태·일정·우선순위는 Mission Deck에서 관리합니다. 이 문서는 리소스와 상세 기록용입니다." },
            }],
          },
        },
        { object: "block", type: "divider", divider: {} },
      ],
    }),
  });
  if (!r.ok) return r;
  return { ok: true, data: { pageId: r.data.id, url: r.data.url ?? null } };
}
