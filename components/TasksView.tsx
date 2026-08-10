"use client";

// 업무 화면 (Phase 5) — 인박스(에이전트 제안) + 필터 목록 + 상세 편집.
// 목록 테이블은 홈 "마감 임박"과 동일한 TaskTable을 재사용한다 (검수 포인트 6).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import type { UserDefaults } from "@/lib/user-defaults";
import TaskTable, { type TaskTableRow, type TaskGroupKey, TASK_GROUP_LABEL } from "./TaskTable";
import Skeleton from "./Skeleton";
import { notifySavedViewsChanged } from "@/lib/saved-views-events";
import ErrorNote from "./ErrorNote";
import PageShell from "./PageShell";
import TaskBoard from "./TaskBoard";
import TaskCalendar from "./TaskCalendar";
import TaskGantt from "./TaskGantt";
import { toast } from "@/lib/quick";
import {
  type TaskItem, type TaskLens, type BoardGroup, LENS_LABEL, GROUP_LABEL, dueLabel,
} from "@/lib/task-view";
import { openTaskPanel, openNewTaskModal, TASK_UPDATED_EVENT } from "@/lib/task-panel";
import InlineTaskInput from "./InlineTaskInput";
import { monthRange } from "@/lib/task-bars";
import { useListQuery, type ParamSpec } from "@/lib/use-list-query";
import BulkBar from "./BulkBar";
import ProjectCombo from "./ProjectCombo";

interface AreaOption {
  id: number;
  name: string;
  colorKey: string | null;
}

interface ProjectOption {
  id: number;
  name: string;
  colorKey: string | null;
  areaId: number;
}

interface InboxItem {
  id: number;
  title: string;
  description: string;
  projectName: string | null;
  colorKey: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  dueDate: string | null;
  createdByName: string | null;
}

interface Option {
  id: number;
  name: string;
}

interface MonthGoalOption {
  id: number;
  title: string;
  month: string; // YYYY-MM
}

const STATUS_OPTIONS = [
  ["", "전체 상태"],
  ["todo", "대기"],
  ["doing", "진행"],
  ["review", "리뷰"],
  ["done", "완료"],
  ["dropped", "중단"],
] as const;

const DUE_OPTIONS = [
  ["", "전체 기한"],
  ["overdue", "지연"],
  ["7d", "7일 이내"],
  ["30d", "30일 이내"],
  ["none", "기한 없음"],
] as const;

/** 정렬 기준 (MD-P-2026-018 §D) — 기본은 기한순. 선택은 사용자별로 기억한다. */
/**
 * 정렬 — **네 종뿐이다** (031 §C 회신 제1부 §3). 이름은 서버 `ORDER_BY` 와 같다.
 * 정렬은 전부 서버에서 걸린다. 여기서 다시 정렬하지 않는다 —
 * 클라이언트가 다시 정렬하면 `LIMIT 300` 으로 자른 **뒤**를 정렬하게 되고,
 * 300건을 넘는 순간 1페이지의 첫 행이 전체의 첫 행이 아니게 된다.
 */
type SortKey = "due" | "priority" | "created" | "manual";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "due", label: "기한순" },
  { key: "priority", label: "우선순위순" },
  { key: "created", label: "최신 작성순" },
  // §C1 — 이 값일 때만 드래그가 된다. 이름은 "수동 순서" 가 아니라 **"직접 정한 순서"** 다:
  //   목표 진척에 이미 "수동 입력" 이 있어, 같은 단어가 두 개념을 가리키면 안 된다 (§B 회신 [확정]).
  { key: "manual", label: "직접 정한 순서" },
];
const SORT_DEFAULT: SortKey = "due";

/**
 * 목록 초기값 — **주소 · 저장값 · 기본값을 `useListQuery()` 하나가 읽는다** (§C 회신 4).
 *
 * 여기 적힌 것이 전부다. 읽는 순서도, 매핑도, 주소에 쓸지 말지도 훅이 정한다.
 * 파라미터가 늘어도 늘어나는 것은 이 표의 한 줄이지 컴포넌트의 조건문이 아니다 —
 * 「중간 상태도 상태다」가 두 번 다 **초기값이 하나 늘어난 순간**에 났다.
 *
 * `sort` 의 옛 값 두 개:
 * - `recent` 는 이름만 바뀐 같은 기능이라 **조용히** 옮긴다.
 * - `progress` 는 기능이 없어진 것이라 **한 번은 말한다.** 아무 말 없이 바뀌면 고장으로 읽힌다.
 */
