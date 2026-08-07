"use client";

// 개인 메모 (MD-P-2026-025 §C) — 왼쪽 목록(38px 행) + 오른쪽 편집기.
//
// 편집기는 **문서형 업무 본문(DocEditor)을 그대로 재사용**한다.
// 자동저장 800ms 디바운스·baseUpdatedAt 낙관적 동시성까지 같은 코드다.
// 편집기를 포크하면 두 규칙이 갈라지고, 갈라진 쪽은 반드시 낡는다.
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import PageShell from "./PageShell";
import DocEditor from "./DocEditor";
import EmptyState from "./EmptyState";
import { toast } from "@/lib/quick";
import { openNewTaskPanel } from "@/lib/task-panel";

interface NoteRow {
  id: number;
  title: string;
  excerpt: string;
  updatedAt: string;
}

/** "08-06" / 올해가 아니면 "2025-12-31" — 목록 우측 끝의 수정일 */
function shortDate(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  const nowY = new Date().getFullYear();
  return d.getFullYear() === nowY
    ? `${p(d.getMonth() + 1)}-${p(d.getDate())}`
    : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function NotesView() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [openId, setOpenId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // 편집기에서 지금 무엇을 선택했는지 — "선택 → 업무" 는 선택이 있을 때만 뜬다
  const [selection, setSelection] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/notes").catch(() => null);
    if (!res || !res.ok) { setErr("메모를 불러올 수 없어요."); setLoading(false); return; }
    const d = await res.json();
    setNotes(d.notes ?? []);
    setErr("");
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // ⌘K 에서 메모를 고르면 /notes?note=N 으로 들어온다 — 그 메모를 연다.
  const wanted = useSearchParams().get("note");
  useEffect(() => {
    const n = Number(wanted);
    if (Number.isInteger(n) && n > 0) setOpenId(n);
  }, [wanted]);

  // 열려 있는 메모의 제목을 따로 읽는다 (본문은 DocEditor 가 직접 관리한다)
  useEffect(() => {
    if (openId === null) { setTitle(""); return; }
    fetch(`/api/notes/${openId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setTitle(d.note.title ?? ""))
      .catch(() => {});
  }, [openId]);

  // 본문에서 텍스트를 고르면 "선택 → 업무" 버튼이 뜬다 (§C)
  useEffect(() => {
    const on = () => setSelection(String(window.getSelection() ?? "").trim());
    document.addEventListener("selectionchange", on);
    return () => document.removeEventListener("selectionchange", on);
  }, []);

  async function create() {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/notes", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "" }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) { setErr("메모를 만들지 못했어요."); return; }
    const { id } = await res.json();
    await load();
    setOpenId(id);
  }

  async function saveTitle(next: string) {
    if (openId === null) return;
    const res = await fetch(`/api/notes/${openId}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    }).catch(() => null);
    if (res && res.ok) load();
  }

  async function remove(id: number) {
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res || !res.ok) { setErr("삭제하지 못했어요."); return; }
    if (openId === id) setOpenId(null);
    toast("메모를 삭제했어요");
    load();
  }

  /**
   * 선택 텍스트 → 업무 (§C).
   * 공개 범위 기본값은 **개인**이다 (C-2) — 메모에서 나온 것이니 개인이 자연스럽다.
   * 반대 방향(업무 → 메모)은 만들지 않는다.
   */
  function toTask() {
    const text = selection.trim();
    if (!text) return;
    openNewTaskPanel({ title: text.slice(0, 200), visibility: "private" });
  }

  const open = notes.find((n) => n.id === openId) ?? null;

  return (
    <PageShell
      crumb={["내 공간", "메모"]}
      title="메모"
      subtitle={<>나만 봅니다. 팀장도 볼 수 없어요. 공유가 필요하면 논의로 옮기세요.</>}
      actions={<button className="btn-primary" onClick={create} disabled={busy}>＋ 새 메모</button>}
    >
      {err && <p className="gerr">{err}</p>}

      {!loading && notes.length === 0 ? (
        // C-1 — 빈 상태 3요소 (아이콘 + 설명 + CTA). §G 규격의 EmptyState 를 그대로 쓴다.
        <EmptyState
          icon="notes"
          title="아직 메모가 없어요"
          hint="떠오른 생각·통화 내용·초안을 여기 적어두세요. 나만 볼 수 있고, 필요해지면 선택해서 업무로 만들 수 있어요."
          action={<button className="btn-primary" onClick={create} disabled={busy}>첫 메모 쓰기</button>}
        />
      ) : (
        <div className="nt">
          {/* 목록 — §C 목록 규격(38px 행 · 12.5px) */}
          <div className="nt-list dl">
            {loading && <div className="dl-row"><span className="dl-c">불러오는 중…</span></div>}
            {notes.map((n) => (
              <div key={n.id} className={`dl-row nt-row${n.id === openId ? " on" : ""}`}>
                <button className="nt-open" onClick={() => setOpenId(n.id)}>
                  <b>{n.title}</b>
                  {n.excerpt && <em>{n.excerpt}</em>}
                </button>
                <span className="nt-date num">{shortDate(n.updatedAt)}</span>
                <button className="nt-del" onClick={() => remove(n.id)} aria-label={`${n.title} 삭제`}>✕</button>
              </div>
            ))}
          </div>

          {/* 편집기 */}
          <div className="nt-edit">
            {open === null ? (
              <p className="tdp-muted">왼쪽에서 메모를 고르거나 새로 만드세요.</p>
            ) : (
              <>
                <div className="nt-head">
                  <input
                    className="tdp-title"
                    key={`nt-${open.id}`}
                    defaultValue={title}
                    placeholder="메모 제목"
                    onBlur={(e) => saveTitle(e.target.value)}
                  />
                  {/* 선택이 있을 때만 뜬다 — 늘 떠 있으면 무엇을 누르는지 모른다 */}
                  {selection && (
                    <button className="btn-ghost nt-totask" onClick={toTask}>
                      선택 → 업무
                    </button>
                  )}
                </div>
                <DocEditor taskId={open.id} endpoint={`/api/notes/${open.id}`} />
              </>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
