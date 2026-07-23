// 승인 게이트 — 승인 시에만 Notion 타임라인에 기록 (PRD 7장 4~6단계, 11장 3항)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { createTimelinePage } from "@/lib/notion";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import {
  NOTION_AREAS,
  NOTION_CATEGORIES,
  NOTION_PRIORITIES,
  NOTION_STATUSES,
  NOTION_WORK_TYPES,
  type Draft,
} from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function pick<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : fallback;
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const draftId = Number(params.id);
    const payload = await request.json().catch(() => ({}));

    const draft = await queryOne<Draft & { user_name: string; notion_user_id: string | null }>(
      `SELECT d.*, u.display_name AS user_name, ac.notion_user_id
       FROM drafts d
       JOIN actor u ON u.id = d.user_id
       LEFT JOIN account ac ON ac.actor_id = u.id
       WHERE d.id = $1`,
      [draftId]
    );
    if (!draft) return NextResponse.json({ error: "초안을 찾을 수 없습니다." }, { status: 404 });
    if (draft.status !== "pending") {
      return NextResponse.json({ error: "승인 대기 상태의 초안이 아닙니다." }, { status: 409 });
    }
    // 사수(담당자 본인) 또는 팀장만 승인 가능
    if (draft.user_id !== session.id && session.role !== "lead") {
      return NextResponse.json({ error: "승인 권한이 없습니다." }, { status: 403 });
    }

    const today = new Date().toISOString().slice(0, 10);
    const areasInput = Array.isArray(payload.areas)
      ? payload.areas.filter((a: unknown) => (NOTION_AREAS as readonly string[]).includes(a as string))
      : [];

    const { pageId, url } = await createTimelinePage({
      title: draft.title,
      category: pick(payload.category, NOTION_CATEGORIES, "개인 상시"),
      workType: pick(payload.workType, NOTION_WORK_TYPES, "개인업무"),
      areas: areasInput.length ? areasInput : ["기타"],
      status: pick(payload.status, NOTION_STATUSES, "완료"),
      priority: pick(payload.priority, NOTION_PRIORITIES, "Mid"),
      assigneeNotionId: draft.notion_user_id,
      startDate: typeof payload.startDate === "string" && payload.startDate ? payload.startDate : today,
      endDate: typeof payload.endDate === "string" && payload.endDate ? payload.endDate : today,
      memo: `팀보드 부사수 초안 승인 기록 (${draft.task_type})`,
      bodyMarkdown: draft.body,
    });

    await query(
      `UPDATE drafts SET status = 'approved', approver_id = $1, notion_page_id = $2, decided_at = now()
       WHERE id = $3`,
      [session.id, pageId, draftId]
    );
    await logActivity({
      userId: session.id,
      assistantId: draft.assistant_id,
      message: `${session.name}이(가) "${draft.title}" 승인 → Notion 타임라인 기록 완료`,
      level: "success",
    });

    return NextResponse.json({ ok: true, notionPageId: pageId, notionUrl: url });
  } catch (error) {
    return jsonError(error);
  }
}
