// 연결된 리소스 (MD-P-2026-012 §C·E) — 목록·추가·해제.
// 메타 조회는 15분 캐시를 지나야만 다시 나간다. 실패해도 링크는 살아 있고 사유만 붙는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import {
  listLinks, addLink, removeLink, isFresh, saveMeta, saveFetchError,
  detectProvider, notionPageId, type EntityType, type ExternalLink,
} from "@/lib/external-link";
import { fetchPageMeta, mapSequential, notionConfigured } from "@/lib/notion-resource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: EntityType[] = ["task", "project", "goal", "decision"];
const isType = (v: string): v is EntityType => (TYPES as string[]).includes(v);

/**
 * 오래된 Notion 링크만 골라 순차 갱신한다.
 * 15분 이내면 아예 호출하지 않는다 — rate limit(초당 3)과 응답 지연을 함께 아낀다.
 */
async function refreshStale(links: ExternalLink[]): Promise<ExternalLink[]> {
  if (!notionConfigured()) return links;
  const stale = links.filter((l) => l.provider === "notion" && !isFresh(l.lastSyncedAt));
  if (stale.length === 0) return links;

  const updated = new Map<number, Partial<ExternalLink>>();
  await mapSequential(stale, async (l) => {
    const pageId = notionPageId(l.url);
    if (!pageId) {
      await saveFetchError(l.id, "Notion 페이지 id를 URL에서 찾지 못했습니다.");
      updated.set(l.id, { error: "Notion 페이지 id를 URL에서 찾지 못했습니다." });
      return;
    }
    const r = await fetchPageMeta(pageId);
    if (r.ok) {
      await saveMeta(l.id, {
        title: r.data.title,
        iconUrl: r.data.iconUrl,
        extra: { lastEditedTime: r.data.lastEditedTime, notionUrl: r.data.url },
      });
      updated.set(l.id, {
        title: r.data.title, iconUrl: r.data.iconUrl,
        meta: { ...l.meta, lastEditedTime: r.data.lastEditedTime, notionUrl: r.data.url },
        error: null,
      });
    } else {
      // 실패해도 마지막 성공 제목은 남긴다 (§C 깨진 카드 금지)
      await saveFetchError(l.id, r.message);
      updated.set(l.id, { error: r.message });
    }
  });

  return links.map((l) => (updated.has(l.id) ? { ...l, ...updated.get(l.id) } : l));
}

export async function GET(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const entityType = String(url.searchParams.get("entityType") ?? "");
    const entityId = Number(url.searchParams.get("entityId"));
    if (!isType(entityType) || !Number.isInteger(entityId) || entityId <= 0) {
      return NextResponse.json({ error: "대상이 올바르지 않습니다." }, { status: 400 });
    }
    const links = await listLinks(entityType, entityId);
    // skipRefresh=1 이면 저장값만 — 캐시 동작 검증·빠른 렌더용
    const refreshed = url.searchParams.get("skipRefresh") === "1" ? links : await refreshStale(links);
    return NextResponse.json({
      links: refreshed.map((l) => ({ ...l, error: l.error ?? (l.meta?.lastError as string | undefined) ?? null })),
      notionConfigured: notionConfigured(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** 링크 붙여넣기 → 연결 생성 (§C). 메타는 다음 조회에서 채워진다(렌더를 막지 않는다). */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const entityType = String(body.entityType ?? "");
    const entityId = Number(body.entityId);
    const raw = String(body.url ?? "").trim();
    if (!isType(entityType) || !Number.isInteger(entityId) || entityId <= 0) {
      return NextResponse.json({ error: "대상이 올바르지 않습니다." }, { status: 400 });
    }
    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return NextResponse.json({ error: "올바른 URL이 아닙니다." }, { status: 400 });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return NextResponse.json({ error: "http(s) 링크만 연결할 수 있습니다." }, { status: 400 });
    }

    const link = await addLink({
      entityType, entityId, url: parsed.toString(), userId: session.id,
      title: body.title ?? null, meta: body.meta ?? {},
    });
    if (!link) return NextResponse.json({ error: "연결에 실패했습니다." }, { status: 500 });

    // 방금 붙인 Notion 링크는 즉시 한 번 채워준다(카드가 URL로만 남지 않게).
    let error: string | null = null;
    if (link.provider === "notion" && notionConfigured()) {
      const pageId = notionPageId(link.url);
      const r = pageId ? await fetchPageMeta(pageId) : null;
      if (r?.ok) {
        await saveMeta(link.id, {
          title: r.data.title, iconUrl: r.data.iconUrl,
          extra: { lastEditedTime: r.data.lastEditedTime, notionUrl: r.data.url },
        });
        link.title = r.data.title;
        link.iconUrl = r.data.iconUrl;
        link.meta = { lastEditedTime: r.data.lastEditedTime, notionUrl: r.data.url };
      } else if (r) {
        await saveFetchError(link.id, r.message);
        error = r.message;
      }
    }

    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) 리소스 연결 — ${detectProvider(link.url)} · ${link.title ?? link.url}`,
      taskId: entityType === "task" ? entityId : null,
    });
    return NextResponse.json({ link: { ...link, error } });
  } catch (error) {
    return jsonError(error);
  }
}

/** 연결 해제 — Notion 원본은 삭제하지 않는다 (§E). */
export async function DELETE(request: Request) {
  try {
    requireSession();
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    const entityType = String(url.searchParams.get("entityType") ?? "");
    const entityId = Number(url.searchParams.get("entityId"));
    if (!Number.isInteger(id) || !isType(entityType) || !Number.isInteger(entityId)) {
      return NextResponse.json({ error: "잘못된 요청입니다." }, { status: 400 });
    }
    const ok = await removeLink(id, entityType, entityId);
    if (!ok) return NextResponse.json({ error: "연결을 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
