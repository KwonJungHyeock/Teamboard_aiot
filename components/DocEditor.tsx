"use client";

// 문서형 본문 에디터 (MD-P-2026-019 §F2) — 업무 상세의 주인공.
// 폼이 아니라 문서다. 블록 모델은 캔버스(project_canvas)와 같은 것을 쓰고,
// 링크 언퍼는 기존 /api/unfurl · InternalUnfurl 을 그대로 재사용한다.
//
// 되는 것: 슬래시 명령 · URL 붙여넣기 → 임베드 · 여러 줄 붙여넣기 → 문단 분리 ·
//          체크리스트 · @멘션/:이모지 자동완성 · 800ms 자동 저장 · 409 낙관적 동시성
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InternalUnfurl, { type InternalCard } from "./InternalUnfurl";
import { useAutocomplete } from "./autocomplete";
import { toast } from "@/lib/quick";
import { pgDate } from "@/lib/pgtime";
import { uploadImage } from "@/lib/upload";
import BlobImage from "./BlobImage";
import SectionEmpty from "./SectionEmpty";

export type DocBlockType = "text" | "heading" | "checklist" | "quote" | "code" | "divider" | "link" | "image";

export interface DocBlock {
  id: string;
  type: DocBlockType;
  text?: string;
  items?: { id: string; text: string; done: boolean }[];
  url?: string;
  meta?: { title?: string; provider?: string; domain?: string; thumbnail?: string | null } | null;
  internal?: InternalCard | null;
  /** 이미지 블록 (MD-P-2026-014a) — Private Blob 의 pathname. 공개 URL이 아니다. */
  pathname?: string;
  name?: string;
  size?: number;
  contentType?: string;
}

