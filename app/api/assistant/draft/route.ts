// 부사수에게 부수 업무 위임 → 초안 생성 (PRD 7장 흐름 1~3단계)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { generateDraft } from "@/lib/claude";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { TASK_TYPES, type AssistantSettings, type Draft, type TaskType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120; // Claude 초안 생성 대기

export async function POST(request: Request) {
  let draftId: number | null = null;
  try {
    const session = requireSession();
    const payload = await request.json();
    const taskType = payload.taskType as TaskType;
    const instruction = String(payload.instruction ?? "").trim();
    const reworkOf = payload.reworkOf ? Number(payload.reworkOf) : null;

    if (!TASK_TYPES.includes(taskType)) {
      return NextResponse.json({ error: "업무 유형이 올바르지 않습니다." }, { status: 400 });
    }
    if (!instruction) {
      return NextResponse.json({ error: "업무 내용을 입력하세요." }, { status: 400 });
    }

    const assistantRow = await queryOne<AssistantSettings & { work_areas: any }>(
      "SELECT * FROM assistants WHERE user_id = $1",
      [session.id]
    );
    if (!assistantRow) {
      return NextResponse.json({ error: "부사수가 설정되지 않았습니다." }, { status: 404 });
    }
    const assistant: AssistantSettings = {
      ...assistantRow,
      work_areas: Array.isArray(assistantRow.work_areas) ? assistantRow.work_areas : [],
    };

    // 재작업이면 원 초안(본인 것, 반려 상태)을 불러온다
    let previousDraft: { title: string; body: string; feedback: string } | null = null;
    if (reworkOf) {
      const prev = await queryOne<Draft>(
        "SELECT * FROM drafts WHERE id = $1 AND user_id = $2 AND status = 'rejected'",
        [reworkOf, session.id]
      );
      if (!prev) {
        return NextResponse.json({ error: "재작업할 반려 초안을 찾을 수 없습니다." }, { status: 404 });
      }
      previousDraft = { title: prev.title, body: prev.body, feedback: prev.feedback ?? "" };
    }

    // draft(status=working) 저장 → 화면 A "진행 중 업무"에 표시
    const inserted = await queryOne<{ id: number }>(
      `INSERT INTO drafts (assistant_id, user_id, task_type, instruction, rework_of, status)
       VALUES ($1, $2, $3, $4, $5, 'working') RETURNING id`,
      [assistant.id, session.id, taskType, instruction, reworkOf]
    );
    draftId = inserted!.id;
    await logActivity({
      userId: session.id,
      assistantId: assistant.id,
      message: `${assistant.name}: ${taskType} 초안 작성 시작 — "${instruction.slice(0, 60)}"`,
    });

    const result = await generateDraft({ assistant, taskType, instruction, previousDraft });

    await query(
      `UPDATE drafts SET title = $1, body = $2, status = 'pending' WHERE id = $3`,
      [result.title, result.body, draftId]
    );
    await logActivity({
      userId: session.id,
      assistantId: assistant.id,
      message: `${assistant.name}: 초안 완성 — "${result.title}" (승인 대기)`,
      level: "success",
    });

    const draft = await queryOne<Draft>("SELECT * FROM drafts WHERE id = $1", [draftId]);
    return NextResponse.json({ draft });
  } catch (error) {
    if (draftId) {
      await query("UPDATE drafts SET status = 'failed' WHERE id = $1", [draftId]).catch(() => {});
      await logActivity({
        message: `초안 생성 실패 (draft #${draftId}): ${error instanceof Error ? error.message : error}`,
        level: "error",
      }).catch(() => {});
    }
    return jsonError(error);
  }
}