const tasksQuery = ((assigneeId: number) => ({
  /**
   * 담당 — 기본값은 **본인**이고, 그 값은 서버가 준다(`lib/user-defaults.ts`).
   * 기본값이라 주소에 안 쓴다. 예전에는 `?assignee=1` 이 늘 붙어 있었다.
   *
   * `all` 은 「전체 담당」이다. 빈 문자열을 쓰지 않는 이유는 B-12 그대로 —
   * `?assignee=` 라는 껍데기는 "지정 안 함"과 구별되지 않는다.
   * 담당은 **저장하지 않는다**(`store` 없음). 오늘 누구 것을 보느냐는 취향이 아니다.
   */
  assignee: { def: String(assigneeId), test: (v: string) => v === "all" || /^[1-9]\d*$/.test(v) },
  sort: {
    def: SORT_DEFAULT,
    values: SORT_OPTIONS.map((o) => o.key),
    store: "tb:tasks-sort",
    alias: { recent: "created", progress: "due" },
    gone: ["progress"],
  },
  // 저장 키는 보드 묶기(`tb:tasks-group`)와 갈라 쓴다 — 뜻이 다른 값이 한 칸을 쓰면 섞인다.
  group: { def: "none", values: Object.keys(TASK_GROUP_LABEL), store: "tb:list-group" },
  done: { def: "0", values: ["0", "1"], store: "tb:tasks-done" },
})) satisfies (n: number) => Record<string, ParamSpec>;

type TasksQueryKey = keyof ReturnType<typeof tasksQuery>;

