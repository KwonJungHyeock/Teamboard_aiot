// 자료 수정 (Phase 5) — 소프트 삭제(isActive=false)와 제목·kind 수정만. 하드 삭제 없음.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { logActivity } from "@/lib/activity";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["notion", "github", "figma", "file", "link"] as const;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const artifactId = Number(params.id);
    const payload = await request.json();

    const artifact = await queryOne<{ id: number; title: string }>(
      "SELECT id, title FROM artifact WHERE id = $1 AND is_active = true",
      [artifactId]
    );
    if (!artifact) return NextResponse.json({ error: "자료를 찾을 수 없습니다." }, { status: 404 });

    if (payload.isActive === false) {
      await query("UPDATE artifact SET is_active = false WHERE id = $1", [artifactId]);
      await logActivity({
        userId: session.id,
        message: `${session.name}이(가) 자료 링크 삭제 — "${artifact.title}"`,
        level: "warn",
      });
      return NextResponse.json({ ok: true });
    }

    const sets: string[] = [];
    const values: unknown[] = [];
    const set = (column: string, value: unknown) => {
      values.push(value);
      sets.push(`${column} = $${values.length}`);
    };
    if (typeof payload.title === "string" && payload.title.trim()) set("title", payload.title.trim().slice(0, 200));
    if ((KINDS as readonly string[]).includes(payload.kind)) set("kind", payload.kind);

    if (sets.length > 0) {
      values.push(artifactId);
      await query(`UPDATE artifact SET ${sets.join(", ")} WHERE id = $${values.length}`, values);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
