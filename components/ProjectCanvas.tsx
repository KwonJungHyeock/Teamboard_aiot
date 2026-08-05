"use client";

// 프로젝트 캔버스 (MD-P-2026-005 §C) — 과정 기록의 본체.
// 블록: 텍스트(마크다운) · 체크리스트 · 링크(언퍼 카드) · 이미지(Private Blob, MD-P-2026-014a).
// 인라인 편집 + 자동저장(디바운스 800ms) + "○○님이 방금 수정" 표시. 실패 시 롤백 + 토스트.
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { useAutocomplete } from "./autocomplete";
import InternalUnfurl, { type InternalCard } from "./InternalUnfurl";
import { toast } from "@/lib/quick";
import { openPanel } from "@/lib/side-panel";
import { openTaskPanel } from "@/lib/task-panel";
import { useRouter } from "next/navigation";
import { uploadImage } from "@/lib/upload";
import BlobImage from "./BlobImage";

type BlockType = "text" | "checklist" | "link" | "image";
interface CheckItem { id: string; text: string; done: boolean }
interface Block {
  id: string;
  type: BlockType;
  text?: string;
  items?: CheckItem[];
  url?: string;
  meta?: { title?: string; domain?: string; thumbnail?: string; provider?: string };
  /** 내부 링크 언퍼 (MD-P-2026-006 §E) — 업무·결정·프로젝트는 상태 칩·담당·진척%까지 보여준다. */
  internal?: InternalCard;
  /** 이미지 블록 (MD-P-2026-014a) — Private Blob 의 pathname. 공개 URL이 아니다. */
  pathname?: string;
  name?: string;
  size?: number;
  contentType?: string;
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
  const [blobReady, setBlobReady] = useState(false);
  const lastSaved = useRef<Block[]>([]);
  const blocksRef = useRef<Block[]>([]);   // flushSave 가 최신 blocks 를 읽기 위한 참조
  const baseUpdatedAt = useRef<string | null>(null);   // 동시 편집 감지 기준 시각
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/projects/${projectId}/canvas`).then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const b = d.blocks ?? [];
        setBlocks(b); lastSaved.current = b;
        baseUpdatedAt.current = d.updatedAt ?? null;
        setBlobReady(!!d.blobReady);
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
        // 내가 불러온 시점을 함께 보낸다 — 그 사이 다른 창이 저장했으면 서버가 409로 막는다
        body: JSON.stringify({ blocks: next, baseUpdatedAt: baseUpdatedAt.current }),
      }).catch(() => null);
      if (res && res.status === 409) {
        // 조용한 덮어쓰기 대신 최신본을 다시 불러온다. 내 편집은 버리지 않고 알린다.
        const latest = await fetch(`/api/projects/${projectId}/canvas`).then((r) => r.json()).catch(() => null);
        if (latest) {
          setBlocks(latest.blocks ?? []);
          lastSaved.current = latest.blocks ?? [];
          baseUpdatedAt.current = latest.updatedAt ?? null;
          setMeta({ updatedAt: latest.updatedAt ?? null, updatedByName: latest.updatedByName ?? null });
        }
        setSaving("idle");
        toast("다른 창에서 먼저 저장해 최신 내용을 불러왔어요", "err");
        return;
      }
      if (!res || !res.ok) {
        setBlocks(lastSaved.current);
        setSaving("idle");
        toast("캔버스 저장에 실패해 되돌렸어요", "err");
        return;
      }
      const d = await res.json();
      lastSaved.current = d.blocks ?? next;
      baseUpdatedAt.current = d.updatedAt ?? null;
      setMeta({ updatedAt: d.updatedAt ?? null, updatedByName: d.updatedByName ?? null });
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 1600);
    }, 800);
  }, [projectId, readOnly]);

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

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

  /**
   * 즉시 저장 (디바운스 건너뜀).
   * 이미지 읽기 권한은 "그 pathname 이 캔버스에 저장돼 있는가"로 판정된다.
   * 그래서 이미지 블록은 화면에 뜨기 전에 반드시 DB에 있어야 한다.
   * 800ms 디바운스를 그대로 타면 <img> 가 먼저 요청을 보내 404 를 받는다 (MD-P-2026-014a P1).
   */
  const flushSave = useCallback(async (next: Block[]): Promise<boolean> => {
    if (readOnly) return false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSaving("saving");
    const res = await fetch(`/api/projects/${projectId}/canvas`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: next, baseUpdatedAt: baseUpdatedAt.current }),
    }).catch(() => null);
    if (!res || !res.ok) { setSaving("idle"); return false; }
    const d = await res.json();
    lastSaved.current = d.blocks ?? next;
    baseUpdatedAt.current = d.updatedAt ?? null;
    setMeta({ updatedAt: d.updatedAt ?? null, updatedByName: d.updatedByName ?? null });
    setSaving("saved");
    setTimeout(() => setSaving("idle"), 1600);
    return true;
  }, [projectId, readOnly]);

  // 이미지 업로드 (MD-P-2026-014 §A + 014a) — 서버 라우트 경유, pathname 만 저장한다.
  // 순서가 중요하다: 업로드 → **저장 완료** → 그 다음에 이미지를 그린다.
  async function insertImage(file: File) {
    if (readOnly) return;
    if (!blobReady) { toast("이미지 저장소가 연결되지 않았어요", "err"); return; }
    const ph: Block = { id: uid(), type: "image", name: file.name };
    setBlocks((cur) => [...cur, ph]);
    try {
      const up = await uploadImage(file, { kind: "project", id: projectId });
      const withPath = (cur: Block[]) => cur.map((b) => (b.id === ph.id
        ? { ...b, pathname: up.pathname, name: up.name, size: up.size, contentType: up.contentType }
        : b));
      // 현재 상태를 읽어 저장본을 만든 뒤, 저장이 끝난 다음에만 pathname 을 화면에 반영한다.
      const target = withPath(blocksRef.current);
      const saved = await flushSave(target);
      if (!saved) {
        setBlocks((cur) => cur.filter((b) => b.id !== ph.id));
        toast("이미지를 저장하지 못했어요. 다시 시도해 주세요", "err");
        return;
      }
      setBlocks(withPath);
    } catch (e) {
      setBlocks((cur) => cur.filter((b) => b.id !== ph.id));
      toast(e instanceof Error ? e.message : "이미지 업로드 실패", "err");
    }
  }
  function pickImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.onchange = () => { const f = input.files?.[0]; if (f) void insertImage(f); };
    input.click();
  }

  // 링크 블록 — URL 확정 시 언퍼 조회
  async function unfurl(id: string, url: string) {
    if (!url.trim()) return;
    patchBlock(id, { url });
    // Notion 링크는 캔버스에서 붙여넣어도 "연결된 리소스"에 등록한다 (MD-P-2026-012 §C)
    if (/notion\.(so|site)/.test(url)) {
      fetch("/api/links", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "project", entityId: projectId, url }),
      }).catch(() => {});
    }
    const res = await fetch("/api/unfurl", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }),
    }).catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      // 최신 상태 기준으로 갱신(디바운스 중 다른 편집과 충돌 방지)
      setBlocks((cur) => {
        const next = cur.map((b) => (b.id === id ? { ...b, url, meta: d.meta, internal: d.internal } : b));
        scheduleSave(next);
        return next;
      });
    }
    // 실패(4xx/5xx) 시에는 아무것도 덮어쓰지 않는다 — 원본 링크 텍스트가 그대로 남는다.
  }

  if (loading) return <p className="gempty">불러오는 중...</p>;

  return (
    <section
      className="card pcanvas"
      aria-label="프로젝트 캔버스"
      onPaste={(e) => {
        const f = Array.from(e.clipboardData.files ?? []).find((x) => x.type.startsWith("image/"));
        if (f) { e.preventDefault(); void insertImage(f); }
      }}
      onDragOver={(e) => { if (!readOnly && blobReady) e.preventDefault(); }}
      onDrop={(e) => {
        const f = Array.from(e.dataTransfer.files ?? []).find((x) => x.type.startsWith("image/"));
        if (f) { e.preventDefault(); void insertImage(f); }
      }}
    >
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
            <button
              className={blobReady ? "" : "off"}
              disabled={!blobReady}
              title={blobReady ? "png · jpg · webp · gif · 10MB 이하" : "이미지 저장소가 연결되지 않았습니다"}
              onClick={pickImage}
            >＋ 이미지</button>
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
                  : <CanvasText value={b.text ?? ""} onChange={(v) => patchBlock(b.id, { text: v })} />
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

              {b.type === "image" && (
                b.pathname
                  ? <BlobImage value={b.pathname} name={b.name} alt={b.name ?? "첨부 이미지"} className="pcv-img" />
                  : <div className="pcv-img-ph">이미지 올리는 중…</div>
              )}

              {b.type === "link" && b.internal && (
                <InternalUnfurl card={b.internal} />
              )}
              {b.type === "link" && !b.internal && (
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

/** 캔버스 텍스트 블록 — 컴포저·코멘트와 같은 자동완성(@ · : · #)을 쓴다 (§D). */
function CanvasText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const ac = useAutocomplete(value, onChange, ref);
  return (
    <div className="pcv-text-wrap">
      <textarea
        ref={ref}
        className="pcv-text"
        value={value}
        rows={Math.max(2, value.split("\n").length)}
        placeholder="메모·설계 노트… (마크다운 · @사람 · #프로젝트 · :이모지)"
        onChange={(e) => { onChange(e.target.value); setTimeout(ac.sync, 0); }}
        onClick={ac.sync}
        onKeyUp={(e) => { if (e.key.startsWith("Arrow")) ac.sync(); }}
        onKeyDown={(e) => { ac.onKeyDown(e); }}
      />
      {ac.menu}
    </div>
  );
}

