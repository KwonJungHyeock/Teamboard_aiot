"use client";

// 리뷰 세션(회의모드) — 섹션별 이전/이후 비교 → 코멘트 → 확정/수정/보류 → 옵션 선정.
// 이미지: 붙여넣기(⌘/Ctrl+V)·드롭·파일 → Vercel Blob 업로드 후 URL 저장(미설정 시 URL 직접 입력).
// 확정(lead) → 논의·결정(signal) 레코드 자동 생성. 실시간 반영은 4초 폴링(허들룸 채널 재사용).
import { useCallback, useEffect, useRef, useState } from "react";
import type { SessionUser } from "@/lib/types";
import { AttachButton, DropZone } from "./Attach";
import { pfill } from "@/lib/progress-bar";

interface ReviewComment { id: number; author: string; body: string; createdAt: string }
interface Item {
  id: number; ord: number; name: string; beforeUrl: string | null; afterUrl: string | null;
  optionText: string; decision: "none" | "done" | "rev" | "hold"; signalId: number | null;
  comments: ReviewComment[];
}
interface Detail {
  id: number; title: string; status: "open" | "closed"; createdByName: string;
  items: Item[]; progress: { done: number; total: number };
}

async function uploadImage(file: File): Promise<string> {
  const res = await fetch(`/api/review/upload?t=${Date.now()}`, {
    method: "POST", headers: { "content-type": file.type }, body: file,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "업로드 실패");
  return data.url as string;
}

function ImageSlot({
  label, url, canEdit, onSet, onZoom,
}: {
  label: string; url: string | null; canEdit: boolean;
  onSet: (url: string | null) => void; onZoom: (url: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setBusy(true); setErr("");
    try { onSet(await uploadImage(file)); setErr(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "업로드 실패"); }
    finally { setBusy(false); }
  }, [onSet]);

  const onPaste = (e: React.ClipboardEvent) => {
    if (!canEdit) return;
    const img = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (img) { const f = img.getAsFile(); if (f) { e.preventDefault(); handleFile(f); return; } }
    const text = e.clipboardData.getData("text");
    if (/^https?:\/\//.test(text.trim())) { e.preventDefault(); onSet(text.trim()); }
  };
  const onDrop = (e: React.DragEvent) => {
    if (!canEdit) return;
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith("image/")) handleFile(f);
  };

  return (
    <div className="rv-slot">
      <div className="rv-slot-h">{label}</div>
      <DropZone onFile={handleFile} disabled={!canEdit}>
        <div
          className={`rv-drop${url ? " has" : ""}`}
          tabIndex={canEdit ? 0 : -1}
          onPaste={onPaste}
          onClick={() => url && onZoom(url)}
          role={url ? "button" : undefined}
          title={url ? "클릭하면 확대" : undefined}
        >
          {busy ? (
            // 업로드 중 = 정적 스켈레톤 (§B-2). "업로드 중…" 글자를 쓰지 않는다
            <span className="rv-drop-skel" role="status" aria-label="업로드 중" />
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={label} />
          ) : (
            <span className="rv-drop-hint">{canEdit ? "붙여넣기 · 드롭 · 파일" : "이미지 없음"}</span>
          )}
        </div>
      </DropZone>
      {canEdit && (
        <div className="rv-slot-a">
          <AttachButton onFile={handleFile} busy={busy} />
          {url && <button className="btn small" onClick={() => onSet(null)} disabled={busy}>지우기</button>}
        </div>
      )}
      {err && (
        <div className="atc atc-err" role="alert">
          <p>이미지를 올리지 못했어요.<em> {err}</em></p>
          <button className="err-retry" type="button" onClick={() => fileRef.current?.click()}>다시 시도</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/*" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

const DECISIONS: { key: Item["decision"]; label: string; cls: string }[] = [
  { key: "done", label: "확정", cls: "done" },
  { key: "rev", label: "수정", cls: "rev" },
  { key: "hold", label: "보류", cls: "hold" },
];

export default function ReviewSession({
  sessionId, user, onClose,
}: {
  sessionId: number; user: SessionUser; onClose: () => void;
}) {
  const isLead = user.role === "lead";
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [newItem, setNewItem] = useState("");
  const [drafts, setDrafts] = useState<Record<number, string>>({}); // 항목별 코멘트 입력

  const load = useCallback(async () => {
    const res = await fetch(`/api/review/${sessionId}`);
    const data = await res.json();
    if (!res.ok) { setErr(data.error ?? "불러오기 실패"); return; }
    setD(data); setErr("");
  }, [sessionId]);

  useEffect(() => {
    load();
    document.body.classList.add("meeting-on");
    const t = setInterval(load, 4000);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (zoom) setZoom(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => { clearInterval(t); window.removeEventListener("keydown", onKey); document.body.classList.remove("meeting-on"); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  async function patchItem(itemId: number, fields: Record<string, unknown>) {
    const res = await fetch(`/api/review/items/${itemId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    if (!res.ok) { setErr((await res.json()).error ?? "저장 실패"); return; }
    load();
  }
  async function setDecision(item: Item, key: Item["decision"]) {
    if (key === "done") {
      const res = await fetch(`/api/review/items/${item.id}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "promote" }),
      });
      if (!res.ok) { setErr((await res.json()).error ?? "확정 실패"); return; }
    } else {
      await patchItem(item.id, { decision: key });
      return;
    }
    load();
  }
  async function postComment(itemId: number) {
    const body = (drafts[itemId] ?? "").trim();
    if (!body) return;
    const res = await fetch(`/api/review/items/${itemId}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }),
    });
    if (!res.ok) { setErr((await res.json()).error ?? "코멘트 실패"); return; }
    setDrafts((p) => ({ ...p, [itemId]: "" }));
    load();
  }
  async function addItem() {
    const name = newItem.trim();
    if (!name) return;
    const res = await fetch(`/api/review/${sessionId}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    if (!res.ok) { setErr((await res.json()).error ?? "추가 실패"); return; }
    setNewItem(""); load();
  }
  async function delItem(itemId: number) {
    const res = await fetch(`/api/review/items/${itemId}`, { method: "DELETE" });
    if (res.ok) load();
  }

  const pct = d && d.progress.total > 0 ? Math.round((d.progress.done / d.progress.total) * 100) : 0;

  return (
    <div className="rv">
      <div className="rv-top">
        <div className="rv-title">
          <span className="rv-badge">리뷰 세션</span>
          <b>{d?.title ?? "불러오는 중…"}</b>
          {d && <span className="rv-st">확정 {d.progress.done}/{d.progress.total}</span>}
        </div>
        <div className="rv-prog"><i style={pfill(pct)} /></div>
        <button className="btn" onClick={onClose}>세션 종료</button>
      </div>

      {err && <div className="rv-errbar">{err}</div>}

      <div className="rv-body">
        {d?.items.map((it) => (
          <section key={it.id} className={`rv-item dec-${it.decision}`}>
            <div className="rv-item-h">
              <span className="rv-ord">{it.ord + 1}</span>
              <b className="rv-name">{it.name}</b>
              <span className="rv-sp" />
              {/* 결정 세그먼트 — lead만 변경 */}
              <div className="rv-seg" role="group" aria-label="결정">
                {DECISIONS.map((opt) => (
                  <button
                    key={opt.key}
                    className={`rv-seg-b ${opt.cls}${it.decision === opt.key ? " on" : ""}`}
                    aria-pressed={it.decision === opt.key}
                    disabled={!isLead || (it.decision === "done" && opt.key !== "done")}
                    onClick={() => setDecision(it, opt.key)}
                    title={!isLead ? "확정/변경은 팀장 전용" : undefined}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {isLead && it.decision !== "done" && (
                <button className="rv-del" onClick={() => delItem(it.id)} title="항목 삭제" aria-label="항목 삭제">✕</button>
              )}
            </div>

            <div className="rv-slots">
              <ImageSlot label="이전" url={it.beforeUrl} canEdit onSet={(u) => patchItem(it.id, { beforeUrl: u })} onZoom={setZoom} />
              <ImageSlot label="이후" url={it.afterUrl} canEdit onSet={(u) => patchItem(it.id, { afterUrl: u })} onZoom={setZoom} />
            </div>

            <div className="rv-opt">
              <label>선정 옵션</label>
              <input
                defaultValue={it.optionText}
                key={`o-${it.id}-${it.optionText}`}
                placeholder="이 항목에서 선정한 옵션을 적으세요"
                onBlur={(e) => { if (e.target.value !== it.optionText) patchItem(it.id, { optionText: e.target.value }); }}
              />
            </div>

            <div className="rv-cmts">
              {it.comments.map((c) => (
                <div key={c.id} className="rv-cmt"><b>{c.author}</b><span>{c.body}</span></div>
              ))}
              <div className="rv-cmt-in">
                <input
                  placeholder="코멘트·의견 (전원)"
                  value={drafts[it.id] ?? ""}
                  onChange={(e) => setDrafts((p) => ({ ...p, [it.id]: e.target.value }))}
                  onKeyDown={(e) => e.key === "Enter" && postComment(it.id)}
                />
                <button className="btn small" onClick={() => postComment(it.id)}>등록</button>
              </div>
            </div>

            {it.signalId && <div className="rv-linked">✅ 확정 · 논의·결정에 결정 레코드 생성됨</div>}
          </section>
        ))}

        {/* 항목 추가 — lead */}
        {isLead && d && (
          <div className="rv-add">
            <input placeholder="안건(섹션) 추가" value={newItem}
              onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addItem()} />
            <button className="btn small primary" onClick={addItem}>＋ 안건 추가</button>
          </div>
        )}
      </div>

      {zoom && (
        <div className="rv-zoom" onClick={() => setZoom(null)} role="dialog" aria-label="이미지 확대">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="확대" />
        </div>
      )}
    </div>
  );
}
