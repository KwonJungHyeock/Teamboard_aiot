// 업무 문서 본문 (MD-P-2026-019 §F)
// 캔버스(project_canvas)와 같은 블록 모델·같은 낙관적 동시성을 쓴다. 규칙을 두 벌 만들지 않는다.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { query, queryOne } from "@/lib/db";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = ["text", "heading", "checklist", "quote", "code", "divider", "link", "image"] as const;
type BlockType = (typeof TYPES)[number];

interface DocBlock {
  id: string;
  type: BlockType;
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
  url?: string;
  meta?: { title?: string; provider?: string; domain?: string; thumbnail?: string | null } | null;
  internal?: unknown;
}

/** 스토리지 미연결이면 이미지 블록을 저장하지 않는다 — 깨진 카드가 남는 것을 막는다. */
const blobReady = () => !!process.env.BLOB_READ_WRITE_TOKEN;

function normalize(raw: unknown[]): DocBlock[] {
  return (raw as DocBlock[])
    .filter((b) => b && (TYPES as readonly string[]).includes(b.type))
    .filter((b) => b.type !== "image" || blobReady())
    .slice(0, 300)
    .map((b, i) => ({
      id: String(b.id ?? `b${i}`).slice(0, 40),
      type: b.type,
      ...(b.type === "text" || b.type === "heading" || b.type === "quote" || b.type === "code"
        ? { text: String(b.text ?? "").slice(0, 20000) }
        : {}),
      ...(b.type === "checklist"
        ? {
            items: (b.items ?? []).slice(0, 200).map((it, j) => ({
              id: String(it.id ?? `i${j}`).slice(0, 40),
              text: String(it.text ?? "").slice(0, 500),
              done: !!it.done,
            })),
          }
        : {}),
      ...(b.type === "link" || b.type === "image"
        ? { url: String(b.url ?? "").slice(0, 2000), meta: b.meta ?? null, internal: b.internal ?? null }
        : {}),
    }));
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    requireSession();
    const taskId = Number(params.id);
    if (!Number.isInteger(taskId)) return NextResponse.json({ error: "잘못된 업무입니다." }, { status: 400 });
    const row = await queryOne<{ doc: DocBlock[]; doc_updated_at: string | null; who: string | null }>(
      `SELECT t.doc, t.doc_updated_at::text, a.display_name AS who
         FROM task t LEFT JOIN actor a ON a.id = t.doc_updated_by
        WHERE t.id = $1`,
      [taskId]
    );
    if (!row) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
    return NextResponse.json({
      blocks: row.doc ?? [],
      updatedAt: row.doc_updated_at,
      updatedByName: row.who,
      blobReady: blobReady(),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  try {
    const session = requireSession();
    const taskId = Number(params.id);
    if (!Number.isInteger(taskId)) return NextResponse.json({ error: "잘못된 업무입니다." }, { status: 400 });

    const payload = await request.json();
    if (!Array.isArray(payload.blocks)) {
      return NextResponse.json({ error: "blocks 배열이 필요합니다." }, { status: 400 });
    }

    // 동시 편집 보호 — 캔버스와 같은 규칙 (MD-P-2026-013).
    if (typeof payload.baseUpdatedAt === "string" || payload.baseUpdatedAt === null) {
      const cur = await queryOne<{ doc_updated_at: string | null }>(
        `SELECT doc_updated_at::text FROM task WHERE id = $1`, [taskId]
      );
      const server = cur?.doc_updated_at ?? null;
      if (server && server !== payload.baseUpdatedAt) {
        return NextResponse.json({
          error: "다른 창에서 먼저 저장했어요. 최신 내용을 불러온 뒤 다시 편집하세요.",
          conflict: true,
          serverUpdatedAt: server,
        }, { status: 409 });
      }
    }

    const blocks = normalize(payload.blocks);
    const saved = await query<{ doc_updated_at: string }>(
      `UPDATE task SET doc = $1::jsonb, doc_updated_at = now(), doc_updated_by = $2
        WHERE id = $3 RETURNING doc_updated_at::text`,
      [JSON.stringify(blocks), session.id, taskId]
    );
    if (saved.length === 0) return NextResponse.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

    return NextResponse.json({
      blocks,
      updatedAt: saved[0].doc_updated_at,
      updatedByName: session.name,
    });
  } catch (error) {
    return jsonError(error);
  }
}
