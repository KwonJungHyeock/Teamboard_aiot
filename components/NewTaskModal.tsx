"use client";

// 업무 등록 모달 (MD-P-2026-027 §C).
//
// 만드는 자리와 고치는 자리를 나눈다.
// 예전에는 오른쪽 420px 상세 패널이 둘을 겸했다. 그 폭에 생성 폼을 욱여넣느라
// 설명이 4줄짜리 textarea 였고, "만든 뒤 상세 화면에서 목표를 연결하세요" 라는
// 안내가 붙어 있었다 — 만들 때 정할 수 있는 것을 나중으로 미룬 것이다.
//
// 형태 (§C1): 720 × 560 · 최대 90vh · 중앙 · 스크림.
//   왼쪽 넓은 열  제목(19px 인라인) + 본문
//   오른쪽 220px  공개 범위 · 프로젝트 · 목표 · 담당 · 상태 · 우선순위 · 기한 · 영역
//   하단          취소 · "만들고 계속 추가" · 만들기(코랄 1개)
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasLead } from "@/lib/types";
import type { SessionUser } from "@/lib/types";
import PropertyBlock, { type PropRow } from "./PropertyBlock";
import { type ComboProject } from "./ProjectCombo";
import ProjectPicker from "./ProjectPicker";
import { projectButtons } from "@/lib/project-buttons";
import ErrorNote from "./ErrorNote";
import { toast } from "@/lib/quick";
import { durToken, prefersReduced } from "@/lib/motion";
import {
  NEW_TASK_MODAL_EVENT, closeNewTaskModal, currentTaskRef, notifyTaskUpdated,
  openTaskPanel, type NewTaskPrefill,
} from "@/lib/task-panel";

interface Sel {
  actors: { id: number; name: string }[];
  projects: ComboProject[];
  areas: { id: number; name: string; colorKey: string | null }[];
  /**
   * 업무에 붙일 수 있는 목표 — **분기 · 월** 두 층 (§C3 §1).
   *
   * ⚠ 여기는 `monthGoals` 를 읽고 있었다. 그런 필드는 `/api/meta/selectors` 응답에
   * **없다**(`/api/goals` 에만 있다). 그래서 목록이 **언제나 비어 있었고**,
   * 「＋ 목표 연결」을 누르면 늘 「연결 가능한 월 목표가 없습니다」가 떴다.
   * §C3 §1 에서 서버를 넓혔지만 이 화면은 옛 이름을 그대로 보고 있었다.
   */
  linkableGoals: { id: number; title: string; level: string; period: string; when: "past" | "current" | "future" }[];
  /** 내 소속 영역 — **순서가 우선순위다**(`actor_area.sort_order`). 상시 버튼이 이 순서로 선다. */
  myAreaIds: number[];
}

const STATUS = [["todo", "대기"], ["doing", "진행"], ["review", "리뷰"], ["done", "완료"]] as const;
const PRIORITY = [["high", "높음"], ["mid", "보통"], ["low", "낮음"]] as const;
const label = (pairs: readonly (readonly [string, string])[], v: string) =>
  pairs.find(([k]) => k === v)?.[1] ?? v;

interface Draft {
  title: string;
  description: string;
  visibility: "team" | "private";
  projectId: number | null;
  goalIds: number[];
  assigneeId: number;
  status: string;
  priority: string;
  startDate: string;
  dueDate: string;
  areaId: number;
}

function blank(p: NewTaskPrefill, me: number): Draft {
  return {
    title: p.title ?? "",
    description: p.description ?? "",
    // §B1 — 기본은 팀 공개. 메모에서 넘어온 업무만 개인이다.
    visibility: p.visibility ?? "team",
    projectId: p.projectId ?? null,
    goalIds: [],
    assigneeId: p.assigneeId ?? me,
    status: p.status ?? "todo",
    priority: p.priority ?? "mid",
    startDate: p.startDate ?? "",
    dueDate: p.dueDate ?? "",
    areaId: p.areaId ?? 0,
  };
}

