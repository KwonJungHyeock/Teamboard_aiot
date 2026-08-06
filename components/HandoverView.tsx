"use client";

// 인수인계 자료 (파트 Y) — 담당자별 문서. 좌: 목록(내 문서/공유받은 문서) + 새로 만들기,
// 우: 편집(제목·마크다운·담당 업무 다중 선택) 또는 읽기. 선택 업무는 문서에 자동 삽입.
// 마크다운 에디터·업무 다중 선택·PDF(@media print)는 기존 패턴 재사용.
import PageShell from "./PageShell";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import EmptyState from "./EmptyState";

interface ListItem {
  id: number; title: string; status: string; area_id: number | null; area_name: string | null;
  color_key: string | null; author_id: number; author_name: string; updated_at: string; task_count: number;
}
interface LinkedTask {
  id: number; title: string; status: string; dueDate: string | null; projectName: string | null;
  areaName: string; artifacts: { kind: string; title: string; url: string }[];
}
interface Detail {
  handover: { id: number; title: string; content: string; areaId: number | null; areaName: string | null; status: string; authorId: number; authorName: string; updatedAt: string };
  linkedTasks: LinkedTask[];
  taskIds: number[];
  canEdit: boolean;
}
interface SelTask { id: number; title: string; areaName?: string; status: string }

const STATUS_LABEL: Record<string, string> = {
  proposed: "제안", todo: "대기", doing: "진행", review: "리뷰", done: "완료", dropped: "중단",
};

function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

