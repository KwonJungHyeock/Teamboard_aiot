"use client";

// 프로젝트 캔버스 (MD-P-2026-005 §C) — 과정 기록의 본체.
// 블록: 텍스트(마크다운) · 체크리스트 · 링크(언퍼 카드). 이미지 블록은 스토리지 연결 전까지 비활성.
// 인라인 편집 + 자동저장(디바운스 800ms) + "○○님이 방금 수정" 표시. 실패 시 롤백 + 토스트.
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { toast } from "@/lib/quick";

type BlockType = "text" | "checklist" | "link" | "image";
interface CheckItem { id: string; text: string; done: boolean }
interface Block {
  id: string;
  type: BlockType;
  text?: string;
  items?: CheckItem[];
  url?: string;
  meta?: { title?: string; domain?: string; thumbnail?: string; provider?: string };
}

const uid = () => `b${Math.random().toString(36).slice(2, 9)}`;

function relTime(iso: string | null): string {
  if (!iso) return "";
  // pg의 "YYYY-MM-DD HH:MM:SS+00" → 전 브라우저 호환 ISO
  let s = iso.replace(" ", "T");
  if (/[+-]\d{2}$/.test(s)) s += ":00";
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function ProjectCanvas({ projectId, readOnly = false }: { projectId: number; readOnly?: boolean }) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<{ updatedAt: string | null; updatedByName: string | null }>({ updatedAt: null, updatedByName: null });
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");
  const lastSaved = useRef<Block[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/canvas`).then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const b = d.blocks ?? [];
        setBlocks(b); lastSaved.current = b;
        setMeta({ updatedAt: d.updatedAt ?? null, updatedByName: d.updatedByName ?? null });
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [projectId]);

  // 자동저장 — 디바운스 800ms. 실패 시 직전 저장본으로 롤백 + 토스트.
  const scheduleSave = useCallback((next: Block[]) => {
    if (readOnly) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSaving("saving");
      const res = await fetch(`/api/projects/${projectId}/canvas`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: next }),
      }).catch(() => null);
      if (!res || !res.ok) {
        setBlocks(lastSaved.current);
        setSaving("idle");
        toast("캔버스 저장에 실패해 되돌렸어요", "err");
        return;
      }
      const d = await res.json();
      lastSaved.current = d.blocks ?? next;
      setMeta({ updatedAt: d.updatedAt ?? null, updatedByName: d.updatedByName ?? null });
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 1600);
    }, 800);
  }, [projectId, readOnly]);

  function update(next: Block[]) {
    setBlocks(next);
    scheduleSave(next);
  }
  function patchBlock(id: string, fields: Partial<Block>) {
    update(blocks.map((b) => (b.id === id ? { ...b, ...fields } : b)));
  }
  function addBlock(type: BlockType) {
    const nb: Block = type === "checklist"
      ? { id: uid(), type, items: [{ id: uid(), text: "", done: false }] }
      : type === "link" ? { id: uid(), type, url: "" }
        : { id: uid(), type, text: "" };
    update([...blocks, nb]);
  }
  function removeBlock(id: string) {
    update(blocks.filter((b) => b.id !== id));
  }

  // 링크 블록 — URL 확정 시 언퍼 조회
  async function unfurl(id: string, url: string) {
    if (!url.trim()) return;
    patchBlock(id, { url });
    const res = await fetch("/api/unfurl", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
    }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      // 최신 상태 기준으로 갱신(디바운스 중 다른 편집과 충돌 방지)
      setBlocks((cur) => {
        const next = cur.map((b) => (b.id === id ? { ...b, url, meta: d.meta } : b));
        scheduleSave(next);
        return next;
      });
    }
  }

  if (loading) return <p className="gempty">불러오는 중...</p>;

  return (
    <section className="card pcanvas" aria-label="프로젝트 캔버스">
      <div className="pcv-bar">
        <span className="pcv-status">
          {saving === "saving" ? "저장 중…" : saving === "saved" ? "저장됨" :
            meta.updatedByName ? `${meta.updatedByName}님이 ${relTime(meta.updatedAt)} 수정` : ""}
        </span>
        {!readOnly && (
          <div className="pcv-add">
            <button onClick={() => addBlock("text")}>＋ 텍스트</button>
            <button onClick={() => addBlock("checklist")}>＋ 체크리스트</button>
            <button onClick={() => addBlock("link")}>＋ 링크</button>
            <button className="off" disabled title="스토리지 연결 후 사용 가능">＋ 이미지</button>
          </div>
        )}
      </div>

      {blocks.length === 0 ? (
        <div className="pcv-empty">
          <p>이 프로젝트의 설계·자료조사를 여기에 기록하세요.</p>
          <p className="sub">Figma 링크를 붙여넣으면 카드로 표시됩니다.</p>
          {!readOnly && <button className="btn-brand" onClick={() => addBlock("text")}>＋ 첫 블록 추가</button>}
        </div>
      ) : (
        <div className="pcv-blocks">
          {blocks.map((b) => (
            <div className="pcv-b" key={b.id}>
              {b.type === "text" && (
                readOnly
                  ? <Markdown className="pcv-md" text={b.text ?? ""} />
                  : <textarea className="pcv-text" value={b.text ?? ""} rows={Math.max(2, (b.text ?? "").split("\n").length)}
                      placeholder="메모·설계 노트… (마크다운 지원)"
                      onChange={(e) => patchBlock(b.id, { text: e.target.value })} />
              )}

              {b.type === "checklist" && (
                <div className="pcv-check">
                  {(b.items ?? []).map((it) => (
                    <div className="pcv-ci" key={it.id}>
                      <input type="checkbox" checked={it.done} disabled={readOnly}
                        onChange={(e) => patchBlock(b.id, { items: (b.items ?? []).map((x) => x.id === it.id ? { ...x, done: e.target.checked } : x) })} />
                      <input className={`pcv-cit${it.done ? " done" : ""}`} value={it.text} disabled={readOnly}
                        placeholder="할 일"
                        onChange={(e) => patchBlock(b.id, { items: (b.items ?? []).map((x) => x.id === it.id ? { ...x, text: e.target.value } : x) })} />
                      {!readOnly && (
                        <button className="pcv-cix" aria-label="항목 삭제"
                          onClick={() => patchBlock(b.id, { items: (b.items ?? []).filter((x) => x.id !== it.id) })}>✕</button>
                      )}
                    </div>
                  ))}
                  {!readOnly && (
                    <button className="pcv-ciadd"
                      onClick={() => patchBlock(b.id, { items: [...(b.items ?? []), { id: uid(), text: "", done: false }] })}>
                      ＋ 항목
                    </button>
                  )}
                </div>
              )}

              {b.type === "link" && (
                b.meta?.title ? (
                  <a className="pcv-link" href={b.url} target="_blank" rel="noreferrer">
                    {b.meta.thumbnail
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img className="pcv-link-th" src={b.meta.thumbnail} alt="" />
                      : <span className="pcv-link-th ph" aria-hidden="true">{(b.meta.provider ?? "링크").slice(0, 1)}</span>}
                    <span className="pcv-link-b">
                      <span className="pcv-link-t">{b.meta.title}</span>
                      <span className="pcv-link-d num">{b.meta.provider} · {b.meta.domain}</span>
                    </span>
                  </a>
                ) : (
                  <input className="pcv-url" defaultValue={b.url ?? ""} disabled={readOnly}
                    placeholder="https://figma.com/… 링크를 붙여넣으세요"
                    onBlur={(e) => unfurl(b.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                )
              )}

              {!readOnly && (
                <button className="pcv-bx" aria-label="블록 삭제" onClick={() => removeBlock(b.id)}>✕</button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
