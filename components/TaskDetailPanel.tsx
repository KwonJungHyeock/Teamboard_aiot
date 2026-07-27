"use client";

// 업무 상세 슬라이드 패널 (파트 1) — 우측 480px 슬라이드. AppShell에 1개만 마운트되어
// 어느 화면에서든 openTaskPanel(id) 로 열린다. 필드 이탈/변경 시 인라인 자동저장(PATCH).
// URL ?task=id 반영 → 새로고침에도 유지. ESC·바깥 클릭으로 닫힘.
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { uploadImage } from "@/lib/upload";
import {
  TASK_PANEL_EVENT,
  currentTaskRef,
  closeTaskPanel,
  notifyTaskUpdated,
  openTaskPanel,
  type NewTaskPrefill,
} from "@/lib/task-panel";

interface TaskDetail {
  id: number; title: string; description: string; status: string; priority: string;
  origin: string; workType: string; areaId: number; areaName: string; areaColor: string | null;
  projectId: number | null; projectName: string | null; colorKey: string | null;
  assigneeId: number | null; assigneeName: string | null; createdByName: string | null;
  startDate: string | null; dueDate: string | null; dropReason: string | null; goalIds: number[];
  progress: number;
}
interface Selectors {
  actors: { id: number; name: string }[];
  projects: { id: number; name: string; colorKey: string | null; areaId: number }[];
  areas: { id: number; name: string; colorKey: string | null }[];
  monthGoals: { id: number; title: string; month: string }[];
}
interface Cmt { id: number; body: string; created_at: string; author_name: string }
interface Act { id: number; message: string; level: string; created_at: string; user_name: string | null }

const STATUS = [["todo", "대기"], ["doing", "진행"], ["review", "리뷰"], ["done", "완료"]] as const;
const PRIORITY = [["high", "높음"], ["mid", "보통"], ["low", "낮음"]] as const;
const WORKTYPE = [["team", "팀업무"], ["personal", "개인업무"], ["routine", "상시업무"]] as const;

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface Draft {
  title: string; areaId: number; projectId: number; assigneeId: number;
  priority: string; workType: string; startDate: string; dueDate: string; description: string;
}

