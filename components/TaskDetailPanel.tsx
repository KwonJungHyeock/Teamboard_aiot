"use client";

// 업무 상세 슬라이드 패널 — 전역 우측 패널 규칙(MD-P-2026-006 §B)을 따른다:
// 폭 420px · Esc 닫기 · 열린 상태에서 좌측 목록 계속 조작(배경 차단 없음) · 스택 깊이 1 ·
// URL ?panel=task:id 반영. 편집기 규모 때문에 렌더 컴포넌트만 분리돼 있고 셸 규칙은 동일하다.
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { decTime, type Decision } from "./decision-ui";
import { uploadImage, blobSrc } from "@/lib/upload";
import { openPanel } from "@/lib/side-panel";
import DocEditor, { type DocBlock } from "./DocEditor";
import PropertyBlock, { type PropRow } from "./PropertyBlock";
import LinkedResources from "./LinkedResources";
import { RESOLUTIONS, RESOLUTION_LABEL, type Resolution } from "@/lib/progress";
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
  blocked: boolean; blockedReason: string | null; blockedSince: string | null; blockedBy: number | null;
  // MD-P-2026-024 — 업무 구조
  resolution: string | null;
  parentTaskId: number | null; parentTitle: string | null;
  blockedByTitle: string | null; childCount: number;
  goalSource: "inherited" | "manual" | "none";
  effectiveProgress: number; rolledUpFromChildren: boolean;
  goalLink: {
    projectHasNoGoal: boolean; projectId: number | null; projectName: string | null;
    projectGoalId: number | null; projectGoalTitle: string | null;
  };
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
  const [decisions, setDecisions] = useState<Decision[]>([]); // 관련 결정 (MD-P-2026-004 §E)
  const [save, setSave] = useState<"idle" | "saving" | "saved">("idle");
  const [err, setErr] = useState("");
  const [newComment, setNewComment] = useState("");
  const [dropping, setDropping] = useState(false);
  const [dropReason, setDropReason] = useState("");
  const [descText, setDescText] = useState("");   // 설명(마크다운) 편집 버퍼 — 미리보기 동기화
  const [prog, setProg] = useState(0);             // 진행률 슬라이더 로컬 상태
  const [blockReason, setBlockReason] = useState(""); // 막힘 사유 편집 버퍼
  const [blockErr, setBlockErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);   // 팀 타임라인 공유(협업 A)
  const [shareNote, setShareNote] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [docBlocks, setDocBlocks] = useState<DocBlock[]>([]); // §F3 연결된 리소스 자동 집계용
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
    setBlockReason(data.task.blockedReason ?? "");
    setBlockErr("");
    setActivity(data.activity ?? []);
    setDecisions(data.decisions ?? []);
  }, []);
  const loadComments = useCallback(async (id: number) => {
    const res = await fetch(`/api/tasks/${id}/comments`);
    if (res.ok) setComments((await res.json()).comments ?? []);
  }, []);

  useEffect(() => {
    if (openId == null) { setT(null); setErr(""); return; }
    setErr(""); setDropping(false); setDropReason("");
    // 열 때마다 셀렉트 재조회 — 세션 중 새로 만든 월 목표·프로젝트가 즉시 연결 후보로 뜨도록.
    fetch("/api/meta/selectors").then((r) => r.json()).then(setSel).catch(() => {});
    if (openId === "new") { setT(null); return; }
    loadDetail(openId);
    loadComments(openId);
  }, [openId, loadDetail, loadComments]);

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

  /**
   * 낙관적 저장 (§F1) — 화면을 먼저 바꾸고 서버에 보낸다. 실패하면 이전 값으로 되돌린다.
   * 성공 시 loadDetail 로 서버 확정값을 다시 덮어써 집계(진척·목표)가 즉시 반영된다.
   */
  async function patchOpt(fields: Record<string, unknown>, local: Partial<TaskDetail>) {
    if (typeof openId !== "number" || !t) return false;
    const prev = t;
    setT({ ...t, ...local });
    setSave("saving"); setErr("");
    const res = await fetch(`/api/tasks/${openId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fields),
    });
    if (!res.ok) {
      setT(prev);                                  // 롤백
      setErr((await res.json()).error ?? "저장 실패");
      setSave("idle");
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

  // 팀 타임라인 공유(협업 A) — activity 포스트 + 노트 @멘션 알림
  async function shareToTimeline() {
    if (typeof openId !== "number" || shareBusy) return;
    setShareBusy(true); setErr("");
    const res = await fetch("/api/feed", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: openId, note: shareNote.trim() }),
    });
    setShareBusy(false);
    if (res.ok) { setShareDone(true); setShareOpen(false); setShareNote(""); }
    else setErr((await res.json()).error ?? "공유 실패");
  }

  // 이미지 업로드(붙여넣기/드롭/파일) → Private Blob → 마크다운 삽입 (MD-P-2026-014a).
  // 마크다운에는 공개 URL이 아니라 /api/blob 라우트 경로를 넣는다.
  async function insertUpload(file: File, into: "desc" | "comment") {
    if (typeof openId !== "number") return;
    setUploading(true); setErr("");
    try {
      const up = await uploadImage(file, { kind: "task", id: openId });
      const md = `![${up.name}](${blobSrc(up.pathname)})`;
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

  // ── §F1 속성 블록 — 순서 고정: 상태 / 담당 / 기간 / 우선순위 / 진행률 / 프로젝트 / 목표.
  //    영역·업무유형은 기존 기능을 잃지 않도록 그 뒤에 붙인다(5개 초과 → "속성 접기"로 접힘).
  const labelOf = (pairs: readonly (readonly [string, string])[], v: string) =>
    pairs.find(([k]) => k === v)?.[1] ?? v;
  const period = t
    ? t.startDate && t.dueDate ? `${t.startDate} → ${t.dueDate}`
      : t.dueDate ? `~ ${t.dueDate}` : t.startDate ? `${t.startDate} ~` : ""
    : "";
  const linkedGoals = t ? (sel?.monthGoals ?? []).filter((g) => t.goalIds.includes(g.id)) : [];

  // 목표 후보 순서 (MD-P-2026-024 회신 6 지시 20-2) —
  // 소속 프로젝트가 붙어 있는 월 목표를 맨 앞에 둔다. 그 뒤는 서버가 준 순서
  // (이번 달 우선 · 최근 사용 순, 지시 20-1)를 그대로 쓴다.
  const goalOptions = (() => {
    const all = sel?.monthGoals ?? [];
    const sug = t?.goalLink.projectGoalId ?? null;
    if (sug === null) return all;
    const hit = all.find((g) => g.id === sug);
    return hit ? [hit, ...all.filter((g) => g.id !== sug)] : all;
  })();

  const propRows: PropRow[] = !t ? [] : [
    {
      key: "status", label: "상태",
      value: <span className={`prop-st st-${t.status}`}>{labelOf(STATUS, t.status)}</span>,
      editor: (close) => (
        <select autoFocus value={STATUS.some(([v]) => v === t.status) ? t.status : ""}
          onChange={(e) => { patchOpt({ status: e.target.value }, { status: e.target.value }); close(); }}>
          {!STATUS.some(([v]) => v === t.status) && <option value="">{t.status}</option>}
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ),
    },
    {
      key: "assignee", label: "담당",
      value: t.assigneeName, empty: !t.assigneeId, action: "＋ 담당 지정",
      editor: (close) => (
        <select autoFocus value={t.assigneeId ?? 0}
          onChange={(e) => {
            const id = Number(e.target.value) || null;
            patchOpt({ assigneeId: id }, { assigneeId: id, assigneeName: sel?.actors.find((a) => a.id === id)?.name ?? null });
            close();
          }}>
          <option value={0}>미지정</option>
          {sel?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ),
    },
    {
      key: "period", label: "기간",
      value: <span className="num">{period}</span>, empty: !period, action: "기간 미정",
      editor: () => (
        <div className="prop-dates">
          <label>시작
            <input type="date" defaultValue={t.startDate ?? ""}
              onChange={(e) => patchOpt({ startDate: e.target.value || null }, { startDate: e.target.value || null })} />
          </label>
          <label>마감
            <input type="date" defaultValue={t.dueDate ?? ""}
              onChange={(e) => patchOpt({ dueDate: e.target.value || null }, { dueDate: e.target.value || null })} />
          </label>
        </div>
      ),
    },
    {
      key: "priority", label: "우선순위",
      value: labelOf(PRIORITY, t.priority),
      editor: (close) => (
        <select autoFocus value={t.priority}
          onChange={(e) => { patchOpt({ priority: e.target.value }, { priority: e.target.value }); close(); }}>
          {PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ),
    },
    {
      key: "progress", label: "진행률",
      value: (
        <span className="prop-prog">
          <i><b style={{ width: `${t.effectiveProgress}%` }} /></i>
          <em className="num">{t.effectiveProgress}%</em>
          {t.rolledUpFromChildren && <em className="prop-note">하위 업무로 계산 중</em>}
        </span>
      ),
      editor: () => (
        <div className="prop-prog-edit">
          <input type="range" min={0} max={100} step={5} value={prog} autoFocus
            onChange={(e) => setProg(Number(e.target.value))}
            onMouseUp={() => prog !== t.progress && patchOpt({ progress: prog }, { progress: prog })}
            onKeyUp={() => prog !== t.progress && patchOpt({ progress: prog }, { progress: prog })}
            onTouchEnd={() => prog !== t.progress && patchOpt({ progress: prog }, { progress: prog })}
            aria-label="진행률" />
          <input type="number" min={0} max={100} value={prog} className="prop-prog-n"
            onChange={(e) => setProg(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
            onBlur={() => prog !== t.progress && patchOpt({ progress: prog }, { progress: prog })}
            aria-label="진행률 입력" />
        </div>
      ),
    },
    {
      key: "project", label: "프로젝트",
      value: t.projectName, empty: !t.projectId, action: "＋ 프로젝트 연결",
      editor: (close) => (
        <select autoFocus value={t.projectId ?? 0}
          onChange={(e) => {
            const id = Number(e.target.value) || null;
            patchOpt({ projectId: id }, { projectId: id, projectName: areaProjects.find((p) => p.id === id)?.name ?? null });
            close();
          }}>
          <option value={0}>없음</option>
          {areaProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      ),
    },
    {
      key: "goals", label: "목표",
      // "목표 없음"은 빈 값이 아니라 사람이 정한 상태다. 비어 보이게 두면 또 붙이라고 조른다(확정 23).
      value: t.goalSource === "none" ? "목표 없음" : linkedGoals.map((g) => g.title).join(", "),
      empty: t.goalSource !== "none" && linkedGoals.length === 0, action: "＋ 목표 연결",
      editor: () => (
        <div className="prop-goals">
          {(sel?.monthGoals.length ?? 0) === 0 && <p className="prop-none">연결 가능한 월 목표가 없습니다.</p>}
          {goalOptions.map((g) => (
            <label key={g.id}>
              <input type="checkbox" checked={t.goalIds.includes(g.id)}
                onChange={(e) => {
                  const next = e.target.checked ? [...t.goalIds, g.id] : t.goalIds.filter((x) => x !== g.id);
                  patchOpt({ goalIds: next }, { goalIds: next });
                }} />
              {g.title}
              {/* 소속 프로젝트가 붙어 있는 목표를 맨 앞에 두고 표시한다 (지시 20-2) */}
              {g.id === t.goalLink.projectGoalId && <b className="prop-sug">제안</b>}
              <em>{g.month}</em>
            </label>
          ))}
          {/* 확정 23-3 — "목표 없음"은 여기서도 고를 수 있어야 한다. 일괄 화면에서만 되면 안 된다. */}
          <label className="prop-gnone">
            <input type="checkbox" checked={t.goalSource === "none"}
              onChange={(e) =>
                patchOpt({ goalSource: e.target.checked ? "none" : "inherited" },
                         { goalSource: e.target.checked ? "none" : "inherited" })} />
            목표 없음 <em>성과 집계 대상 아님 · 수행한 업무로는 남습니다</em>
          </label>
        </div>
      ),
    },
    // ── MD-P-2026-024 §6-1 — 읽기 전용 2줄. 값이 없으면 줄 자체를 만들지 않는다.
    ...(t.parentTaskId !== null ? [{
      key: "parent", label: "상위 업무",
      value: (
        <button className="prop-link" onClick={() => openTaskPanel(t.parentTaskId!)}>
          #{t.parentTaskId} {t.parentTitle ?? ""}
        </button>
      ),
    } as PropRow] : []),
    ...(t.blockedBy !== null ? [{
      key: "blockedBy", label: "차단",
      value: (
        <button className="prop-link" onClick={() => openTaskPanel(t.blockedBy!)}>
          #{t.blockedBy} {t.blockedByTitle ?? ""}
        </button>
      ),
    } as PropRow] : []),
    // §6-2 — 완료 사유 4지. 완료 상태에서만 나타난다. 기본값 완료.
    ...(t.status === "done" ? [{
      key: "resolution", label: "완료 사유",
      value: RESOLUTION_LABEL[(t.resolution ?? "done") as Resolution],
      editor: (close: () => void) => (
        <select autoFocus value={t.resolution ?? "done"}
          onChange={(e) => { patchOpt({ resolution: e.target.value }, { resolution: e.target.value }); close(); }}>
          {RESOLUTIONS.map((r) => <option key={r} value={r}>{RESOLUTION_LABEL[r]}</option>)}
        </select>
      ),
    } as PropRow] : []),
    {
      key: "area", label: "영역",
      value: t.areaName,
      editor: (close) => (
        <select autoFocus value={t.areaId}
          onChange={(e) => {
            const id = Number(e.target.value);
            patchOpt({ areaId: id }, { areaId: id, areaName: sel?.areas.find((a) => a.id === id)?.name ?? t.areaName });
            close();
          }}>
          {sel?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ),
    },
    {
      key: "worktype", label: "업무유형",
      value: labelOf(WORKTYPE, t.workType),
      editor: (close) => (
        <select autoFocus value={t.workType}
          onChange={(e) => { patchOpt({ workType: e.target.value }, { workType: e.target.value }); close(); }}>
          {WORKTYPE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ),
    },
  ];

  return (
    <>
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

            {/* 속성 블록 (MD-P-2026-020 §F1) — 폼이 아니라 문서 속성. 값 클릭 → 그 자리 편집 */}
            <PropertyBlock rows={propRows} collapseAfter={5} />

            {/* 막힘 표시 — 상태와 별개인 진행 불가 신호. 표시 시 사유 필수. */}
            <div className={`tdp-sec tdp-block${t.blocked ? " on" : ""}`}>
              <div className="tdp-sec-h tdp-block-h">
                <span><svg className="tdp-lock" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>막힘 표시</span>
                <label className="tdp-toggle">
                  <input
                    type="checkbox"
                    checked={t.blocked}
                    onChange={async (e) => {
                      if (e.target.checked) {
                        // 켜기 — 사유 입력란만 열고, 저장은 사유 입력 후
                        setBlockErr("");
                        setT({ ...t, blocked: true, blockedReason: t.blockedReason ?? "" });
                      } else {
                        setBlockReason("");
                        setBlockErr("");
                        await patch({ blocked: false });
                      }
                    }}
                  />
                  <span className="tdp-toggle-tr" aria-hidden="true" />
                </label>
              </div>
              {t.blocked && (
                <div className="tdp-block-body">
                  <input
                    className="tdp-block-reason"
                    placeholder="막힌 사유 (필수) — 예: 부품 입고 지연, 승인 대기"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    onBlur={() => {
                      const r = blockReason.trim();
                      if (!r) { setBlockErr("사유를 입력해야 막힘으로 저장됩니다."); return; }
                      if (r !== (t.blockedReason ?? "")) patch({ blocked: true, blockedReason: r });
                    }}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  />
                  {blockErr && <p className="tdp-block-err">{blockErr}</p>}
                  <p className="tdp-block-note">진행 불가 신호입니다. 상태(진행·대기)는 그대로 두고, 해제하면 원래 상태로 돌아갑니다.</p>
                </div>
              )}
            </div>

            {/* 팀 타임라인 공유 (협업 A) */}
            <div className="tdp-sec">
              <div className="tdp-sec-h">팀 타임라인 공유</div>
              {shareDone ? (
                <p className="tdp-muted">✓ 팀 타임라인에 공유됨 — 홈 팀 타임라인·알림에 반영됩니다.
                  <button className="lk" style={{ marginLeft: 8 }} onClick={() => setShareDone(false)}>다시 공유</button>
                </p>
              ) : !shareOpen ? (
                <button className="btn small" onClick={() => setShareOpen(true)}>📣 팀 타임라인에 공유</button>
              ) : (
                <div className="sharebox">
                  <textarea
                    className="sharebox-note" style={{ marginTop: 0 }}
                    placeholder="공유 노트 (선택) — @이름으로 멘션하면 알림이 갑니다"
                    value={shareNote}
                    onChange={(e) => setShareNote(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <button className="btn small" onClick={() => { setShareOpen(false); setShareNote(""); }}>취소</button>
                    <button className="btn small primary" onClick={shareToTimeline} disabled={shareBusy}>{shareBusy ? "공유 중…" : "공유"}</button>
                  </div>
                </div>
              )}
            </div>

            {/* 본문 = 문서 (MD-P-2026-019 §F). 폼이 아니라 기록 공간이다.
                슬래시 명령 · URL 붙여넣기 임베드 · 체크리스트 · 자동 저장은 DocEditor 가 담당한다. */}
            <div className="tdp-sec tdp-doc">
              <div className="tdp-sec-h">본문</div>
              <DocEditor taskId={t.id} onBlocks={setDocBlocks} />
            </div>

            {/* 기존 평문 설명 — 문서로 옮기기 전 자료가 남아 있어서 접어서 보존한다 */}
            <details className="tdp-sec tdp-legacy" open={!!descText.trim()}>
              <summary className="tdp-sec-h">설명 (기존 평문) <em>마크다운</em></summary>
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
            </details>

            {/* 연결된 리소스 — 자동 집계 (MD-P-2026-020 §F3). 등록 UI 없음, 본문이 단일 소스 */}
            <LinkedResources
              taskId={t.id}
              blocks={docBlocks}
              projectId={t.projectId}
              projectName={t.projectName}
              goals={(sel?.monthGoals ?? []).filter((g) => t.goalIds.includes(g.id))}
            />

            {/* 관련 결정 — 이 업무에 연결된 결정 (MD-P-2026-004 §E) */}
            {decisions.length > 0 && (
              <div className="tdp-sec">
                <div className="tdp-sec-h">관련 결정 <em>({decisions.length})</em></div>
                {decisions.map((d) => (
                  <button key={d.id} className={`tdp-dec${d.status === "superseded" ? " sup" : ""}`} onClick={() => openPanel("decision", d.id)}>
                    <span className={`tdp-dec-led ${d.status === "superseded" ? "sup" : "ok"}`} aria-hidden="true" />
                    <span className="tdp-dec-b">
                      <span className="tdp-dec-t">{d.title}</span>
                      <span className="tdp-dec-m">{d.decidedByName} · <span className="num">{decTime(d.decidedAt)}</span>{d.status === "superseded" ? " · 번복됨" : ""}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

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
          <div className="tdp-foot tdp-foot-new">
            <button className="btn ghost" onClick={() => closeTaskPanel()}>취소</button>
            <button className="tdp-create btn-brand" disabled={creating || !draft?.title.trim()} onClick={createTask}>
              {creating ? "만드는 중…" : "＋ 만들기"}
            </button>
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
