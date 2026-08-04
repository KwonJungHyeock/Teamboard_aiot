// Notion 연동 관리·문서 생성 (MD-P-2026-012 §B·D) — 토큰은 이 서버 라우트 안에서만 쓰인다.
import { NextResponse } from "next/server";
import { requireSession, requireLead } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { logActivity } from "@/lib/activity";
import {
  testConnection, lastCheckedAt, getParentPageId, setParentPageId,
  createResourcePage, notionConfigured,
} from "@/lib/notion-resource";
import { addLink, saveMeta, type EntityType } from "@/lib/external-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 연결 상태 카드용 (§B) — 토큰 자체는 절대 내려보내지 않는다. */
export async function GET() {
  try {
    requireSession();
    return NextResponse.json({
      configured: notionConfigured(),
      parentPageId: await getParentPageId(),
      lastCheckedAt: await lastCheckedAt(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

/** [연결 테스트] — 실제로 /users/me 를 호출해 확인한다. */
export async function PUT() {
  try {
    requireLead();
    return NextResponse.json(await testConnection());
  } catch (error) {
    return jsonError(error);
  }
}

/** 상위 페이지 지정 (§D) — 여기 아래에 문서가 만들어진다. */
export async function PATCH(request: Request) {
  try {
    const session = requireLead();
    const body = await request.json();
    const raw = String(body.parentPageId ?? "").trim();
    if (!raw) {
      await setParentPageId(null);
      return NextResponse.json({ parentPageId: null });
    }
    // URL을 붙여넣어도 되게 — 끝의 32자리 hex를 id로 본다
    const m = raw.match(/([0-9a-f]{32})/i)
      ?? raw.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (!m) {
      return NextResponse.json({ error: "Notion 페이지 URL 또는 32자리 ID를 입력하세요." }, { status: 400 });
    }
    const hex = m[1].replace(/-/g, "");
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    await setParentPageId(id);
    await logActivity({ userId: session.id, message: `${session.name}이(가) Notion 문서 상위 페이지 지정` });
    return NextResponse.json({ parentPageId: id });
  } catch (error) {
    return jsonError(error);
  }
}

/**
 * "Notion 문서 만들기" (§D) — 제목 = 항목 제목, 본문 첫 줄에 Mission Deck 백링크.
 * 생성 성공 시 external_link로 자동 연결한다.
 */
export async function POST(request: Request) {
  try {
    const session = requireSession();
    const body = await request.json();
    const entityType = String(body.entityType ?? "") as EntityType;
    const entityId = Number(body.entityId);
    if (!["task", "project"].includes(entityType) || !Number.isInteger(entityId)) {
      return NextResponse.json({ error: "업무·프로젝트만 문서를 만들 수 있습니다." }, { status: 400 });
    }
    if (!notionConfigured()) {
      return NextResponse.json({ error: "Notion이 연결되지 않았습니다. 설정에서 토큰을 등록하세요." }, { status: 400 });
    }

    // 제목·백링크 라벨 만들기
    const row = entityType === "task"
      ? await queryOne<{ title: string; project_name: string | null }>(
          `SELECT t.title, p.name AS project_name FROM task t
             LEFT JOIN project p ON p.id = t.project_id
            WHERE t.id = $1 AND t.is_active = true`, [entityId])
      : await queryOne<{ title: string; project_name: string | null }>(
          `SELECT name AS title, NULL::text AS project_name FROM project
            WHERE id = $1 AND is_active = true`, [entityId]);
    if (!row) return NextResponse.json({ error: "대상을 찾을 수 없습니다." }, { status: 404 });

    const origin = new URL(request.url).origin;
    const backlinkUrl = entityType === "task"
      ? `${origin}/tasks?panel=task:${entityId}`
      : `${origin}/projects/${entityId}`;
    const backlinkLabel = entityType === "task"
      ? `#${entityId}${row.project_name ? ` · ${row.project_name}` : ""}`
      : `프로젝트 · ${row.title}`;

    const created = await createResourcePage({ title: row.title, backlinkLabel, backlinkUrl });
    if (!created.ok) return NextResponse.json({ error: created.message }, { status: 502 });

    const pageUrl = created.data.url ?? `https://www.notion.so/${created.data.pageId.replace(/-/g, "")}`;
    const link = await addLink({
      entityType, entityId, url: pageUrl, userId: session.id, title: row.title,
      meta: { createdByMissionDeck: true, backlinkLabel },
    });
    if (link) await saveMeta(link.id, { title: row.title });

    await logActivity({
      userId: session.id,
      message: `${session.name}이(가) Notion 문서 생성 — "${row.title}"`,
      level: "success",
      taskId: entityType === "task" ? entityId : null,
    });
    return NextResponse.json({ link, url: pageUrl });
  } catch (error) {
    return jsonError(error);
  }
}