export default function TaskDetailPanel() {
  const [openId, setOpenId] = useState<number | "new" | null>(null);
  const [prefill, setPrefill] = useState<NewTaskPrefill>({});
  const [draft, setDraft] = useState<Draft | null>(null);
  const [creating, setCreating] = useState(false);
  const [t, setT] = useState<TaskDetail | null>(null);
  const [sel, setSel] = useState<Selectors | null>(null);
  const [comments, setComments] = useState<Cmt[]>([]);
  const [activity, setActivity] = useState<Act[]>([]);
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState("");
  const [newComment, setNewComment] = useState("");
  const [dropping, setDropping] = useState(false);
  const [dropReason, setDropReason] = useState("");
  const [descText, setDescText] = useState("");   // 설명(마크다운) 편집 버퍼 — 미리보기 동기화
  const [prog, setProg] = useState(0);             // 진행률 슬라이더 로컬 상태
  const [uploading, setUploading] = useState(false);
  const descRef = useRef<HTMLTextAreaElement>(null);

  // ── 열림 상태 소스: URL ?task + 이벤트 + 뒤로가기 ──
  useEffect(() => {
    const sync = () => setOpenId(currentTaskRef());
    sync();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object" && detail.mode === "new") {
        setPrefill(detail.prefill ?? {});
        setOpenId("new");
      } else {
        setOpenId(typeof detail === "number" ? detail : detail === null ? null : currentTaskRef());
      }
    };
    window.addEventListener(TASK_PANEL_EVENT, onEvent);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(TASK_PANEL_EVENT, onEvent);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    const res = await fetch(`/api/tasks/${id}`);
    if (!res.ok) { setErr("업무를 불러올 수 없습니다."); return; }
    const data = await res.json();
    setT(data.task);
    setDescText(data.task.description ?? "");
    setProg(data.task.progress ?? 0);
    setActivity(data.activity ?? []);
  }, []);
  const loadComments = useCallback(async (id: number) => {
    const res = await fetch(`/api/tasks/${id}/comments`);
    if (res.ok) setComments((await res.json()).comments ?? []);
  }, []);

  useEffect(() => {
    if (openId == null) { setT(null); setErr(""); return; }
    setErr(""); setDropping(false); setDropReason("");
    if (!sel) fetch("/api/meta/selectors").then((r) => r.json()).then(setSel).catch(() => {});
    if (openId === "new") { setT(null); return; }
    loadDetail(openId);
    loadComments(openId);
  }, [openId, loadDetail, loadComments, sel]);

  // 새 업무 초안 초기화 (진입 시 1회) + 영역 기본값은 selectors 도착 후 채움
  useEffect(() => {
    if (openId === "new") {
      setDraft((d) =>
        d ?? {
          title: "", areaId: prefill.areaId ?? 0, projectId: prefill.projectId ?? 0,
          assigneeId: prefill.assigneeId ?? 0, priority: "mid",
          workType: prefill.workType ?? "team",
          startDate: prefill.startDate ?? "", dueDate: prefill.dueDate ?? "", description: "",
        }
      );
    } else {
      setDraft(null);
      setCreating(false);
    }
  }, [openId, prefill]);
  useEffect(() => {
    if (openId === "new" && sel && draft && !draft.areaId) {
      setDraft({ ...draft, areaId: sel.areas[0]?.id ?? 0 });
    }
  }, [openId, sel, draft]);

  async function createTask() {
    if (!draft || !draft.title.trim()) { setErr("제목을 입력하세요."); return; }
    setCreating(true); setErr("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title.trim(),
        areaId: draft.areaId || undefined,
        projectId: draft.projectId || undefined,
        assigneeId: draft.assigneeId || undefined,
        workType: draft.workType,
        priority: draft.priority,
        startDate: draft.startDate || undefined,
        dueDate: draft.dueDate || undefined,
        description: draft.description,
      }),
    });
    setCreating(false);
    if (!res.ok) { setErr((await res.json()).error ?? "생성 실패"); return; }
    const { id } = await res.json();
    notifyTaskUpdated();
    openTaskPanel(id); // 생성된 업무 상세로 전환
  }

  // ESC 닫기
  useEffect(() => {
    if (openId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeTaskPanel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId]);

  async function patch(fields: Record<string, unknown>) {
    if (typeof openId !== "number") return;
    setSave("saving"); setErr("");
    const res = await fetch(`/api/tasks/${openId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      setErr((await res.json()).error ?? "저장 실패");
      setSave("idle");
      await loadDetail(openId); // 서버 상태로 되돌림
      return false;
    }
    setSave("saved");
    setTimeout(() => setSave("idle"), 1200);
    await loadDetail(openId);
    notifyTaskUpdated();
    return true;
  }

  async function addComment() {
    if (typeof openId !== "number" || !newComment.trim()) return;
    const res = await fetch(`/api/tasks/${openId}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: newComment.trim() }),
    });
    if (res.ok) {
      setNewComment("");
      await loadComments(openId);
      await loadDetail(openId); // 활동 타임라인 갱신
    } else setErr((await res.json()).error ?? "코멘트 실패");
  }

  // 이미지 업로드(붙여넣기/드롭/파일) → Blob URL → 마크다운 ![](url) 삽입 (파트 3)
  async function insertUpload(file: File, into: "desc" | "comment") {
    setUploading(true); setErr("");
    try {
      const url = await uploadImage(file);
      const md = `![](${url})`;
      if (into === "desc") {
        const next = descText ? `${descText}\n${md}` : md;
        setDescText(next);
        await patch({ description: next });
      } else {
        setNewComment((c) => (c ? `${c} ${md}` : md));
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "이미지 업로드 실패");
    } finally {
      setUploading(false);
    }
  }
  function pasteImage(e: React.ClipboardEvent, into: "desc" | "comment") {
    const img = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (img) {
      const f = img.getAsFile();
      if (f) { e.preventDefault(); insertUpload(f, into); }
    }
  }
  function dropImage(e: React.DragEvent, into: "desc" | "comment") {
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith("image/")) { e.preventDefault(); insertUpload(f, into); }
  }

  async function softDelete() {
    if (typeof openId !== "number") return;
    if (!window.confirm("이 업무를 삭제할까요? (소프트 삭제)")) return;
    const res = await fetch(`/api/tasks/${openId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: false }),
    });
    if (res.ok) { notifyTaskUpdated(); closeTaskPanel(); }
    else setErr((await res.json()).error ?? "삭제 실패");
  }

  if (openId == null) return null;
  const areaProjects = sel?.projects.filter((p) => p.areaId === (t?.areaId ?? -1)) ?? [];

  return (
    <>
      <div className="tdp-backdrop" onClick={() => closeTaskPanel()} />
      <aside className="tdp" role="dialog" aria-label="업무 상세">
        <div className="tdp-head">
          <span className="tdp-crumb">
            {openId === "new" ? "새 업무" : `업무 상세 ${t ? `· #${t.id}` : ""}`}
          </span>
          <span className={`tdp-save ${save}`}>
            {save === "saving" ? "저장 중…" : save === "saved" ? "저장됨" : ""}
          </span>
          <button className="tdp-x" onClick={() => closeTaskPanel()} aria-label="닫기">✕</button>
        </div>

        {/* ── 새 업무(빈 상태) — 파트 4 ── */}
        {openId === "new" && draft && (
          <div className="tdp-body">
            {err && <p className="tdp-err">{err}</p>}
            <input
              className="tdp-title"
              autoFocus
              placeholder="새 업무 제목"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") createTask(); }}
            />
            <div className="tdp-grid">
              <label>영역
                <select value={draft.areaId} onChange={(e) => setDraft({ ...draft, areaId: Number(e.target.value), projectId: 0 })}>
                  {sel?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>업무유형
                <select value={draft.workType} onChange={(e) => setDraft({ ...draft, workType: e.target.value })}>
                  {WORKTYPE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>프로젝트
                <select value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: Number(e.target.value) })}>
                  <option value={0}>없음</option>
                  {sel?.projects.filter((p) => p.areaId === draft.areaId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>담당
                <select value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: Number(e.target.value) })}>
                  <option value={0}>미지정</option>
                  {sel?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>우선순위
                <select value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>
                  {PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>시작일
                <input type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value })} />
              </label>
              <label>마감일
                <input type="date" value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
              </label>
            </div>
            <div className="tdp-sec">
              <div className="tdp-sec-h">설명 <em>(선택)</em></div>
              <textarea className="tdp-desc" rows={4} value={draft.description}
                placeholder="업무 설명을 입력하세요…"
                onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
            <p className="tdp-muted">만든 뒤 상세 화면에서 목표 연결·코멘트를 추가할 수 있습니다.</p>
          </div>
        )}

        {openId !== "new" && !t && !err && <div className="tdp-body"><p className="tdp-muted">불러오는 중…</p></div>}
        {openId !== "new" && err && !t && <div className="tdp-body"><p className="tdp-err">{err}</p></div>}

        {t && (
          <div className="tdp-body">
            {err && <p className="tdp-err">{err}</p>}

            {/* 제목 (인라인) */}
            <input
              className="tdp-title"
              defaultValue={t.title}
              key={`title-${t.id}`}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value !== t.title) patch({ title: e.target.value.trim() }); }}
            />
            {t.origin === "agent" && <span className="tdp-tag agent">에이전트 제안</span>}

            {/* 속성 그리드 */}
            <div className="tdp-grid">
              <label>영역
                <select value={t.areaId} onChange={(e) => patch({ areaId: Number(e.target.value) })}>
                  {sel?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>업무유형
                <select value={t.workType} onChange={(e) => patch({ workType: e.target.value })}>
                  {WORKTYPE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>프로젝트
                <select value={t.projectId ?? 0} onChange={(e) => patch({ projectId: Number(e.target.value) || null })}>
                  <option value={0}>없음</option>
                  {areaProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
              <label>담당
                <select value={t.assigneeId ?? 0} onChange={(e) => patch({ assigneeId: Number(e.target.value) || null })}>
                  <option value={0}>미지정</option>
                  {sel?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>우선순위
                <select value={t.priority} onChange={(e) => patch({ priority: e.target.value })}>
                  {PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>상태
                <select
                  value={STATUS.some(([v]) => v === t.status) ? t.status : ""}
                  onChange={(e) => patch({ status: e.target.value })}
                >
                  {!STATUS.some(([v]) => v === t.status) && <option value="">{t.status}</option>}
                  {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label>시작일
                <input type="date" defaultValue={t.startDate ?? ""} key={`sd-${t.id}-${t.startDate}`}
                  onChange={(e) => patch({ startDate: e.target.value || null })} />
              </label>
              <label>마감일
                <input type="date" defaultValue={t.dueDate ?? ""} key={`dd-${t.id}-${t.dueDate}`}
                  onChange={(e) => patch({ dueDate: e.target.value || null })} />
              </label>
            </div>

            {/* 진행률 (수동, 0~100) — 파트 4 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">진행률 <em>{prog}%</em></div>
              <div className="tdp-prog">
                <input
                  type="range" min={0} max={100} step={5} value={prog}
                  className="tdp-range"
                  onChange={(e) => setProg(Number(e.target.value))}
                  onMouseUp={() => prog !== t.progress && patch({ progress: prog })}
                  onKeyUp={() => prog !== t.progress && patch({ progress: prog })}
                  onTouchEnd={() => prog !== t.progress && patch({ progress: prog })}
                  aria-label="진행률"
                />
                <input
                  type="number" min={0} max={100} value={prog}
                  className="tdp-prog-n"
                  onChange={(e) => setProg(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                  onBlur={() => prog !== t.progress && patch({ progress: prog })}
                  aria-label="진행률 입력"
                />
              </div>
              <div className="tdp-prog-bar"><i style={{ width: `${prog}%` }} className={`pf-${t.status === "done" ? "green" : "blue"}`} /></div>
            </div>

            {/* 연결 목표 (다중) */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">연결 목표</div>
              <div className="tdp-goals">
                {(sel?.monthGoals.length ?? 0) === 0 && <p className="tdp-muted">연결 가능한 월 목표가 없습니다.</p>}
                {sel?.monthGoals.map((g) => (
                  <label key={g.id} className="tdp-goal">
                    <input type="checkbox" checked={t.goalIds.includes(g.id)}
                      onChange={(e) => {
                        const next = e.target.checked ? [...t.goalIds, g.id] : t.goalIds.filter((x) => x !== g.id);
                        patch({ goalIds: next });
                      }} />
                    {g.title} <em>{g.month}</em>
                  </label>
                ))}
              </div>
            </div>

            {/* 설명 (마크다운 · 이미지 붙여넣기/드롭) — 파트 3 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">설명 <em>(마크다운 · 이미지 붙여넣기/드롭)</em></div>
              <textarea
                ref={descRef}
                className="tdp-desc" rows={4} value={descText}
                placeholder="업무 설명… 이미지를 붙여넣거나 끌어다 놓으면 인라인 삽입됩니다."
                onChange={(e) => setDescText(e.target.value)}
                onBlur={() => { if (descText !== t.description) patch({ description: descText }); }}
                onPaste={(e) => pasteImage(e, "desc")}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => dropImage(e, "desc")}
              />
              {uploading && <p className="tdp-muted">이미지 업로드 중…</p>}
              {descText.trim() && (
                <div className="tdp-preview">
                  <div className="tdp-preview-h">미리보기</div>
                  <Markdown text={descText} />
                </div>
              )}
            </div>

            {/* 활동 타임라인 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">활동 타임라인</div>
              {activity.length === 0 && <p className="tdp-muted">기록된 활동이 없습니다.</p>}
              {activity.map((a) => (
                <div className="tdp-act" key={a.id}>
                  <span className="tdp-act-t">{fmt(a.created_at)}</span>
                  <span className={`tdp-act-m lv-${a.level}`}>{a.message}</span>
                </div>
              ))}
            </div>

            {/* 코멘트 */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">코멘트 <em>({comments.length})</em></div>
              {comments.map((c) => (
                <div className="tdp-cmt" key={c.id}>
                  <b>{c.author_name}</b> <span className="tdp-act-t">{fmt(c.created_at)}</span>
                  <Markdown className="tdp-cmt-body" text={c.body} />
                </div>
              ))}
              <div className="tdp-cmt-new">
                <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
                  placeholder="코멘트… 이미지 붙여넣기 가능" onKeyDown={(e) => e.key === "Enter" && addComment()}
                  onPaste={(e) => pasteImage(e, "comment")} />
                <button className="btn small primary" onClick={addComment} disabled={!newComment.trim()}>등록</button>
              </div>
            </div>
          </div>
        )}

        {openId === "new" && (
          <div className="tdp-foot">
            <button className="btn small primary" disabled={creating || !draft?.title.trim()} onClick={createTask}>
              {creating ? "만드는 중…" : "만들기"}
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn small ghost" onClick={() => closeTaskPanel()}>취소</button>
          </div>
        )}

        {t && (
          <div className="tdp-foot">
            {t.status !== "done" && (
              <button className="btn small" onClick={() => patch({ status: "done" })}>완료 처리</button>
            )}
            {!dropping ? (
              t.status !== "dropped" && (
                <button className="btn small" onClick={() => setDropping(true)}>중단</button>
              )
            ) : (
              <span className="tdp-drop">
                <input placeholder="중단 사유(필수)" value={dropReason} onChange={(e) => setDropReason(e.target.value)} />
                <button className="btn small primary" disabled={!dropReason.trim()}
                  onClick={async () => { if (await patch({ status: "dropped", dropReason: dropReason.trim() })) setDropping(false); }}>확정</button>
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn small ghost" onClick={softDelete}>삭제</button>
          </div>
        )}
      </aside>
    </>
  );
}
