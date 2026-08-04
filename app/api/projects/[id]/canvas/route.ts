// 프로젝트 캔버스 (MD-P-2026-005 §C) — GET: 블록 조회, PUT: 자동저장(디바운스 800ms 클라이언트).
// 이미지 블록은 스토리지(Blob) 연결 전까지 저장하지 않는다(UI만 비활성 노출).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getCanvas, saveCanvas, type CanvasBlock } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["text", "checklist", "link", "image"] as const;

async function archivedGuard(projectId: number) {
  const p = await queryOne<{ status: string }>(
    `SELECT status FROM project WHERE id = $1 AND is_active = true`, [projectId]
  );
  if (!p) return { error: NextResponse.json({ error: "프로젝트를 찾을 수 없습니다." }, { status: 404 }) };
  if (p.status === "archived") {
    return { error: NextResponse.json({ error: "보관된 프로젝트는 읽기 전용입니다." }, { status: 403 }) };
  }
  return {};
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    return NextResponse.json(await getCanvas(Number(params.id)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const projectId = Number(params.id);
    const guard = await archivedGuard(projectId);
    if (guard.error) return guard.error;

    const payload = await request.json();
    if (!Array.isArray(payload.blocks)) {
      return NextResponse.json({ error: "blocks 배열이 필요합니다." }, { status: 400 });
    }
    // 정규화 — 알 수 없는 타입·필드는 버린다. 이미지는 스토리지 연결 전까지 저장하지 않음.
    const blocks: CanvasBlock[] = payload.blocks
      .filter((b: CanvasBlock) => b && (TYPES as readonly string[]).includes(b.type) && b.type !== "image")
      .slice(0, 200)
      .map((b: CanvasBlock, i: number) => ({
        id: String(b.id ?? `b${i}`).slice(0, 40),
        type: b.type,
        ...(b.type === "text" ? { text: String(b.text ?? "").slice(0, 8000) } : {}),
        ...(b.type === "checklist" ? {
          items: (b.items ?? []).slice(0, 100).map((it, j) => ({
            id: String(it.id ?? `i${j}`).slice(0, 40),
            text: String(it.text ?? "").slice(0, 500),
            done: !!it.done,
          })),
        } : {}),
        ...(b.type === "link" ? {
          url: String(b.url ?? "").slice(0, 1000),
          meta: b.meta ? {
            title: String(b.meta.title ?? "").slice(0, 300),
            domain: String(b.meta.domain ?? "").slice(0, 120),
            provider: String(b.meta.provider ?? "").slice(0, 40),
            thumbnail: String(b.meta.thumbnail ?? "").slice(0, 1000),
          } : undefined,
        } : {}),
      }));

    return NextResponse.json(await saveCanvas(projectId, blocks, session.id));
  } catch (error) {
    return jsonError(error);
  }
}
