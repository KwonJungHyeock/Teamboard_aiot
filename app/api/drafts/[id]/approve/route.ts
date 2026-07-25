// 승인 게이트 — 승인 시에만 Notion 타임라인에 기록 (PRD 7장 4~6단계, 11장 3항)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { createTimelinePage } from "@/lib/notion";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import {
  NOTION_WORK_AREAS,
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
    // 담당자 본인 또는 팀장만 승인 가능
    if (draft.user_id !== session.id && session.role !== "lead") {
      return NextResponse.json({ error: "승인 권한이 없습니다." }, { status: 403 });
    }

    const today = new Date().toISOString().slice(0, 10);
    // 초안 본문 첫 의미 줄을 메모(목록 뷰용 한 줄 요약)로 사용
    const summaryLine =
      draft.body
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l && !l.startsWith("#") && !l.startsWith("---")) ?? draft.title;

    // Notion 기록은 미러(D-011) — 실패해도 승인 자체는 확정한다. 실패 시 오류를 표면화·기록.
    let pageId: string | null = null;
    let notionUrl: string | null = null;
    let notionError: string | null = null;
    try {
      const res = await createTimelinePage({
        title: draft.title, // 업무 구분 접두어는 createTimelinePage가 삽입
        workType: pick(payload.workType, NOTION_WORK_TYPES, "개인업무"),
        workAreas: [pick(payload.workArea, NOTION_WORK_AREAS, "기타")], // 배열 유지(모달은 단일 선택)
        status: pick(payload.status, NOTION_STATUSES, "진행"), // 승인 기본값: 진행
        priority: pick(payload.priority, NOTION_PRIORITIES, "Mid"),
        assigneeNotionId: draft.notion_user_id,
        // start_date 없으면 시작일 속성 생략 (빈 문자열 → createTimelinePage가 미전송). due_date는 종료일.
        startDate: typeof payload.startDate === "string" && payload.startDate ? payload.startDate : "",
        endDate: typeof payload.endDate === "string" && payload.endDate ? payload.endDate : today,
        memo: summaryLine.slice(0, 200),
        bodyMarkdown: draft.body,
      });
      pageId = res.pageId;
      notionUrl = res.url;
    } catch (notionErr) {
      notionError = notionErr instanceof Error ? notionErr.message : "Notion 기록 실패";
    }

    // 승인은 항상 확정(우리 DB가 원본). Notion 실패 시 notion_page_id는 NULL 유지.
    await query(
      `UPDATE drafts SET status = 'approved', approver_id = $1, notion_page_id = $2, decided_at = now()
       WHERE id = $3`,
      [session.id, pageId, draftId]
    );
    await logActivity({
      userId: session.id,
      assistantId: draft.assistant_id,
      message: notionError
        ? `${session.name}이(가) "${draft.title}" 승인 — 저장 완료, Notion 기록 실패: ${notionError.slice(0, 300)}`
        : `${session.name}이(가) "${draft.title}" 승인 → Notion 타임라인 기록 완료`,
      level: notionError ? "error" : "success",
    });

    // 실패해도 HTTP 200 — 승인은 성공. UI가 notionError로 경고를 띄운다.
    return NextResponse.json({ ok: true, notionPageId: pageId, notionUrl, notionError });
  } catch (error) {
    return jsonError(error);
  }
}
