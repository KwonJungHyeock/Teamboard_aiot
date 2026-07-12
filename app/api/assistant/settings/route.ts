// 부사수 커스텀 — 본인 것만 (PRD 6장 화면 A)
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";
import { NOTION_AREAS, type AssistantSettings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = requireSession();
    const assistant = await queryOne<AssistantSettings>(
      "SELECT * FROM assistants WHERE user_id = $1",
      [session.id]
    );
    if (!assistant) return NextResponse.json({ error: "부사수가 없습니다." }, { status: 404 });
    return NextResponse.json({ assistant });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const session = requireSession();
    const payload = await request.json();

    const name = String(payload.name ?? "").trim().slice(0, 50) || "부사수";
    const reportStyle = payload.reportStyle === "detailed" ? "detailed" : "brief";
    const workAreas = Array.isArray(payload.workAreas)
      ? payload.workAreas.filter((a: unknown) =>
          (NOTION_AREAS as readonly string[]).includes(a as string)
        )
      : [];
    const autoScope = String(payload.autoScope ?? "own").slice(0, 50);
    const systemPromptExtra = String(payload.systemPromptExtra ?? "").slice(0, 4000);

    const assistant = await queryOne<AssistantSettings>(
      `UPDATE assistants
       SET name = $1, report_style = $2, work_areas = $3, auto_scope = $4,
           system_prompt_extra = $5, updated_at = now()
       WHERE user_id = $6
       RETURNING *`,
      [name, reportStyle, JSON.stringify(workAreas), autoScope, systemPromptExtra, session.id]
    );
    if (!assistant) return NextResponse.json({ error: "부사수가 없습니다." }, { status: 404 });

    await logActivity({
      userId: session.id,
      assistantId: assistant.id,
      message: `${session.name}이(가) 부사수 설정 변경 (이름: ${name}, 스타일: ${reportStyle})`,
    });
    return NextResponse.json({ assistant });
  } catch (error) {
    return jsonError(error);
  }
}
