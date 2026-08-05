// 프로젝트 캔버스 (MD-P-2026-005 §C) — GET: 블록 조회, PUT: 자동저장(디바운스 800ms 클라이언트).
// 이미지 블록은 Private Blob 의 pathname 을 저장한다 (MD-P-2026-014a §A). 공개 URL을 저장하지 않는다.
// 블록이 사라지면 blob 객체도 지운다 (§D).
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";
import { getCanvas, saveCanvas, type CanvasBlock } from "@/lib/projects";
import { blobEnabled, delPrivate, parseScope } from "@/lib/blob";

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
    const doc = await getCanvas(Number(params.id));
    return NextResponse.json({ ...doc, blobReady: blobEnabled() });
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
    // 동시 편집 보호 (MD-P-2026-013) — 클라이언트가 들고 있던 baseUpdatedAt보다 서버가
    // 더 최신이면 다른 창이 먼저 저장한 것이다. 조용히 덮어쓰지 않고 409로 알린다.
    if (typeof payload.baseUpdatedAt === "string" || payload.baseUpdatedAt === null) {
      const cur = await queryOne<{ updated_at: string | null }>(
        `SELECT updated_at::text FROM project_canvas WHERE project_id = $1`, [projectId]
      );
      const server = cur?.updated_at ?? null;
      if (server && server !== payload.baseUpdatedAt) {
        return NextResponse.json({
          error: "다른 창에서 먼저 저장했어요. 최신 내용을 불러온 뒤 다시 편집하세요.",
          conflict: true,
          serverUpdatedAt: server,
        }, { status: 409 });
      }
    }
    // 정규화 — 알 수 없는 타입·필드는 버린다.
    // 이미지는 스토리지 미연결이거나 pathname 이 규칙에 맞지 않으면 버린다(깨진 카드 방지).
    const blocks: CanvasBlock[] = payload.blocks
      .filter((b: CanvasBlock) => b && (TYPES as readonly string[]).includes(b.type))
      .filter((b: CanvasBlock) => {
        if (b.type !== "image") return true;
        if (!blobEnabled() || !b.pathname) return false;
        const sc = parseScope(b.pathname);
        return !!sc && sc.kind === "project" && sc.id === projectId;
      })
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
        ...(b.type === "image" ? {
          pathname: String(b.pathname ?? "").slice(0, 500),
          name: String(b.name ?? "").slice(0, 200),
          size: Number(b.size ?? 0) || 0,
          contentType: String(b.contentType ?? "").slice(0, 100),
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

    // §D — 이번 저장으로 사라진 이미지의 blob 객체를 지운다. 실패해도 저장은 진행한다.
    const before = await getCanvas(projectId);
    const kept = new Set(blocks.filter((b) => b.type === "image" && b.pathname).map((b) => b.pathname as string));
    const orphans = before.blocks
      .filter((b) => b.type === "image" && b.pathname && !kept.has(b.pathname))
      .map((b) => b.pathname as string);
    let blobDeleteError: string | null = null;
    if (orphans.length && blobEnabled()) {
      // 삭제가 실패해도 저장은 진행하되, 조용히 묻지 않는다 — 검증에서 원인을 볼 수 있어야 한다.
      await delPrivate(orphans).catch((e) => { blobDeleteError = e instanceof Error ? e.message : String(e); });
    }

    const saved = await saveCanvas(projectId, blocks, session.id);
    return NextResponse.json({
      ...saved,
      blobReady: blobEnabled(),
      removedBlobs: blobDeleteError ? 0 : orphans.length,
      ...(blobDeleteError ? { blobDeleteError } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