export default function HandoverView({ user }: { user: SessionUser }) {
  const [mine, setMine] = useState<ListItem[]>([]);
  const [shared, setShared] = useState<ListItem[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [areas, setAreas] = useState<{ id: number; name: string }[]>([]);
  const [selTasks, setSelTasks] = useState<SelTask[]>([]);
  const [draft, setDraft] = useState<{ title: string; content: string; areaId: number; taskIds: number[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadList = useCallback(async () => {
    const res = await fetch("/api/handover");
    if (res.ok) { const d = await res.json(); setMine(d.mine ?? []); setShared(d.shared ?? []); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => {
    fetch("/api/meta/selectors").then((r) => r.json()).then((d) => setAreas(d.areas ?? [])).catch(() => {});
    fetch("/api/tasks").then((r) => r.json()).then((d) => setSelTasks(d.tasks ?? [])).catch(() => {});
  }, []);

  const loadDetail = useCallback(async (id: number) => {
    setError(""); setNotice("");
    const res = await fetch(`/api/handover/${id}`);
    if (!res.ok) { setError((await res.json()).error ?? "불러오기 실패"); setDetail(null); return; }
    const d: Detail = await res.json();
    setDetail(d);
    setDraft({
      title: d.handover.title, content: d.handover.content,
      areaId: d.handover.areaId ?? 0, taskIds: d.taskIds,
    });
  }, []);

  useEffect(() => { if (selectedId != null) loadDetail(selectedId); else setDetail(null); }, [selectedId, loadDetail]);

  async function create() {
    setBusy(true); setError("");
    const res = await fetch("/api/handover", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "새 인수인계 문서" }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "생성 실패"); return; }
    const { id } = await res.json();
    await loadList();
    setSelectedId(id);
  }

  async function save() {
    if (!draft || !detail) return;
    setBusy(true); setError(""); setNotice("");
    const res = await fetch(`/api/handover/${detail.handover.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: draft.title, content: draft.content,
        areaId: draft.areaId || null, taskIds: draft.taskIds,
      }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "저장 실패"); return; }
    setNotice("저장했습니다.");
    await loadDetail(detail.handover.id);
    await loadList();
  }

  async function setStatus(status: "draft" | "shared") {
    if (!detail) return;
    setBusy(true); setError("");
    const res = await fetch(`/api/handover/${detail.handover.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "실패"); return; }
    setNotice(status === "shared" ? "공유했습니다. 팀장·해당 영역 담당이 열람할 수 있습니다." : "비공개로 전환했습니다.");
    await loadDetail(detail.handover.id);
    await loadList();
  }

  async function remove() {
    if (!detail) return;
    if (!window.confirm("이 인수인계 문서를 삭제할까요? (소프트 삭제)")) return;
    const res = await fetch(`/api/handover/${detail.handover.id}`, { method: "DELETE" });
    if (!res.ok) { setError((await res.json()).error ?? "삭제 실패"); return; }
    setSelectedId(null); setDetail(null); await loadList();
  }

  const toggleTask = (id: number) => {
    if (!draft) return;
    setDraft({ ...draft, taskIds: draft.taskIds.includes(id) ? draft.taskIds.filter((x) => x !== id) : [...draft.taskIds, id] });
  };

  const canEdit = detail?.canEdit ?? false;

  return (
    <PageShell
      crumb={["워크스페이스", "인수인계"]}
      title="인수인계 자료"
      subtitle={<>담당 업무를 넘길 때 필요한 문서를 만들고, 준비되면 공유하세요. PDF로 내보낼 수 있습니다.</>}
      actions={
        <button className="btn-primary no-print" onClick={create} disabled={busy}>＋ 새 인수인계</button>
      }
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        <div className="rp-cols">
          <aside className="rp-side no-print">
            <div className="ho-sec-h">내 인수인계 <span>{mine.length}</span></div>
            {mine.length === 0 && (
              // 빈 상태에서 바로 시작할 수 있게 CTA를 안에 둔다 (MD-P-2026-013)
              <div className="gempty">
                <p>아직 문서가 없어요.</p>
                <button className="btn small" onClick={create} disabled={busy}>＋ 새 인수인계</button>
              </div>
            )}
            {mine.map((h) => {
              const shared_ = h.status === "shared";
              return (
                <button key={h.id} className={`ho-item${selectedId === h.id ? " on" : ""}`} onClick={() => setSelectedId(h.id)}>
                  <span className={`led ${shared_ ? "s-done" : "s-todo"}`} aria-hidden="true" />
                  <span className="ho-item-main">
                    <b className="ho-item-t">{h.title || "제목 없음"}</b>
                    <span className="ho-item-m num">#{h.id} · {relTime(h.updated_at)}</span>
                  </span>
                  <span className={`ho-item-st ${shared_ ? "shared" : "draft"}`}>{shared_ ? "공유" : "초안"}</span>
                </button>
              );
            })}

            <div className="ho-sec-h" style={{ marginTop: 16 }}>공유받은 문서 <span>{shared.length}</span></div>
            {shared.length === 0 && <p className="gempty">공유받은 문서가 없습니다.</p>}
            {shared.map((h) => (
              <button key={h.id} className={`ho-item${selectedId === h.id ? " on" : ""}`} onClick={() => setSelectedId(h.id)}>
                <span className="led s-done" aria-hidden="true" />
                <span className="ho-item-main">
                  <b className="ho-item-t">{h.title || "제목 없음"}</b>
                  <span className="ho-item-m num">#{h.id} · {relTime(h.updated_at)} · {h.author_name}</span>
                </span>
                <span className="ho-item-st shared">공유</span>
              </button>
            ))}
          </aside>

          <main className="rp-main">
            {!detail && (
              <div className="rp-empty-center no-print">
                <EmptyState title="문서를 선택하세요" hint="왼쪽에서 문서를 고르거나 새 인수인계를 만드세요." />
              </div>
            )}

            {detail && draft && (
              <>
                {error && <p className="gerr no-print">{error}</p>}
                {notice && <p className="rp-notice no-print">{notice}</p>}

                {canEdit ? (
                  <div className="ho-edit no-print">
                    <div className="tform-r">
                      <label>제목</label>
                      <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                    </div>
                    <div className="tform-r">
                      <label>영역 (지정 시 해당 영역 담당이 공유 문서를 열람)</label>
                      <select value={draft.areaId} onChange={(e) => setDraft({ ...draft, areaId: Number(e.target.value) })}>
                        <option value={0}>영역 없음</option>
                        {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                    </div>
                    <div className="tform-r">
                      <label>본문 (마크다운)</label>
                      <textarea className="ho-content" rows={10} value={draft.content}
                        onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                        placeholder={"## 인수인계 개요\n- 진행 상황\n- 주의할 점\n- 연락처"} />
                    </div>
                    <div className="tform-r">
                      <label>담당 업무 선택 (선택한 업무의 제목·상태·기한·자료가 문서에 삽입됩니다)</label>
                      <div className="ho-tasks">
                        {selTasks.length === 0 && <p className="gempty">선택할 업무가 없습니다.</p>}
                        {selTasks.map((t) => (
                          <label key={t.id} className="ho-task-pick">
                            <input type="checkbox" checked={draft.taskIds.includes(t.id)} onChange={() => toggleTask(t.id)} />
                            <span>{t.title}</span>
                            <em>{STATUS_LABEL[t.status] ?? t.status}</em>
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="ho-actions">
                      <button className="btn-brand" onClick={save} disabled={busy}>{busy ? "저장 중…" : "저장"}</button>
                      {detail.handover.status === "shared" ? (
                        <button className="btn-outline" onClick={() => setStatus("draft")} disabled={busy}>비공개로</button>
                      ) : (
                        <button className="btn-outline" onClick={() => setStatus("shared")} disabled={busy}>공유하기</button>
                      )}
                      <button className="btn-outline" onClick={() => window.print()}>PDF 내보내기</button>
                      <span style={{ flex: 1 }} />
                      <button className="btn danger" onClick={remove} disabled={busy}>삭제</button>
                    </div>
                  </div>
                ) : (
                  <p className="rp-notice-block no-print">
                    {detail.handover.authorName}님의 공유 문서입니다. (읽기 전용)
                  </p>
                )}

                {/* 문서 본문 — 화면 미리보기 + 인쇄 대상 */}
                <article className="ho-doc">
                  <h1 className="ho-title">{draft.title || "제목 없음"}</h1>
                  <p className="ho-meta">
                    작성 {detail.handover.authorName}
                    {detail.handover.areaName ? ` · 영역 ${detail.handover.areaName}` : ""}
                    {` · ${detail.handover.status === "shared" ? "공유됨" : "초안"}`}
                  </p>
                  {(canEdit ? draft.content : detail.handover.content).trim() ? (
                    <pre className="ho-body">{canEdit ? draft.content : detail.handover.content}</pre>
                  ) : (
                    <p className="ho-empty no-print">본문을 입력하면 여기에 표시됩니다.</p>
                  )}

                  <h2 className="ho-h2">담당 업무 ({detail.linkedTasks.length})</h2>
                  {detail.linkedTasks.length === 0 && <p className="ho-empty">연결된 업무가 없습니다.</p>}
                  {detail.linkedTasks.map((t) => (
                    <div className="ho-task" key={t.id}>
                      <div className="ho-task-h">
                        <b>{t.title}</b>
                        <span className="ho-task-m">
                          {STATUS_LABEL[t.status] ?? t.status}
                          {t.dueDate ? ` · 기한 ${t.dueDate}` : ""}
                          {t.projectName ? ` · ${t.projectName}` : ` · ${t.areaName}`}
                        </span>
                      </div>
                      {t.artifacts.length > 0 && (
                        <ul className="ho-arts">
                          {t.artifacts.map((a, i) => (
                            <li key={i}><span className="ho-akind">{a.kind}</span> <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a></li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                </article>
              </>
            )}
          </main>
        </div>
      </div>
    </div>
    </PageShell>
  );
}
