// 에이전트 커스텀 — 본인 것만. 신규 스키마: actor(type='agent') + agent_config
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, getAssistantByOwner } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { NOTION_WORK_AREAS } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(row: NonNullable<Awaited<ReturnType<typeof getAssistantByOwner>>>) {
  return { ...row, work_areas: Array.isArray(row.work_areas) ? row.work_areas : [] };
}

export async function GET() {
  try {
    const session = requireSession();
    const assistant = await getAssistantByOwner(session.id);
    if (!assistant) return NextResponse.json({ error: "에이전트가 없습니다." }, { status: 404 });
    return NextResponse.json({ assistant: normalize(assistant) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();

    const name = String(payload.name ?? "").trim().slice(0, 50) || "에이전트";
    const reportStyle = payload.reportStyle === "detailed" ? "detailed" : "brief";
    const workAreas = Array.isArray(payload.workAreas)
      ? payload.workAreas.filter((a: unknown) =>
          (NOTION_WORK_AREAS as readonly string[]).includes(a as string)
        )
      : [];
    const autoScope = String(payload.autoScope ?? "own").slice(0, 50);
    const systemPromptExtra = String(payload.systemPromptExtra ?? "").slice(0, 4000);

    const existing = await getAssistantByOwner(session.id);
    if (!existing) return NextResponse.json({ error: "에이전트가 없습니다." }, { status: 404 });

    await query("UPDATE actor SET display_name = $1 WHERE id = $2", [name, existing.id]);
    await query(
      `UPDATE agent_config
       SET report_style = $1, work_areas = $2, auto_scope = $3,
           system_prompt_extra = $4, updated_at = now()
       WHERE actor_id = $5`,
      [reportStyle, JSON.stringify(workAreas), autoScope, systemPromptExtra, existing.id]
    );

    const assistant = await getAssistantByOwner(session.id);
    await logActivity({
      userId: session.id,
      assistantId: existing.id,
      message: `${session.name}이(가) 에이전트 설정 변경 (이름: ${name}, 스타일: ${reportStyle})`,
    });
    return NextResponse.json({ assistant: assistant ? normalize(assistant) : null });
  } catch (error) {
    return jsonError(error);
  }
}