export default function NewTaskModal({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<NewTaskPrefill>({});
  const [d, setD] = useState<Draft | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [keepOpen, setKeepOpen] = useState(false);   // "만들고 계속 추가"
  const [made, setMade] = useState(0);                // 연달아 만든 건수 — 계속 추가 흐름의 유일한 피드백
  // §H3 모달 닫힘 — 역방향 애니메이션(--dur-2)이 끝난 뒤에 언마운트한다.
  // 바로 지우면 닫히는 모습이 없다.
  const [closing, setClosing] = useState(false);
  // 고급 접힘. **저장하지 않는다** — 모달이 닫히면 사라지고 다음에 다시 닫힌 채로 뜬다.
  const [adv, setAdv] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  // ── 열림 상태: 이벤트 + URL(?panel=task:new) + 뒤로가기 ──
  useEffect(() => {
    const sync = () => setOpen(currentTaskRef() === "new");
    sync();
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail && typeof detail === "object") { setPrefill(detail.prefill ?? {}); setOpen(true); }
      else setOpen(false);
    };
    window.addEventListener(NEW_TASK_MODAL_EVENT, onEvent);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener(NEW_TASK_MODAL_EVENT, onEvent);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  useEffect(() => {
    if (!open) { setD(null); setErr(""); setMade(0); setKeepOpen(false); setClosing(false); setAdv(false); return; }
    setD(blank(prefill, user.id));
    setErr("");
    // 열 때마다 다시 받는다 — 방금 만든 프로젝트·목표가 후보로 떠야 한다.
    fetch("/api/meta/selectors").then((r) => r.json()).then(setSel).catch(() => {});
  }, [open, prefill, user.id]);

  // 영역 기본값은 selectors 도착 후 채운다 (프리필이 없을 때만)
  useEffect(() => {
    if (open && sel && d && !d.areaId && sel.areas[0]) setD({ ...d, areaId: sel.areas[0].id });
  }, [open, sel, d]);

  /**
   * 프로젝트 기본값 — **1순위 영역의 상시**가 처음부터 눌려 있다 (§B).
   *
   * 「미선택 시 1순위 영역의 상시」를 저장 시점에 몰래 채우지 않는다. 그러면
   * 사람이 무엇을 만들었는지 만든 뒤에야 안다. **눌린 채로 보여 주고 바꿀 수 있게**
   * 한다 — 필수 입력은 여전히 제목 하나이고, 프로젝트는 이미 답이 있는 칸이다.
   *
   * 한 번만 채운다 — 사람이 토글로 벗겨 낸 것을 다시 씌우면 벗길 수가 없다.
   */
  const projectSeeded = useRef(false);
  useEffect(() => { if (!open) projectSeeded.current = false; }, [open]);
  useEffect(() => {
    if (!open || !sel || !d || projectSeeded.current) return;
    projectSeeded.current = true;
    if (d.projectId !== null || d.visibility === "private") return;
    const { defaultId } = projectButtons(sel.projects, sel.myAreaIds ?? [], sel.areas);
    if (defaultId !== null) setD({ ...d, projectId: defaultId });
  }, [open, sel, d]);

  // 열릴 때 제목에 포커스 (§C2)
  useEffect(() => { if (open && d) titleRef.current?.focus(); }, [open, Boolean(d)]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !!d && (d.title.trim() !== "" || d.description.trim() !== "");

  const requestClose = useCallback(() => {
    // 내용이 있으면 확인하고 닫는다 (§C2). 몇 줄 쓴 것을 Esc 한 번으로 날리지 않는다.
    if (dirty && !window.confirm("작성 중인 내용을 버리고 닫을까요?")) return;
    if (prefersReduced()) { closeNewTaskModal(); return; }
    setClosing(true);
    setTimeout(closeNewTaskModal, durToken("--dur-2", 180));
  }, [dirty]);

  async function create() {
    if (!d || busy) return;
    if (!d.title.trim()) { setErr("제목을 입력하세요."); titleRef.current?.focus(); return; }
    setBusy(true); setErr("");
    const res = await fetch("/api/tasks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: d.title.trim(),
        description: d.description,
        areaId: d.areaId || undefined,
        projectId: d.projectId ?? undefined,
        assigneeId: d.assigneeId || undefined,
        visibility: d.visibility,
        status: d.status,
        priority: d.priority,
        startDate: d.startDate || undefined,
        dueDate: d.dueDate || undefined,
        // §A1 — 하위 업무 자리에서 ⌘Enter 로 확장해 온 경우.
        // 프로젝트·영역·공개 범위는 서버가 상위 값으로 덮는다 (§A2) — 여기서 보내도 무시된다.
        parentTaskId: prefill.parentTaskId,
      }),
    }).catch(() => null);
    const body = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) { setBusy(false); setErr(body?.error ?? "업무를 만들지 못했어요"); return; }
    const id: number = body.id;

    // 목표 연결은 생성 직후 PATCH 로 붙인다.
    // POST 에 goalIds 를 새로 받게 하면 개인/팀 목표 교차 금지 규칙(§B3)이 두 벌이 된다.
    // 규칙이 두 벌이면 반드시 한쪽이 낡는다 — 검증된 경로 하나를 그대로 쓴다.
    if (d.goalIds.length > 0 && !prefill.parentTaskId) {
      const g = await fetch(`/api/tasks/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goalIds: d.goalIds }),
      }).catch(() => null);
      if (!g || !g.ok) {
        setBusy(false);
        notifyTaskUpdated();
        // 「연결」을 쓰지 않는다 (§B). 목표 화면의 이름(「목표 미연결 업무」)을 그대로
        // 부르지도 않는다 — 그 화면 이름을 바꾸는 것은 등록 화면의 일이 아니므로,
        // 이름 대신 **어디로 가면 되는지**로 말한다.
        setErr("업무는 만들었지만 목표를 붙이지 못했어요. 업무 상세에서 다시 고르거나, 목표 화면에서 한 번에 붙일 수 있어요.");
        return;
      }
    }
    setBusy(false);
    notifyTaskUpdated();

    if (keepOpen) {
      // 필드만 비운다. 프로젝트·목표·담당은 유지 — 같은 묶음을 연달아 넣는 흐름이다 (§C2).
      setD({ ...d, title: "", description: "" });
      setMade((n) => n + 1);
      titleRef.current?.focus();
      return;
    }
    closeNewTaskModal();
    openTaskPanel(id);   // 만든 것을 바로 보여준다
    toast("업무를 만들었어요");
  }

  // Esc 닫기 · ⌘Enter 저장 (§C2)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); requestClose(); return; }
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void create(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // 의존성을 걸지 않는다 — draft 가 매 입력마다 바뀌고, 핸들러는 항상 최신 값을 봐야 한다

  const goalOptions = useMemo(() => sel?.linkableGoals ?? [], [sel]);

  if (!open || !d) return null;

  const isPrivate = d.visibility === "private";
  const period = d.startDate && d.dueDate ? `${d.startDate} → ${d.dueDate}`
    : d.dueDate ? `~ ${d.dueDate}` : d.startDate ? `${d.startDate} ~` : "";
  const linkedGoalNames = goalOptions.filter((g) => d.goalIds.includes(g.id)).map((g) => g.title);

  const rows: PropRow[] = [
    {
      key: "visibility", label: "공개 범위",
      value: isPrivate ? "개인 (나만 봄)" : "팀 공개",
      editor: (close) => (
        <select autoFocus value={d.visibility}
          onChange={(e) => {
            const v = e.target.value as "team" | "private";
            // 개인으로 바꾸면 프로젝트·담당을 되돌린다 — 서버가 400 을 주기 전에 화면이 먼저 맞춘다.
            setD({ ...d, visibility: v, projectId: v === "private" ? null : d.projectId, assigneeId: v === "private" ? user.id : d.assigneeId });
            close();
          }}>
          <option value="team">팀 공개</option>
          <option value="private">개인 (나만 봄)</option>
        </select>
      ),
    },
    {
      // **「연결」이라는 말을 쓰지 않는다** (§B). 업무는 목표에 **속하는** 것이지
      // 나중에 이어 붙이는 것이 아니다. 등록 화면에서 그 단어가 0건이어야 한다.
      key: "goals", label: "목표",
      value: linkedGoalNames.join(", "), empty: linkedGoalNames.length === 0, action: "＋ 목표 고르기",
      editor: () => (
        <div className="prop-goals">
          {goalOptions.length === 0 && <p className="prop-none">고를 수 있는 목표가 없습니다.</p>}
          {goalOptions.map((g) => (
            <label key={g.id}>
              <input type="checkbox" checked={d.goalIds.includes(g.id)}
                onChange={(e) => setD({
                  ...d,
                  goalIds: e.target.checked ? [...d.goalIds, g.id] : d.goalIds.filter((x) => x !== g.id),
                })} />
              {g.title}<em>{g.level} · {g.period}</em>
            </label>
          ))}
        </div>
      ),
    },
    {
      key: "assignee", label: "담당",
      value: sel?.actors.find((a) => a.id === d.assigneeId)?.name ?? "미지정",
      empty: !d.assigneeId, action: "＋ 담당 지정",
      editor: (close) => (
        <select autoFocus value={d.assigneeId} disabled={isPrivate}
          title={isPrivate ? "개인 업무는 본인 담당입니다" : undefined}
          onChange={(e) => { setD({ ...d, assigneeId: Number(e.target.value) }); close(); }}>
          {sel?.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ),
    },
    {
      key: "status", label: "상태",
      value: <span className={`prop-st st-${d.status}`}>{label(STATUS, d.status)}</span>,
      editor: (close) => (
        <select autoFocus value={d.status}
          onChange={(e) => { setD({ ...d, status: e.target.value }); close(); }}>
          {STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ),
    },
    {
      key: "priority", label: "우선순위",
      value: label(PRIORITY, d.priority),
      editor: (close) => (
        <select autoFocus value={d.priority}
          onChange={(e) => { setD({ ...d, priority: e.target.value }); close(); }}>
          {PRIORITY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      ),
    },
    {
      key: "area", label: "영역",
      value: sel?.areas.find((a) => a.id === d.areaId)?.name ?? "—",
      editor: (close) => (
        <select autoFocus value={d.areaId}
          onChange={(e) => { setD({ ...d, areaId: Number(e.target.value) }); close(); }}>
          {sel?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      ),
    },
  ];

  return (
    <div className={`ntm-bg${closing ? " closing" : ""}`} onMouseDown={(e) => { if (e.target === e.currentTarget) requestClose(); }}>
      <div className="ntm" role="dialog" aria-modal="true" aria-label="새 업무">
        <div className="ntm-head">
          <span className="ntm-crumb">새 업무</span>
          {made > 0 && <span className="ntm-made num">{made}건 만듦</span>}
          <button className="ntm-x" onClick={requestClose} aria-label="닫기">✕</button>
        </div>

        <div className="ntm-body">
          <div className="ntm-main">
            <input
              ref={titleRef}
              className="ntm-title"
              placeholder="무엇을 할까요?"
              value={d.title}
              onChange={(e) => setD({ ...d, title: e.target.value })}
            />

            {/* ── 프로젝트 — 드롭다운이 아니라 버튼이다 (§B) ──
                열고·읽고·고르고·닫는 네 동작이 아무도 안 고르게 만들었다.
                버튼은 한 동작이고, 무엇이 있는지 열기 전에 보인다. */}
            <div className="ntm-f">
              <span className="ntm-fl">프로젝트</span>
              <ProjectPicker
                projects={sel?.projects ?? []}
                myAreaIds={sel?.myAreaIds ?? []}
                areas={sel?.areas ?? []}
                value={d.projectId}
                onChange={(id) => setD({ ...d, projectId: id })}
                disabled={isPrivate}
                disabledNote="개인 업무는 프로젝트에 넣지 않습니다"
                canCreate={hasLead(user.role)}
                onCreated={(p) => setSel((s) => (s ? { ...s, projects: [...s.projects, p] } : s))}
              />
            </div>

            {/* ── 기간 — 옆 속성 줄에서 앞으로 끌어올렸다 ──
                언제까지인지는 나중에 채우는 값이 아니라 **적을 때 아는 값**이다.
                뒤에 두면 기한 없는 업무가 쌓이고, 그러면 지연을 셀 수 없다. */}
            <div className="ntm-f">
              <span className="ntm-fl">기간</span>
              <div className="ntm-when">
                <input type="date" aria-label="시작" value={d.startDate}
                  onChange={(e) => setD({ ...d, startDate: e.target.value })} />
                <span className="ntm-tilde">–</span>
                <input type="date" aria-label="마감" value={d.dueDate}
                  onChange={(e) => setD({ ...d, dueDate: e.target.value })} />
                {!period && <span className="ntm-off">비워 두면 기한 없음</span>}
              </div>
            </div>
            {/* 본문 — 문서형 편집기의 축약본이다 (§C1).
                슬래시 명령·임베드는 없다. 아직 존재하지 않는 업무에는 붙일 문서가 없고,
                링크 카드를 언퍼할 대상도 없다. 서식만 남긴다. */}
            <NoteEditor
              value={d.description}
              onChange={(v) => setD({ ...d, description: v })}
              onSubmit={create}
            />
          </div>

          {/* ── 고급 — **언제나 닫힌 채로 시작한다** ──
              열린 상태를 기억하지 않는다. 한 번 연 사람이 계속 열린 채로 보면
              네 칸으로 줄인 의미가 없다. 고급은 예외 경로이고,
              **예외가 기본이 되면 그건 더 이상 예외가 아니다.** */}
          {adv && (
            <aside className="ntm-side" aria-label="고급 속성">
              <PropertyBlock rows={rows} collapseAfter={rows.length} />
            </aside>
          )}
        </div>

        {err && <div className="ntm-err"><ErrorNote message={err} /></div>}

        <div className="ntm-foot">
          <button className="btn-ghost" onClick={requestClose}>취소</button>
          <button type="button" className={`ntm-adv${adv ? " on" : ""}`}
            aria-expanded={adv} onClick={() => setAdv((v) => !v)}>
            고급
          </button>
          <span className="gsp" />
          <label className="ntm-keep">
            <input type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
            만들고 계속 추가
          </label>
          <button className="btn-primary" onClick={create} disabled={busy || !d.title.trim()}>
            {busy ? "만드는 중…" : "만들기"}
            <em className="ntm-kbd">⌘↵</em>
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 본문 편집기 — 서식만 있는 축약판 (§C1).
 * 마크다운 문자열 하나를 다룬다. 툴바 버튼은 선택 영역을 감싸거나 줄머리를 붙일 뿐이다.
 * 새 저장 규칙·새 블록 모델을 만들지 않는다 — 업무가 생기고 나면 DocEditor 가 이어받는다.
 */
const MARKS: { key: string; label: string; title: string; wrap?: [string, string]; line?: string }[] = [
  { key: "b", label: "B", title: "굵게", wrap: ["**", "**"] },
  { key: "i", label: "I", title: "기울임", wrap: ["_", "_"] },
  { key: "code", label: "‹›", title: "코드", wrap: ["`", "`"] },
  { key: "ul", label: "•", title: "목록", line: "- " },
  { key: "todo", label: "☐", title: "체크리스트", line: "- [ ] " },
  { key: "quote", label: "❝", title: "인용", line: "> " },
];

function NoteEditor({ value, onChange, onSubmit }: {
  value: string; onChange: (v: string) => void; onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(m: (typeof MARKS)[number]) {
    const el = ref.current;
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    let next = value, caret = e;
    if (m.wrap) {
      next = value.slice(0, s) + m.wrap[0] + value.slice(s, e) + m.wrap[1] + value.slice(e);
      caret = e + m.wrap[0].length + m.wrap[1].length;
    } else if (m.line) {
      // 줄머리는 선택된 줄들 앞에 붙인다. 커서만 있으면 그 줄 하나.
      const from = value.lastIndexOf("\n", s - 1) + 1;
      const to = value.indexOf("\n", e) === -1 ? value.length : value.indexOf("\n", e);
      const body = value.slice(from, to).split("\n").map((l) => m.line + l).join("\n");
      next = value.slice(0, from) + body + value.slice(to);
      caret = from + body.length;
    }
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(caret, caret); });
  }

  return (
    <div className="ntm-note">
      <div className="ntm-tools" role="toolbar" aria-label="서식">
        {MARKS.map((m) => (
          <button key={m.key} type="button" className="ntm-tool" title={m.title}
            onMouseDown={(e) => e.preventDefault()} onClick={() => apply(m)}>
            {m.label}
          </button>
        ))}
      </div>
      <textarea
        ref={ref}
        className="ntm-desc"
        value={value}
        placeholder="특이사항 — 무엇을, 왜, 어디까지 하면 끝인지"
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
        }}
      />
    </div>
  );
}