const uid = () => `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** 슬래시 명령 (§F2). 여기 없는 명령은 존재하지 않는다. */
const SLASH: { key: string; label: string; hint: string; make: () => DocBlock }[] = [
  { key: "heading", label: "제목", hint: "섹션 제목", make: () => ({ id: uid(), type: "heading", text: "" }) },
  { key: "check", label: "체크리스트", hint: "할 일 목록", make: () => ({ id: uid(), type: "checklist", items: [{ id: uid(), text: "", done: false }] }) },
  { key: "text", label: "글머리", hint: "문단", make: () => ({ id: uid(), type: "text", text: "" }) },
  { key: "divider", label: "구분선", hint: "가로선", make: () => ({ id: uid(), type: "divider" }) },
  { key: "quote", label: "인용", hint: "인용문", make: () => ({ id: uid(), type: "quote", text: "" }) },
  { key: "code", label: "코드", hint: "코드 블록", make: () => ({ id: uid(), type: "code", text: "" }) },
  { key: "image", label: "이미지", hint: "붙여넣기·드래그", make: () => ({ id: uid(), type: "image" }) },
  { key: "link", label: "링크 임베드", hint: "URL 카드", make: () => ({ id: uid(), type: "link", url: "" }) },
];

const URL_RE = /^https?:\/\/\S+$/i;

export default function DocEditor({ taskId, readOnly, onBlocks, endpoint }: {
  taskId: number;
  readOnly?: boolean;
  /** 현재 블록을 부모에 알린다 — §F3 연결된 리소스 자동 집계가 본문을 단일 소스로 쓰기 위함 */
  onBlocks?: (blocks: DocBlock[]) => void;
  /**
   * 저장 위치 (MD-P-2026-025 §C) — 기본은 업무 문서.
   * 개인 메모가 같은 편집기를 쓰되 `/api/notes/{id}` 로 저장한다.
   * 편집기를 포크하지 않는다 — 자동저장·낙관적 동시성 규칙을 두 벌 만들면 갈라진다.
   */
  endpoint?: string;
}) {
  const api = endpoint ?? `/api/tasks/${taskId}/doc`;
  const [blocks, setBlocks] = useState<DocBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<"idle" | "saving" | "saved" | "err">("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [blobReady, setBlobReady] = useState(false);
  const [slash, setSlash] = useState<{ blockId: string; q: string } | null>(null);
  const base = useRef<string | null>(null);
  const lastOk = useRef<DocBlock[]>([]);
  const blocksRef = useRef<DocBlock[]>([]);   // flushSave 가 최신 blocks 를 읽기 위한 참조
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 적재 ──
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(api)
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        const b: DocBlock[] = d.blocks ?? [];
        setBlocks(b);
        lastOk.current = b;
        base.current = d.updatedAt ?? null;
        setSavedAt(d.updatedAt ?? null);
        setBlobReady(!!d.blobReady);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [api]);

  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

  // 블록이 바뀔 때마다 부모에 통지 (§F3) — 삭제도 그대로 전달돼 리소스 섹션이 따라 줄어든다
  useEffect(() => { onBlocks?.(blocks); }, [blocks, onBlocks]);

  // ── 자동 저장 800ms (§F2) ──
  const schedule = useCallback((next: DocBlock[]) => {
    if (readOnly) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setSave("saving");
      const res = await fetch(api, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks: next, baseUpdatedAt: base.current }),
      }).catch(() => null);

      if (res && res.status === 409) {
        // 캔버스와 같은 규칙 — 조용히 덮어쓰지 않고 최신본을 다시 불러온다
        const latest = await fetch(api).then((r) => r.json()).catch(() => null);
        if (latest) {
          setBlocks(latest.blocks ?? []);
          lastOk.current = latest.blocks ?? [];
          base.current = latest.updatedAt ?? null;
          setSavedAt(latest.updatedAt ?? null);
        }
        setSave("idle");
        toast("다른 창에서 먼저 저장해 최신 내용을 불러왔어요", "err");
        return;
      }
      if (!res || !res.ok) {
        setSave("err");
        toast("저장에 실패했어요. 잠시 뒤 다시 시도합니다", "err", {
          label: "다시 시도", onClick: () => schedule(next),
        });
        return;
      }
      const d = await res.json();
      lastOk.current = d.blocks ?? next;
      base.current = d.updatedAt ?? null;
      setSavedAt(d.updatedAt ?? null);
      setSave("saved");
      setTimeout(() => setSave("idle"), 1600);
    }, 800);
  }, [api, readOnly]);

  const update = useCallback((next: DocBlock[]) => { setBlocks(next); schedule(next); }, [schedule]);

  /**
   * 즉시 저장 (디바운스 건너뜀) — 이미지 참조는 화면에 뜨기 전에 DB에 있어야 한다.
   * 읽기 권한이 "그 pathname 이 문서에 저장돼 있는가"로 판정되기 때문이다 (MD-P-2026-014a P1).
   */
  const flushSave = useCallback(async (next: DocBlock[]): Promise<boolean> => {
    if (readOnly) return false;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    setSave("saving");
    const res = await fetch(api, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocks: next, baseUpdatedAt: base.current }),
    }).catch(() => null);
    if (!res || !res.ok) { setSave("err"); return false; }
    const d = await res.json();
    lastOk.current = d.blocks ?? next;
    base.current = d.updatedAt ?? null;
    setSavedAt(d.updatedAt ?? null);
    setSave("saved");
    setTimeout(() => setSave("idle"), 1600);
    return true;
  }, [api, readOnly]);

  const patch = useCallback((id: string, p: Partial<DocBlock>) => {
    setBlocks((cur) => {
      const next = cur.map((b) => (b.id === id ? { ...b, ...p } : b));
      schedule(next);
      return next;
    });
  }, [schedule]);

  const addAfter = useCallback((id: string | null, b: DocBlock) => {
    setBlocks((cur) => {
      const i = id ? cur.findIndex((x) => x.id === id) : cur.length - 1;
      const next = [...cur.slice(0, i + 1), b, ...cur.slice(i + 1)];
      schedule(next);
      return next;
    });
  }, [schedule]);

  const remove = useCallback((id: string) => {
    setBlocks((cur) => { const next = cur.filter((b) => b.id !== id); schedule(next); return next; });
  }, [schedule]);

  // ── 링크 언퍼 (기존 API 재사용) ──
  const unfurl = useCallback(async (id: string, url: string) => {
    if (!URL_RE.test(url.trim())) return;
    const res = await fetch("/api/unfurl", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }),
    }).catch(() => null);
    const d = res && res.ok ? await res.json() : null;
    patch(id, { url: url.trim(), meta: d?.meta ?? null, internal: d?.internal ?? null });
  }, [patch]);

  // ── 이미지 업로드 (MD-P-2026-014 §A + 014a) — 서버 라우트 경유, pathname 만 저장 ──
  // 순서가 중요하다: 업로드 → **저장 완료** → 그 다음에 이미지를 그린다.
  const insertImage = useCallback(async (afterId: string | null, file: File) => {
    const ph: DocBlock = { id: uid(), type: "image", name: file.name };
    addAfter(afterId, ph);
    try {
      const up = await uploadImage(file, { kind: "task", id: taskId });
      const withPath = (cur: DocBlock[]) => cur.map((b) => (b.id === ph.id
        ? { ...b, pathname: up.pathname, name: up.name, size: up.size, contentType: up.contentType }
        : b));
      const saved = await flushSave(withPath(blocksRef.current));
      if (!saved) {
        remove(ph.id);
        toast("이미지를 저장하지 못했어요. 다시 시도해 주세요", "err");
        return;
      }
      setBlocks(withPath);
    } catch (err) {
      remove(ph.id);
      toast(err instanceof Error ? err.message : "이미지 업로드 실패", "err");
    }
  }, [addAfter, remove, taskId, flushSave]);

  // ── 붙여넣기 자동 인식 (§F2) ──
  const onPaste = useCallback((blockId: string, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    const files = Array.from(e.clipboardData.files ?? []);

    const img = files.find((f) => f.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      if (!blobReady) { toast("이미지 저장소가 연결되지 않았어요", "err"); return; }
      void insertImage(blockId, img);
      return;
    }
    if (!text) return;

    const trimmed = text.trim();
    if (URL_RE.test(trimmed) && !trimmed.includes("\n")) {
      // URL 한 줄 → 임베드 카드로
      e.preventDefault();
      const b: DocBlock = { id: uid(), type: "link", url: trimmed };
      addAfter(blockId, b);
      void unfurl(b.id, trimmed);
      return;
    }
    const lines = trimmed.split(/\n{2,}/).map((s) => s.trim()).filter(Boolean);
    if (lines.length > 1) {
      // 여러 문단 → 문단 분리
      e.preventDefault();
      setBlocks((cur) => {
        const i = cur.findIndex((x) => x.id === blockId);
        const made = lines.map((t) => ({ id: uid(), type: "text" as const, text: t }));
        const next = [...cur.slice(0, i + 1), ...made, ...cur.slice(i + 1)];
        schedule(next);
        return next;
      });
    }
  }, [addAfter, unfurl, blobReady, schedule, insertImage]);

  // ── 슬래시 명령 ──
  const slashHits = useMemo(() => {
    if (!slash) return [];
    const q = slash.q.toLowerCase();
    return SLASH.filter((s) => !q || s.label.includes(slash.q) || s.key.includes(q));
  }, [slash]);

  function runSlash(blockId: string, cmd: (typeof SLASH)[number]) {
    if (cmd.key === "image" && !blobReady) {
      toast("이미지 블록은 스토리지 연결 후 사용할 수 있어요", "err");
      setSlash(null);
      return;
    }
    // "/" 로 시작한 텍스트는 지우고 그 자리를 새 블록으로 바꾼다
    setBlocks((cur) => {
      const i = cur.findIndex((b) => b.id === blockId);
      const cleaned = cur[i]?.type === "text" && (cur[i].text ?? "").startsWith("/")
        ? cur.filter((_, n) => n !== i)
        : cur;
      const at = Math.max(0, cur[i]?.type === "text" && (cur[i].text ?? "").startsWith("/") ? i - 1 : i);
      const made = cmd.make();
      const next = [...cleaned.slice(0, at + 1), made, ...cleaned.slice(at + 1)];
      schedule(next);
      return next;
    });
    setSlash(null);
  }

  // pg 가 주는 "+00"(분 없음) 오프셋은 Date 가 못 읽는다 — 공용 pgDate() 로 정규화한다
  const savedDate = pgDate(savedAt);
  const savedLabel = savedDate
    ? savedDate.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })
    : null;

  if (loading) {
    return <div className="doc-skel" aria-hidden="true"><span /><span /><span /></div>;
  }

  return (
    <div className="doc">
      <div className="doc-bar">
        <span className={`doc-save ${save}`} role="status">
          {save === "saving" ? "저장 중…"
            : save === "err" ? "저장 실패 — 다시 시도합니다"
              : savedLabel ? `저장됨 ${savedLabel}` : "자동 저장됨"}
        </span>
        <span className="doc-hint">본문에서 <kbd>/</kbd> 를 누르면 블록을 넣을 수 있어요</span>
      </div>

      {blocks.length === 0 ? (
        <div className="doc-empty">
          <SectionEmpty
            text="여기에 진행 내용·자료조사·결정 근거를 적어두면 나중에 찾기 쉬워집니다"
            action={!readOnly ? { label: "첫 문단 쓰기 →", onClick: () => addAfter(null, { id: uid(), type: "text", text: "" }) } : undefined}
          />
        </div>
      ) : (
        <div className="doc-blocks">
          {blocks.map((b) => (
            <div className="doc-b" key={b.id} data-type={b.type}>
              {b.type === "divider" && <hr className="doc-hr" />}

              {(b.type === "text" || b.type === "heading" || b.type === "quote" || b.type === "code") && (
                <DocText
                  block={b}
                  readOnly={readOnly}
                  onChange={(text) => patch(b.id, { text })}
                  onPaste={(e) => onPaste(b.id, e)}
                  onSlash={(q) => setSlash(q === null ? null : { blockId: b.id, q })}
                  onEnter={() => addAfter(b.id, { id: uid(), type: "text", text: "" })}
                  slashOpen={slash?.blockId === b.id}
                  slashHits={slashHits}
                  onPick={(cmd) => runSlash(b.id, cmd)}
                />
              )}

              {b.type === "checklist" && (
                <div className="doc-check">
                  {(b.items ?? []).map((it) => (
                    <label className={`doc-ci${it.done ? " done" : ""}`} key={it.id}>
                      <input
                        type="checkbox" checked={it.done} disabled={readOnly}
                        onChange={(e) => patch(b.id, { items: (b.items ?? []).map((x) => x.id === it.id ? { ...x, done: e.target.checked } : x) })}
                      />
                      <input
                        className="doc-cit" value={it.text} disabled={readOnly} placeholder="할 일"
                        onChange={(e) => patch(b.id, { items: (b.items ?? []).map((x) => x.id === it.id ? { ...x, text: e.target.value } : x) })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            patch(b.id, { items: [...(b.items ?? []), { id: uid(), text: "", done: false }] });
                          }
                        }}
                      />
                      {!readOnly && (
                        <button className="doc-cix" aria-label="항목 삭제"
                          onClick={(e) => { e.preventDefault(); patch(b.id, { items: (b.items ?? []).filter((x) => x.id !== it.id) }); }}>✕</button>
                      )}
                    </label>
                  ))}
                  {!readOnly && (
                    <button className="doc-ciadd"
                      onClick={() => patch(b.id, { items: [...(b.items ?? []), { id: uid(), text: "", done: false }] })}>
                      ＋ 항목
                    </button>
                  )}
                </div>
              )}

              {b.type === "link" && b.internal && <InternalUnfurl card={b.internal} />}
              {b.type === "link" && !b.internal && (
                b.meta?.title ? (
                  <a className="doc-link" href={b.url} target="_blank" rel="noreferrer">
                    <span className="doc-link-t">{b.meta.title}</span>
                    <span className="doc-link-d num">{b.meta.provider} · {b.meta.domain}</span>
                  </a>
                ) : (
                  <input className="doc-url" defaultValue={b.url ?? ""} disabled={readOnly}
                    placeholder="https://… 링크를 붙여넣으세요"
                    onBlur={(e) => unfurl(b.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                )
              )}

              {b.type === "image" && (
                b.pathname
                  ? <BlobImage value={b.pathname} name={b.name} alt={b.name ?? "첨부 이미지"} className="doc-img" />
                  : <div className="doc-img-ph">
                      {blobReady ? "이미지 올리는 중…" : "이미지 저장소가 연결되지 않았습니다"}
                    </div>
              )}

              {!readOnly && (
                <button className="doc-bx" aria-label="블록 삭제" onClick={() => remove(b.id)}>✕</button>
              )}
            </div>
          ))}
          {!readOnly && (
            <button className="doc-add" onClick={() => addAfter(null, { id: uid(), type: "text", text: "" })}>
              ＋ 블록 추가 <span className="doc-add-k">또는 <kbd>/</kbd></span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** 텍스트 계열 블록 — @멘션·:이모지 자동완성은 기존 useAutocomplete 재사용 */
function DocText({
  block, readOnly, onChange, onPaste, onSlash, onEnter, slashOpen, slashHits, onPick,
}: {
  block: DocBlock;
  readOnly?: boolean;
  onChange: (v: string) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSlash: (q: string | null) => void;
  onEnter: () => void;
  slashOpen: boolean;
  slashHits: { key: string; label: string; hint: string }[];
  onPick: (cmd: never) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const value = block.text ?? "";
  const ac = useAutocomplete(value, onChange, ref);

  // 높이 자동 맞춤 — 문서처럼 보이게
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const ph = block.type === "heading" ? "섹션 제목"
    : block.type === "quote" ? "인용"
      : block.type === "code" ? "코드" : "여기에 적으세요. / 로 블록 추가";

  return (
    <div className="doc-tw">
      <textarea
        ref={ref}
        className={`doc-t doc-t-${block.type}`}
        rows={1}
        value={value}
        disabled={readOnly}
        placeholder={ph}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v);
          // "/" 로 시작하면 슬래시 메뉴
          onSlash(v.startsWith("/") ? v.slice(1) : null);
        }}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (ac.onKeyDown?.(e)) return;
          if (e.key === "Escape" && slashOpen) { e.preventDefault(); onSlash(null); return; }
          if (e.key === "Enter" && !e.shiftKey && !slashOpen && block.type !== "code") {
            e.preventDefault();
            onEnter();
          }
        }}
      />
      {ac.menu}
      {slashOpen && slashHits.length > 0 && (
        <div className="doc-slash" role="listbox" aria-label="블록 추가">
          {slashHits.map((s) => (
            <button key={s.key} role="option" aria-selected={false} onClick={() => onPick(s as never)}>
              <b>{s.label}</b>
              <em>{s.hint}</em>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
