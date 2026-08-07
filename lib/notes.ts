// 개인 메모 (MD-P-2026-025 §C) — **항상 개인이다.**
//
// 공개 옵션을 만들지 않는다. 공유가 필요하면 논의나 캔버스로 간다.
// 여기에 공개 스위치를 달면 다시 "이걸 올리면 남들이 보나?"를 판단해야 하고,
// 그 판단을 없애는 것이 이번 지시의 목적이다.
//
// 그래서 가시성 조건이 따로 없다 — 쿼리마다 `owner_actor_id = $viewer` 가 곧 조건이다.
// task 처럼 visibility 컬럼을 두지 않은 이유도 같다(값이 하나뿐인 컬럼은 규칙이 아니라 장식이다).

/** 본문 블록 — 문서형 업무(task.doc)·캔버스와 같은 모델. 규칙을 두 벌 만들지 않는다. */
export const NOTE_BLOCK_TYPES = [
  "text", "heading", "checklist", "quote", "code", "divider", "link",
] as const;
export type NoteBlockType = (typeof NOTE_BLOCK_TYPES)[number];

// 이미지 블록은 이번 단계에서 제외한다 —
// blob 경로 스코프에 'note' 가 없어서 새 접근 판정 분기를 만들어야 하는데,
// 검증되지 않은 접근 경로를 늘리는 것은 §A3 의 취지와 정면으로 어긋난다. (백로그 B-6)

export interface NoteBlock {
  id: string;
  type: NoteBlockType;
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
  url?: string;
  meta?: { title?: string; provider?: string; domain?: string; thumbnail?: string | null } | null;
  internal?: unknown;
}

/** 저장 전 정규화 — 업무 문서(app/api/tasks/[id]/doc)와 같은 상한을 쓴다. */
export function normalizeNoteBlocks(raw: unknown): NoteBlock[] {
  if (!Array.isArray(raw)) return [];
  return (raw as NoteBlock[])
    .filter((b) => b && (NOTE_BLOCK_TYPES as readonly string[]).includes(b.type))
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
      ...(b.type === "link"
        ? { url: String(b.url ?? "").slice(0, 2000), meta: b.meta ?? null, internal: b.internal ?? null }
        : {}),
    }));
}

/**
 * 목록에 쓸 첫 줄 발췌 (§C — "제목 · 첫 줄 발췌 · 수정일").
 * 제목 줄은 건너뛴다 — 제목 옆에 제목을 또 쓰면 한 줄이 낭비된다.
 */
export function noteExcerpt(blocks: unknown, limit = 80): string {
  if (!Array.isArray(blocks)) return "";
  for (const b of blocks as NoteBlock[]) {
    if (b?.type === "checklist") {
      const first = b.items?.find((i) => i.text?.trim());
      if (first) return first.text.trim().slice(0, limit);
      continue;
    }
    const t = typeof b?.text === "string" ? b.text.trim() : "";
    if (t) return t.slice(0, limit);
  }
  return "";
}

/** 제목이 비어 있을 때 목록에 쓸 이름. 빈 줄로 두면 무엇인지 알 수 없다. */
export function noteTitle(title: string, blocks: unknown): string {
  const t = title.trim();
  if (t) return t;
  const ex = noteExcerpt(blocks, 40);
  return ex || "제목 없는 메모";
}