export default function TasksView({ user, defaults, initialAreas, initial }: {
  user: SessionUser;
  /** 사용자 속성으로서의 기본값 — 서버가 매 요청 읽는다(`lib/user-defaults.ts`). */
  defaults: UserDefaults;
  /** 서버가 정한 첫 영역 필터. 주소 > (넓게 여는 진입이면 전체 / 아니면 내 기본 영역). */
  initialAreas: number[];
  /** 서버가 읽은 주소 쿼리 — 훅이 첫 렌더부터 맞는 값을 쓰게 한다. */
  initial?: Partial<Record<TasksQueryKey, string>>;
}) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [actors, setActors] = useState<Option[]>([]);
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [areas, setAreas] = useState<AreaOption[]>([]);
  const [monthGoals, setMonthGoals] = useState<MonthGoalOption[]>([]);
  const [linkGoals, setLinkGoals] = useState<{ id: number; title: string }[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // 필터 (영역 · 프로젝트 · 상태 · 기한). 담당·영역 기본값은 **서버가 준다**(훅 / initialAreas).
  //
  // 영역은 **여러 개**를 고를 수 있다 (MD-P-2026-027 §B2).
  // 사이드바에서 영역 7개를 내리고 여기 칩으로 옮겼다 — 사이드바는 "어디로 갈까"이고
  // 영역은 "무엇을 볼까"라서 필터가 맞는 자리다.
  // URL 은 `?area=2,3` 으로 쓴다. 링크로 공유·북마크된다.
  // 첫 값은 **서버가 정해서 내려준다.** 예전에는 빈 배열로 시작해 `/api/meta/selectors`
  // 응답을 받은 뒤 이펙트가 채웠고, 그동안 "영역이 정해졌는가"를 세는 게이트가 필요했다.
  const [fAreas, setFAreas] = useState<number[]>(initialAreas);
  const fArea = fAreas.length === 1 ? String(fAreas[0]) : "";   // 새 업무 프리셋용 (하나일 때만 의미가 있다)
  const areaParam = fAreas.join(",");
  const [fProject, setFProject] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fDue, setFDue] = useState("");
  const [fBlocked, setFBlocked] = useState(false);
  const [fBlocking, setFBlocking] = useState(false);   // §C1 「내가 막는 것」 // 홈 5칸 진입(?blocked=1)
  /**
   * 완료 표시 · 정렬 · 묶기 — 셋 다 훅이 읽는다. 기본은 "완료 제외 + 기한순 + 묶지 않음".
   *
   * `lq.ready` 가 거짓인 동안에는 목록을 **부르지 않는다.** 정렬이 서버로 넘어갔으므로,
   * 초기값을 모른 채 한 번 부르면 기본 정렬로 받고 곧바로 다시 부르게 된다 —
   * 요청이 두 번 나가고, 그 사이에 **틀린 순서가 화면에 보인다.**
   * (드래그 정렬 검사가 이 짧은 순간을 잡아냈다. 잠깐이라도 보이면 사용자도 본다.)
   */
  const spec = useMemo(() => tasksQuery(defaults.assigneeId), [defaults.assigneeId]);
  const lq = useListQuery(spec, initial);
  const sortBy = lq.value.sort as SortKey;
  const listGroup = lq.value.group as TaskGroupKey;
  const showDone = lq.value.done === "1";
  // 담당 — 주소·상태는 `all`, API 로 나갈 때만 빈 문자열이다(서버는 빈 값을 "전체"로 읽는다).
  const fAssignee = lq.value.assignee === "all" ? "" : lq.value.assignee;
  // 진척순이 없어졌다는 안내 — 세션당 1회. 닫으면 다시 안 뜬다.
  const sortGone = lq.dropped.includes("sort");
  const isMine = lq.value.assignee === String(user.id);

  // 새 업무 — 등록 모달 (MD-P-2026-027 §C). 지금 필터(영역·담당)를 프리셋으로 물려준다.
  const quickNew = useCallback(() => {
    openNewTaskModal({ areaId: fArea ? Number(fArea) : undefined, assigneeId: isMine ? user.id : undefined });
  }, [fArea, isMine, user.id]);

  // ── §D3 다중 선택 → 프로젝트 일괄 지정 ──
  // 일괄 지정 줄은 목표 미연결 화면이 쓰던 BulkBar 를 그대로 쓴다. 새로 만들지 않는다.
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [bulkProject, setBulkProject] = useState<number | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const toggleCheck = useCallback((id: number) => setChecked((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  }), []);

  async function assignProject() {
    const ids = Array.from(checked);
    if (ids.length === 0 || bulkBusy) return;
    setBulkBusy(true);
    let ok = 0;
    const failed: string[] = [];
    for (const id of ids) {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: bulkProject }),
      }).catch(() => null);
      if (res && res.ok) ok += 1;
      else failed.push(String((res && (await res.json().catch(() => ({}))).error) || "실패"));
    }
    setBulkBusy(false);
    setChecked(new Set());
    // 몇 건이 왜 안 됐는지 말한다. 개인 업무는 프로젝트에 못 들어가므로 실제로 갈린다.
    if (ok === 0) toast(failed[0] ?? "지정하지 못했어요", "err");
    else if (failed.length > 0) toast(`${ok}건 지정 · ${failed.length}건 실패 — ${failed[0]}`, "err");
    else toast(bulkProject === null ? `${ok}건의 프로젝트 연결을 해제했어요` : `${ok}건을 프로젝트에 지정했어요`);
    load();
  }

  /**
   * 지금 필터를 저장된 뷰로 만든다 (§B3).
   * 저장하는 것은 **URL 에 담기는 조건 그대로**다 — 그래야 뷰를 눌렀을 때
   * 지금 화면과 같은 것이 뜬다. 화면 상태와 저장 형식이 다르면 반드시 어긋난다.
   */
  const [savingView, setSavingView] = useState(false);
  async function saveCurrentView() {
    const name = window.prompt("이 조건에 붙일 이름")?.trim();
    if (!name) return;
    setSavingView(true);
    const filters: Record<string, string> = {};
    if (areaParam) filters.area = areaParam;
    if (fProject) filters.project = fProject;
    // 저장할 때도 "전체 담당"을 명시한다. 빼먹으면 복원 시 기본값(본인)으로 돌아가
    // 저장한 것과 다른 화면이 뜬다.
    filters.assignee = fAssignee || "all";
    if (fStatus) filters.status = fStatus;
    if (fDue) filters.due = fDue;
    if (fBlocked) filters.blocked = "1";
    if (sortBy !== "due") filters.sort = sortBy;
    if (showDone) filters.done = "1";
    const res = await fetch("/api/saved-views", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, target: "tasks", filters }),
    }).catch(() => null);
    setSavingView(false);
    const d = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) { toast(d?.error ?? "저장하지 못했어요", "err"); return; }
    notifySavedViewsChanged();
    toast(`"${name}" 뷰를 저장했어요`);
  }

  /** 영역 칩 토글. 다중 선택이고, 전부 끄면 "전체 영역"이다. */
  function toggleArea(id: number) {
    setFAreas((cur) =>(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id].sort((a, b) => a - b)));
  }

  // 뷰(렌즈) 전환 — 마지막 뷰·그룹 기준 기억(localStorage)
  const [lens, setLens] = useState<TaskLens>("sheet");
  const [boardGroup, setBoardGroup] = useState<BoardGroup>("status");
  useEffect(() => {
    const v = localStorage.getItem("tb:tasks-lens") as TaskLens | null;
    if (v && ["sheet", "board", "calendar", "timeline"].includes(v)) setLens(v);
    const g = localStorage.getItem("tb:tasks-group") as BoardGroup | null;
    if (g && ["status", "area", "assignee"].includes(g)) setBoardGroup(g);
    // 정렬·묶기·완료 포함은 여기서 읽지 않는다 — `useListQuery()` 하나가 읽는다.
    // 뷰(렌즈)와 보드 그룹은 주소에 안 실리는 값이라 그대로 localStorage 만 본다.
  }, []);

  function pickSort(v: SortKey) { lq.set("sort", v); }
  function toggleDone(v: boolean) { lq.set("done", v ? "1" : "0"); }
  function pickLens(v: TaskLens) { setLens(v); localStorage.setItem("tb:tasks-lens", v); }
  function pickGroup(g: BoardGroup) { setBoardGroup(g); localStorage.setItem("tb:tasks-group", g); }

  const load = useCallback(async () => {
    // 초기값이 다 정해지기 전에는 안 부른다. **조건은 이제 하나다** —
    // 영역·담당은 서버가 첫 렌더에 정해서 내려주므로 기다릴 것이 없다.
    // (예전에는 `areaDefaulted` 라는 게이트가 하나 더 있었다. 화면이 넷이 되면
    //  네 곳으로 복제될 조건이었다.)
    if (!lq.ready) return;
    try {
      const qs = new URLSearchParams();
      if (areaParam) qs.set("area", areaParam);
      if (fProject) qs.set("project", fProject);
      if (fAssignee) qs.set("assignee", fAssignee);
      if (fStatus) qs.set("status", fStatus);
      if (fDue) qs.set("due", fDue);
      if (fBlocked) qs.set("blocked", "1");
      if (fBlocking) qs.set("blocking", "1");
      // 정렬도 서버가 건다 — LIMIT 이 정렬 뒤에 걸려야 1페이지가 전체의 첫 페이지가 된다.
      if (sortBy !== SORT_DEFAULT) qs.set("sort", sortBy);
      const res = await fetch(`/api/tasks?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "업무 조회 실패");
      setTasks(data.tasks ?? []);
      setInbox(data.inbox ?? []);
      setToday(data.today ?? "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "오류");
    } finally {
      setLoading(false);
    }
  }, [areaParam, fProject, fAssignee, fStatus, fDue, fBlocked, fBlocking, sortBy, lq.ready]);

  // 셀렉트 룩업은 목록과 분리된 /api/meta/selectors에서 (Phase 8 D-3)
  const loadSelectors = useCallback(async () => {
    const res = await fetch("/api/meta/selectors");
    const data = await res.json();
    if (res.ok) {
      setActors(data.actors ?? []);
      setProjects(data.projects ?? []);
      setAreas(data.areas ?? []);
      // `myAreaIds` 는 더 읽지 않는다 — 영역 기본값은 서버가 첫 렌더에 정한다.
      // (`/api/meta/selectors` 응답에는 그대로 있다. 다른 화면이 쓴다.)
      setMonthGoals(data.monthGoals ?? []);
      setLinkGoals(data.linkGoals ?? []);
    }
  }, []);

  /**
   * 홈 진입 필터(`?status` · `?due` · `?blocked` · `?blocking`) — 주소에서 한 번 읽는다.
   *
   * 예전에는 이 이펙트가 담당과 영역까지 손댔다(`setFAssignee("")` · `setAreaDefaulted(true)`).
   * 그래서 첫 렌더는 내 담당 · 내 영역, 확정 렌더는 전체 담당 · 전체 영역이었다.
   * **그 판단은 이제 서버가 한다**(`app/tasks/page.tsx`) — 여기서는 필터 값만 받는다.
   */
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const st = sp.get("status");
    const du = sp.get("due");
    if (st) setFStatus(st);
    if (du) setFDue(du);
    if (sp.get("blocked") === "1") setFBlocked(true);
    if (sp.get("blocking") === "1") setFBlocking(true);
    // 마운트 1회
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    loadSelectors();
  }, [loadSelectors]);

  // 상세 패널에서 업무가 바뀌면 목록 재동기화
  useEffect(() => {
    const onUpd = () => load();
    window.addEventListener(TASK_UPDATED_EVENT, onUpd);
    return () => window.removeEventListener(TASK_UPDATED_EVENT, onUpd);
  }, [load]);

  async function judgeInbox(item: InboxItem, approve: boolean) {
    const res = await fetch(`/api/tasks/${item.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: approve ? "todo" : "dropped" }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "처리 실패");
      return;
    }
    load();
  }

  // 인라인 상태 변경 (목록에서 즉시). 권한 규칙은 서버가 유지. 중단은 사유가 필요해 제외.
  async function changeStatus(id: number, status: string) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "상태 변경 실패");
      return;
    }
    load();
  }

  // 목표 이름 조회 — 월 목표만 보면 분기·연간 목표에 연결된 업무가 링크가 있는데도
  // "—" 로 보인다. 전 레벨 목록(linkGoals)을 먼저 보고 없으면 월 목표로 떨어진다
  // (MD-P-2026-018 §F).
  const goalTitleOf = useCallback(
    (id: number) => linkGoals.find((g) => g.id === id)?.title ?? monthGoals.find((g) => g.id === id)?.title,
    [linkGoals, monthGoals]
  );

  // 보드 드래그 → 기준값 변경 (낙관적 반영 + 실패 시 롤백, 토스트)
  async function moveTask(id: number, patch: Record<string, unknown>) {
    const prev = tasks;
    setTasks((cur) => cur.map((t) => {
      if (t.id !== id) return t;
      const next = { ...t };
      if ("status" in patch) next.status = patch.status as string;
      if ("areaId" in patch) { next.areaId = patch.areaId as number; next.areaName = areas.find((a) => a.id === patch.areaId)?.name ?? t.areaName; }
      if ("assigneeId" in patch) { next.assigneeId = (patch.assigneeId as number | null) ?? null; next.assigneeName = actors.find((a) => a.id === patch.assigneeId)?.name ?? null; }
      return next;
    }));
    toast("옮겼어요");
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setTasks(prev);
      toast((await res.json().catch(() => ({}))).error ?? "이동에 실패했어요", "err");
    } else {
      load();
    }
  }

  // 검색·완료필터·정렬이 적용된 업무 목록 — 모든 렌즈가 공유 (MD-P-2026-018 §D)
  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (t: TaskItem) =>
      (showDone || (t.status !== "done" && t.status !== "dropped")) &&
      (!q ||
        t.title.toLowerCase().includes(q) ||
        (t.projectName ?? "").toLowerCase().includes(q) ||
        (t.assigneeName ?? "").toLowerCase().includes(q));

    // §A3 — **하위 행은 필터·정렬의 대상이 아니다.**
    //   상위가 걸리면 따라 나오고, 하위만 걸리면 상위를 살려서 보여준다.
    //   서버가 목록 필터에 대해 같은 처리를 하고(재귀), 여기서는 화면 쪽 필터
    //   (검색어·완료 숨김)에 대해 같은 규칙을 적용한다. 한쪽만 하면 규칙이 갈린다.
    //   완료한 하위를 숨기면 "2건 중 1건 완료"인데 펼치면 1건만 보인다.
    const hit = new Set(tasks.filter(match).map((t) => t.id));
    const keep = new Set(hit);
    for (const t of tasks) {
      const p = t.parentTaskId ?? null;
      if (p !== null && hit.has(p)) keep.add(t.id);   // 상위가 걸림 → 하위도 남긴다
      if (p !== null && hit.has(t.id)) keep.add(p);   // 하위만 걸림 → 상위를 살린다
    }
    const out = tasks.filter((t) => keep.has(t.id));

    // **여기서 정렬하지 않는다.** 서버가 정렬해서 보낸 순서를 그대로 쓴다 (§C2-정렬).
    // 걸러내기만 한다 — 걸러내기는 순서를 안 바꾼다.
    return out;
  }, [tasks, search, showDone]);

  // 필터를 URL 에 반영해 링크로 공유할 수 있게 한다 (MD-P-2026-018 §D).
  // history 를 쌓지 않는다 — 뒤로가기가 필터 변경 이력으로 채워지면 화면을 벗어날 수 없다.
  //
  // **정렬 · 묶기 · 완료 포함 · 담당은 여기서 쓰지 않는다.** 훅이 쓴다.
  // 한 파라미터를 두 곳에서 쓰면 둘 중 어느 쪽이 마지막이었는지에 따라 주소가 달라진다.
  useEffect(() => {
    if (loading) return;
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => (v ? sp.set(k, v) : sp.delete(k));
    set("area", areaParam || null);
    set("project", fProject || null);
    set("status", fStatus || null);
    set("due", fDue || null);
    set("blocked", fBlocked ? "1" : null);
    set("blocking", fBlocking ? "1" : null);
    const qs = sp.toString();
    window.history.replaceState({}, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, [loading, areaParam, fProject, fStatus, fDue, fBlocked, fBlocking]);

  /**
   * §C — 보이는 행의 새 순서를 서버에 보낸다.
   *
   * **전역 sort_order 정리는 서버가 한다.** 필터가 걸려 있으면 화면에 없는 형제가
   * 사이사이에 있는데, 화면이 그것까지 계산하려 들면 필터마다 다른 답을 낸다 (§C3).
   */
  const reorder = useCallback(async (parentTaskId: number | null, orderedIds: number[]) => {
    const res = await fetch("/api/tasks/reorder", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentTaskId, orderedIds }),
    }).catch(() => null);
    if (!res || !res.ok) {
      toast((res && (await res.json().catch(() => ({})))?.error) || "순서를 저장하지 못했어요", "err");
    }
    await load();
  }, [load]);

  const rows: TaskTableRow[] = useMemo(() => {
    return filteredTasks
      .map((t) => {
        const d = dueLabel(t, today);   // 완료면 "완료 YYYY-MM-DD" (§E)
        return {
          id: t.id,
          title: t.title,
          projectName: t.projectName,
          colorKey: t.colorKey,
          assigneeName: t.assigneeName,
          status: t.status,
          priority: t.priority,
          areaName: t.areaName,
          // 28-a — 서버가 이미 taskProgress() 를 통과시킨 **실효 진척**을 준다.
          //   여기서 다시 셈하지 않는다. 두 번 셈하면 계산기가 둘이 된다.
          progress: t.progress,
          goalNames: t.goalIds.map(goalTitleOf).filter((x): x is string => !!x),
          dday: d.text,
          overdue: d.overdue && t.status !== "done" && t.status !== "dropped",
          blocked: t.blocked,
          blockedReason: t.blockedReason,
          blockedBy: t.blockedBy ?? null,   // §B3 칩에서 원인으로 이동
          visibility: t.visibility,   // §B2 "개인" 칩
          parentTaskId: t.parentTaskId ?? null,   // §A3 계층
          sortOrder: t.sortOrder ?? 0,
          childCount: t.childCount ?? 0,
          // §C2 막대 재료. 둘 다 없으면 막대를 안 그린다 — 없는 기간을 추정하지 않는다.
          startDate: t.startDate,
          dueDate: t.dueDate,
        };
      });
  }, [filteredTasks, today, goalTitleOf]);

  /**
   * 전체 빈 상태가 떠 있는가 (MD-P-2026-026 §A).
   * 그때는 빈 상태 안의 CTA 가 헤더 액션과 **같은 동작**을 한다.
   * 코랄 버튼을 둘 두면 어느 것이 지금 할 일인지 알 수 없다 (§B 주 액션 1개).
   */
  const emptyNow = !loading && !error && lens === "sheet" && rows.length === 0;

  const hiddenDone = tasks.filter((t) => t.status === "done" || t.status === "dropped").length;

  return (
    /* 페이지 뼈대는 공통 컴포넌트가 그린다 (MD-P-2026-019 §B) —
       브레드크럼 → 제목+액션 → 탭 → 필터바 → 본문 순서를 화면마다 다시 짜지 않는다. */
    <PageShell
      crumb={["워크스페이스", "업무"]}
      title={isMine ? "내 업무" : "업무"}
      subtitle={isMine
        ? "담당이 나인 업무만 보고 있습니다. 담당을 ‘전체 담당’으로 바꾸면 전체를 조회합니다."
        : "에이전트 제안은 인박스에서 승인해야 목록·홈·캘린더에 반영됩니다."}
      // 코랄 채움은 화면당 1개다 (§B).
      //  · 전체 빈 상태가 떠 있으면 그 안의 CTA 가 같은 동작을 한다 → 헤더는 숨긴다
      //  · 일괄 지정 줄이 떠 있으면 지금의 주 액션은 "선택 업무에 지정" 이다 → 헤더는 숨긴다
      actions={emptyNow || checked.size > 0 ? undefined : <button className="btn-primary" onClick={quickNew}>＋ 새 업무</button>}
      tabs={(["sheet", "board", "calendar", "timeline"] as TaskLens[]).map((v) => ({ key: v, label: LENS_LABEL[v] }))}
      activeTab={lens}
      onTab={(k) => pickLens(k as TaskLens)}
      filters={
        <>
          <input className="tsearch" placeholder="업무·프로젝트·담당 검색"
            value={search} onChange={(e) => setSearch(e.target.value)} />
          {/* 영역 칩 — 다중 선택. 색 점은 사이드바에서 쓰던 영역 색을 그대로 쓴다 (§B2) */}
          <button className={`pg-chip${fAreas.length === 0 ? " on" : ""}`}
            onClick={() => setFAreas([])}>전체 영역</button>
          {areas.map((a) => (
            <button key={a.id} className={`pg-chip area-chip${fAreas.includes(a.id) ? " on" : ""}`}
              aria-pressed={fAreas.includes(a.id)} onClick={() => toggleArea(a.id)}>
              <i className={`pjdot ${a.colorKey ?? "team"}`} />
              {a.name}
            </button>
          ))}
          {/* 값은 `all`/`<id>` 다. 빈 문자열을 쓰지 않는다 — 주소에 껍데기가 남는다(B-12). */}
          <select value={lq.value.assignee} aria-label="담당"
            onChange={(e) => lq.set("assignee", e.target.value)}>
            <option value="all">전체 담당</option>
            {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {/* §C1 — 잡히지 않는 핸들을 보여주면 고장으로 읽힌다. 대신 어떻게 켜는지 말한다. */}
          {sortBy !== "manual" && (
            <span className="dragoff">순서를 바꾸려면 정렬을 &lsquo;직접 정한 순서&rsquo;로 바꾸세요</span>
          )}
          <select value={listGroup} aria-label="묶는 기준"
            onChange={(e) => lq.set("group", e.target.value)}>
            {(Object.keys(TASK_GROUP_LABEL) as TaskGroupKey[]).map((k) => (
              <option key={k} value={k}>{k === "none" ? "묶지 않음 (기본)" : `${TASK_GROUP_LABEL[k]}로 묶기`}</option>
            ))}
          </select>
          <select value={sortBy} onChange={(e) => pickSort(e.target.value as SortKey)} aria-label="정렬 기준">
            {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}{o.key === SORT_DEFAULT ? " (기본)" : ""}</option>)}
          </select>
          {/* 진척순이 없어졌다 — **조용히 떨어뜨리되 흔적은 남긴다.** 세션당 1회.
              이름만 바뀐 `recent → created` 와 다르다. 저건 같은 기능이고 이건 사라진 기능이다. */}
          {sortGone && (
            <span className="sortgone" role="status">
              진척순 정렬은 지금 제공하지 않습니다 — 기한순으로 표시합니다
              <button type="button" onClick={() => lq.dismiss("sort")} aria-label="안내 닫기">✕</button>
            </span>
          )}
          <button className={`pg-chip${showDone ? " on" : ""}`} onClick={() => toggleDone(!showDone)}>
            완료 포함
          </button>
          {/* 지금 조건에 이름을 붙여 저장한다 (§B3). 저장된 뷰는 「내 공간」 아래 핀으로 붙는다.
              버튼이 아니라 텍스트 링크다 — 화면의 주 액션이 아니다. */}
          <button className="lk tv-savefilter" onClick={saveCurrentView} disabled={savingView}>
            이 조건 저장
          </button>
        </>
      }
      filterSummary={`${filteredTasks.length}건${!showDone && hiddenDone > 0 ? ` · 완료 ${hiddenDone}건 숨김` : ""}`}
    >
      <div className="hv tv-legacy">
      <div className="wrap">

        {/* 인박스 — status='proposed' 전용 노출 위치 (홈·캘린더·타임라인 제외) */}
        {inbox.length > 0 && (
          <section className="card tinbox" aria-label="인박스">
            <div className="ch">
              <h2>인박스</h2>
              <span className="sub">에이전트 제안 {inbox.length}건 — 승인 시 업무로 전환</span>
            </div>
            {inbox.map((item) => (
              <div key={item.id} className="tinbox-row">
                <span className="st prop">제안</span>
                <div className="tinbox-b">
                  <b>{item.title}</b>
                  <em>
                    {[item.createdByName, item.projectName, item.assigneeName && `${item.assigneeName} 담당`, item.dueDate]
                      .filter(Boolean)
                      .join(" · ")}
                  </em>
                </div>
                <span className="gsp" />
                <button className="lk" onClick={() => judgeInbox(item, true)}>
                  승인
                </button>
                <button className="lk mu" onClick={() => judgeInbox(item, false)}>
                  기각
                </button>
              </div>
            ))}
          </section>
        )}

        {/* 보드 그룹 기준만 남긴다 — 뷰 탭·정렬·완료 포함은 페이지 뼈대(PageShell)로 올렸다 */}
        {lens === "board" && (
          <div className="lens-bar">
            <div className="lens-group" role="group" aria-label="그룹 기준">
              <span className="lens-group-l">그룹</span>
              {(["status", "area", "assignee"] as BoardGroup[]).map((g) => (
                <button key={g} className="lens-gbtn" aria-pressed={boardGroup === g} onClick={() => pickGroup(g)}>
                  {GROUP_LABEL[g]}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && <Skeleton variant="list" />}
        {error && <ErrorNote message="업무를 불러오지 못했어요" cause={error} onRetry={load} />}
        {!loading && !error && lens === "sheet" && (
          <>
            {/* §C3 — 목록 맨 위 한 줄 입력. Enter 즉시 생성, ⌘Enter 모달 확장.
                빠른 입력을 없애지 않는다. 대부분의 업무는 제목 한 줄이면 충분하다. */}
            <InlineTaskInput
              prefill={{ areaId: fArea ? Number(fArea) : undefined, assigneeId: isMine ? user.id : undefined }}
              onCreated={load}
            />
            {/* §D3 — 체크한 업무의 프로젝트를 한 번에 지정한다.
                고른 것이 없으면 줄 자체를 그리지 않는다 — 늘 떠 있으면 목록이 밀린다. */}
            {checked.size > 0 && (
              <BulkBar count={checked.size} total={rows.length} onClear={() => setChecked(new Set())}>
                <span className="tv-bulk-l">프로젝트</span>
                <ProjectCombo
                  value={bulkProject}
                  projects={projects}
                  areaId={fArea ? Number(fArea) : undefined}
                  canCreate={user.role === "lead"}
                  placeholder="프로젝트 선택…"
                  onChange={setBulkProject}
                  onCreated={(p) => setProjects((cur) => [...cur, p])}
                />
                <button className="btn-primary" disabled={bulkBusy} onClick={assignProject}>
                  {bulkBusy ? "지정 중…" : "선택 업무에 지정"}
                </button>
              </BulkBar>
            )}
            <TaskTable
              rows={rows}
              title={isMine ? "내 업무" : "업무 목록"}
              sub={`${rows.length}건`}
              emptyScope="full"
              emptyText="아직 업무가 없어요"
              emptyHint="상단 필터를 조정하거나, 새 업무를 만들어 시작하세요."
              emptyAction={
                <button className="btn small primary" onClick={quickNew}>
                  ＋ 새 업무
                </button>
              }
              variant="full"
              quickComplete
              // §C1 — "직접 정한 순서" 일 때만 핸들을 그린다
              sortable={sortBy === "manual"}
              onReorder={reorder}
              selectable
              checked={checked}
              onToggleCheck={toggleCheck}
              onToggleAll={() =>
                setChecked((prev) => (rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id))))
              }
              onStatusChange={changeStatus}
              onRowClick={(id) => openTaskPanel(id)}
              // §C2 — 기한 막대 목록. 구간은 이번 달. 넷이 같은 컴포넌트를 쓴다(§C4).
              timeline={today ? monthRange(today) : undefined}
              groupBy={listGroup}
            />
          </>
        )}
        {!loading && !error && lens === "board" && (
          <TaskBoard
            tasks={filteredTasks}
            today={today}
            group={boardGroup}
            areas={areas}
            actors={actors}
            onMove={moveTask}
          />
        )}
        {!loading && !error && lens === "calendar" && <TaskCalendar tasks={filteredTasks} today={today} />}
        {!loading && !error && lens === "timeline" && <TaskGantt tasks={filteredTasks} today={today} actors={actors} />}

        {/* 완료를 감춘 이유와 되돌리는 길을 목록 아래에 남긴다 (§E) */}
        {!showDone && hiddenDone > 0 && (
          <p className="tv-hidden">
            완료 {hiddenDone}건 숨김 ·{" "}
            <button className="lk" onClick={() => toggleDone(true)}>완료 포함해서 보기</button>
          </p>
        )}
      </div>
      </div>
    </PageShell>
  );
}
