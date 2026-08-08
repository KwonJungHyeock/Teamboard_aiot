"use client";

// 업무 상세 슬라이드 패널 — 전역 우측 패널 규칙(MD-P-2026-006 §B)을 따른다:
// 폭 420px · Esc 닫기 · 열린 상태에서 좌측 목록 계속 조작(배경 차단 없음) · 스택 깊이 1 ·
// URL ?panel=task:id 반영. 편집기 규모 때문에 렌더 컴포넌트만 분리돼 있고 셸 규칙은 동일하다.
import { useCallback, useEffect, useRef, useState } from "react";
import Markdown from "./Markdown";
import { decTime, type Decision } from "./decision-ui";
import { blobSrc } from "@/lib/upload";
import { AttachButton, AttachStatus, DropZone, useAttach } from "./Attach";
import { openPanel } from "@/lib/side-panel";
import DocEditor, { type DocBlock } from "./DocEditor";
import SubtaskSection, { type SubtaskRow } from "./SubtaskSection";
import PropertyBlock, { type PropRow } from "./PropertyBlock";
import LinkedResources from "./LinkedResources";
import { RESOLUTIONS, RESOLUTION_LABEL, type Resolution } from "@/lib/progress";
import SectionEmpty from "./SectionEmpty";
import Skeleton from "./Skeleton";
import ProjectCombo, { type ComboProject } from "./ProjectCombo";
import { notifyGoalChain } from "@/lib/goal-chain";
import type { SessionUser } from "@/lib/types";
import { pfill } from "@/lib/progress-bar";
import {
  TASK_PANEL_EVENT,
  currentTaskRef,
  closeTaskPanel,
  notifyTaskUpdated,
  openTaskPanel,
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
  /** §A1 하위 업무 목록. 자기가 하위면 항상 빈 배열이다(깊이 2단). */
  children: SubtaskRow[];
  goalSource: "inherited" | "manual" | "none";   // inherited 는 역사적 값(= 미지정). 새로 안 생긴다.
  visibility: "team" | "private";
  effectiveProgress: number; rolledUpFromChildren: boolean;
  goalLink: {
    projectId: number | null; projectName: string | null;
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

/**
 * §H4-② — 이 필드들이 바뀌면 목표 집계가 실제로 움직인다.
 * 제목·담당·설명이 바뀌었다고 목표가 오르지는 않는다. 그때 연쇄가 재생되면 거짓말이 된다.
 */
const CHAIN_FIELDS = ["progress", "status", "resolution", "goalIds", "goalSource", "projectId"];

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function TaskDetailPanel({ user }: { user: SessionUser }) {
  // 이 패널은 **이미 있는 업무를 보고 고치는 용도로만** 남는다 (MD-P-2026-027 §C4).
  // 새 업무 생성은 NewTaskModal 이 맡는다. 만드는 자리가 둘이면 필드가 갈라진다.
  const [openId, setOpenId] = useState<number | null>(null);
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
  const [shareOpen, setShareOpen] = useState(false);   // 팀 타임라인 공유(협업 A)
  const [shareNote, setShareNote] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [shareDone, setShareDone] = useState(false);
  const [docBlocks, setDocBlocks] = useState<DocBlock[]>([]); // §F3 연결된 리소스 자동 집계용
  const descRef = useRef<HTMLTextAreaElement>(null);

  // ── 열림 상태 소스: URL ?task + 이벤트 + 뒤로가기 ──
  // `new` 는 여기서 무시한다 — 모달이 받는다 (§C4).
  useEffect(() => {
    const sync = () => { const r = currentTaskRef(); setOpenId(typeof r === "number" ? r : null); };
    sync();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "number") setOpenId(detail);
      else if (detail === null) setOpenId(null);
      else sync();
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
    loadDetail(openId);
    loadComments(openId);
  }, [openId, loadDetail, loadComments]);

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
    if (CHAIN_FIELDS.some((k) => k in fields)) notifyGoalChain();
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
    if (CHAIN_FIELDS.some((k) => k in fields)) notifyGoalChain();
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

  // 이미지 업로드 — 공용 첨부 한 벌을 쓴다 (MD-P-2026-026 §B-2).
  // 마크다운에는 공개 URL이 아니라 /api/blob 라우트 경로를 넣는다 (014a).
  // 목적지(설명/코멘트)는 ref 로 들고 있는다 — 훅은 파일 하나만 알면 되고,
  // "다시 시도" 가 원래 목적지로 돌아가야 하기 때문이다.
  const uploadInto = useRef<"desc" | "comment">("desc");
  const descRef2 = useRef(descText);
  descRef2.current = descText;
  const attach = useAttach(
    { kind: "task", id: typeof openId === "number" ? openId : 0 },
    async (up) => {
      const md = `![${up.name}](${blobSrc(up.pathname)})`;
      if (uploadInto.current === "desc") {
        const next = descRef2.current ? `${descRef2.current}\n${md}` : md;
        setDescText(next);
        await patch({ description: next });
      } else {
        setNewComment((c) => (c ? `${c} ${md}` : md));
      }
    }
  );
  function insertUpload(file: File, into: "desc" | "comment") {
    if (typeof openId !== "number") return;
    uploadInto.current = into;
    void attach.send(file);
  }
  function pasteImage(e: React.ClipboardEvent, into: "desc" | "comment") {
    const img = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"));
    if (img) {
      const f = img.getAsFile();
      if (f) { e.preventDefault(); insertUpload(f, into); }
    }
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

  // ── §F1 속성 블록 — 순서 고정: 상태 / 담당 / 기간 / 우선순위 / 진행률 / 프로젝트 / 목표.
  //    영역·업무유형은 기존 기능을 잃지 않도록 그 뒤에 붙인다(5개 초과 → "속성 접기"로 접힘).
  const labelOf = (pairs: readonly (readonly [string, string])[], v: string) =>
    pairs.find(([k]) => k === v)?.[1] ?? v;
  const period = t
    ? t.startDate && t.dueDate ? `${t.startDate} → ${t.dueDate}`
      : t.dueDate ? `~ ${t.dueDate}` : t.startDate ? `${t.startDate} ~` : ""
    : "";
  const linkedGoals = t ? (sel?.monthGoals ?? []).filter((g) => t.goalIds.includes(g.id)) : [];

  // 목표 후보 순서 — 서버가 준 순서(이번 달 우선 · 최근 사용 순, 지시 20-1) 그대로.
  //
  // 예전에는 "소속 프로젝트가 붙어 있는 월 목표"를 맨 앞에 두고 「제안」을 달았다.
  // 프로젝트→목표 연결이 사라졌으므로(MD-P-2026-030 §A2) 그 제안의 근거도 사라졌다.
  const goalOptions = sel?.monthGoals ?? [];

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
          <i><b style={pfill(t.effectiveProgress)} /></i>
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
      // §D4 — 값을 누르면 그 자리에서 바꾼다. 셀렉트가 아니라 검색형 콤보박스다(§D1).
      // 후보를 **영역으로 좁히지 않는다** — 예전에는 t.areaId 와 같은 영역의 프로젝트만
      // 보여서, 영역을 잘못 고른 업무는 정작 붙여야 할 프로젝트가 목록에 없었다.
      key: "project", label: "프로젝트",
      value: t.projectName, empty: !t.projectId, action: "＋ 프로젝트 연결",
      editor: () => (
        <ProjectCombo
          value={t.projectId}
          projects={sel?.projects ?? []}
          areaId={t.areaId}
          canCreate={user.role === "lead"}
          disabled={t.visibility === "private"}
          disabledReason={t.visibility === "private" ? "개인 업무는 프로젝트에 넣을 수 없습니다" : undefined}
          onChange={(id) =>
            patchOpt({ projectId: id }, { projectId: id, projectName: (sel?.projects ?? []).find((p) => p.id === id)?.name ?? null })
          }
          onCreated={(p: ComboProject) => setSel((s) => (s ? { ...s, projects: [...s.projects, p] } : s))}
        />
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
              <em>{g.month}</em>
            </label>
          ))}
          {/* 확정 23-3 — "목표 없음"은 여기서도 고를 수 있어야 한다. 일괄 화면에서만 되면 안 된다. */}
          <label className="prop-gnone">
            {/* 해제하면 '미지정'으로 돌아간다 — 상속으로 돌아가지 않는다 (§A4).
                다시 미연결 배너에 올라오고, 목표는 사람이 고른다. */}
            <input type="checkbox" checked={t.goalSource === "none"}
              onChange={(e) =>
                patchOpt({ goalSource: e.target.checked ? "none" : "manual" },
                         { goalSource: e.target.checked ? "none" : "manual" })} />
            목표 없음 <em>성과 집계 대상 아님 · 수행한 업무로는 남습니다</em>
          </label>
        </div>
      ),
    },
    // ── §A4 승격·강등 — 여기서 상위를 비우면 최상위가 되고, 지정하면 하위가 된다.
    //    예전에는 읽기 전용 링크였고 값이 없으면 줄 자체가 없었다. 줄이 없으면
    //    **승격도 강등도 화면에서 할 수 없다.** 하위를 가진 업무는 하위가 될 수 없으므로
    //    (깊이 2단) 그때는 줄을 그리지 않는다 — 눌러도 안 되는 것을 보이지 않게 한다.
    ...(t.parentTaskId !== null || t.childCount === 0 ? [{
      key: "parent", label: "상위 업무",
      value: t.parentTaskId === null ? null : (
        <button className="prop-link" onClick={() => openTaskPanel(t.parentTaskId!)}>
          #{t.parentTaskId} {t.parentTitle ?? ""}
        </button>
      ),
      empty: t.parentTaskId === null, action: "＋ 상위 지정",
      editor: (close: () => void) => (
        <ParentPicker
          taskId={t.id}
          current={t.parentTaskId}
          onDone={(msg) => { close(); if (msg) setErr(msg); else { notifyTaskUpdated(); void loadDetail(t.id); } }}
        />
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
    {
      // §B1 — 공개 범위. 개인으로 바꾸려면 프로젝트가 비어 있어야 한다(서버가 사유를 돌려준다).
      key: "visibility", label: "공개 범위",
      value: t.visibility === "private" ? "개인 (나만 봄)" : "팀 공개",
      editor: (close) => (
        <select autoFocus value={t.visibility}
          onChange={(e) => {
            patchOpt({ visibility: e.target.value }, { visibility: e.target.value as "team" | "private" });
            close();
          }}>
          <option value="team">팀 공개</option>
          <option value="private">개인 (나만 봄)</option>
        </select>
      ),
    },
  ];

  return (
    <>
      <aside className="tdp" role="dialog" aria-label="업무 상세">
        <div className="tdp-head">
          <span className="tdp-crumb">
            업무 상세 {t ? `· #${t.id}` : ""}
          </span>
          <span className={`tdp-save ${save}`}>
            {save === "saving" ? "저장 중…" : save === "saved" ? "저장됨" : ""}
          </span>
          <button className="tdp-x" onClick={() => closeTaskPanel()} aria-label="닫기">✕</button>
        </div>

        {!t && !err && <div className="tdp-body"><Skeleton variant="page" rows={3} /></div>}
        {err && !t && <div className="tdp-body"><p className="tdp-err">{err}</p></div>}

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

            {/* §A1 하위 업무 — 속성 블록 아래, 자유 본문 위.
                §A2 — **하위 업무의 상세에는 이 섹션 자체를 그리지 않는다.** 깊이 2단이라
                눌러도 안 되는 것을 보여줄 이유가 없다. */}
            {t.parentTaskId === null && (
              <SubtaskSection
                parentId={t.id}
                children={t.children ?? []}
                prefill={{ areaId: t.areaId, projectId: t.projectId ?? undefined, visibility: t.visibility }}
                onChanged={() => { notifyTaskUpdated(); void loadDetail(t.id); }}
              />
            )}

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
              <DropZone onFile={(f) => insertUpload(f, "desc")}>
              <textarea
                ref={descRef}
                className="tdp-desc" rows={4} value={descText}
                placeholder="업무 설명… 이미지를 붙여넣거나 끌어다 놓으면 인라인 삽입됩니다."
                onChange={(e) => setDescText(e.target.value)}
                onBlur={() => { if (descText !== t.description) patch({ description: descText }); }}
                onPaste={(e) => pasteImage(e, "desc")}
              />
              </DropZone>
              <div className="tdp-attach">
                <AttachButton onFile={(f) => insertUpload(f, "desc")} busy={attach.busy} />
              </div>
              <AttachStatus state={attach.state} onRetry={attach.retry} onDismiss={attach.dismiss} />
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
              {activity.length === 0 && <SectionEmpty text="기록된 활동이 없어요" />}
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
                  placeholder="코멘트… 이미지를 붙여넣거나 끌어다 놓으세요" onKeyDown={(e) => e.key === "Enter" && addComment()}
                  onPaste={(e) => pasteImage(e, "comment")} />
                <AttachButton onFile={(f) => insertUpload(f, "comment")} busy={attach.busy} />
                <button className="btn small primary" onClick={addComment} disabled={!newComment.trim()}>등록</button>
              </div>
            </div>
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

/**
 * §A4 상위 업무 지정·해제.
 *
 * 후보를 화면에서 거르지 않는다 — 서버(`checkParent`)가 같은 규칙으로 다시 본다.
 * 여기서 미리 거르면 규칙이 두 벌이 되고, 반드시 한쪽이 낡는다(030 에서 겪은 것).
 * 대신 거절 사유를 **그대로 받아 화면에 띄운다.**
 */
function ParentPicker({
  taskId, current, onDone,
}: {
  taskId: number;
  current: number | null;
  onDone: (errorMessage?: string) => void;
}) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: number; title: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d) setRows((d.tasks ?? []).filter((x: { id: number }) => x.id !== taskId)); })
      .catch(() => {});
    return () => { alive = false; };
  }, [taskId]);

  const hit = q.trim()
    ? rows.filter((r) => r.title.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : rows.slice(0, 8);

  async function pick(id: number | null) {
    if (busy) return;
    setBusy(true);
    const res = await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentTaskId: id }),
    }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      onDone((res && (await res.json().catch(() => ({})))?.error) || "상위 업무를 바꾸지 못했어요");
      return;
    }
    onDone();
  }

  return (
    <div className="ppk">
      <input className="ppk-q" autoFocus value={q} placeholder="업무 제목 검색…"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && hit[0]) { e.preventDefault(); void pick(hit[0].id); } }} />
      <div className="ppk-list" role="listbox">
        {current !== null && (
          <button className="ppk-o none" onClick={() => pick(null)} disabled={busy}>
            상위 없음 <em>최상위 업무로 올립니다</em>
          </button>
        )}
        {hit.length === 0 && <span className="ppk-none">맞는 업무가 없어요.</span>}
        {hit.map((r) => (
          <button key={r.id} className={`ppk-o${r.id === current ? " on" : ""}`} onClick={() => pick(r.id)} disabled={busy}>
            <span className="ppk-id num">#{r.id}</span>{r.title}
          </button>
        ))}
      </div>
      <p className="ppk-n">하위가 되면 프로젝트·영역·공개 범위를 상위에서 물려받습니다.</p>
    </div>
  );
}
