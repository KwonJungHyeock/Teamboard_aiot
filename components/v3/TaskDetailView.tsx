"use client";

// v3 「상세」 (MD-P-2026-046 §B).
//
// ── 무엇을 먹는가 ────────────────────────────────────────────────
//
// 기존 엔드포인트 둘뿐이다. **새 API 는 없고 옛 API 도 안 고쳤다.**
//   · `GET   /api/tasks/{id}` — 업무 · 하위 · 활동을 한 번에 준다
//   · `PATCH /api/tasks/{id}` — 다섯 가지만 보낸다 (§B-1 조사표는 `lib/v3/detail.ts`)
//
// ── 받는 것만 바꾸게 한다 ───────────────────────────────────────
//
// 제목 · 기록 · 상태 · 담당 · 기한. 그 밖은 칸을 안 만든다. 화면에 **보이는데**
// 못 바꾸는 것(진척)은 칸 대신 **이유 한 줄**을 단다 — 칸이 있는데 안 먹히는
// 것보다, 칸이 없고 왜 없는지 적혀 있는 편이 낫다.
//
// ── 저장은 한 칸씩 (§G) ─────────────────────────────────────────
//
// 「저장」 버튼 하나로 묶지 않는다. 다섯 칸이 각자 다른 이유로 거절당할 수
// 있는데(400·403), 묶어 보내면 어느 칸 때문인지 알 수가 없다. 한 칸씩 보내면
// 서버가 준 이유가 **그 칸 옆에** 선다.
//
// ── 저장이 보이게 (047 §B) ──────────────────────────────────────
//
// 칸에서 벗어날 때 저장하는 방식은 그대로 둔다 — 버튼을 만들면 안 누르고
// 나가서 잃는다. 대신 **증거를 상시로 둔다.** 칸마다 한 줄이 붙어 있고
// 그 줄은 안 사라진다: 안내 → 저장 중… → 마지막 저장 09:42.
// 실패하면 같은 자리에 「저장 안 됨 · 사유」가 선다.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, InputChip, Button, Tag, Checkbox, Empty, PropRow } from "./parts";
import type { CbState } from "./parts";
import {
  STATUS_CHOICES, statusEditable, progressWhy, dueOpenNote, patchBody, changed,
  childSummary, saveNote, stampFrom, titleReject, IDLE,
  PRIORITY_CHOICES, PRIORITY_LABEL, FIELD_LABEL, periodText, CHILD_EDIT_WHY,
  type DetailTask, type ActivityRow, type EditField, type SaveState,
} from "@/lib/v3/detail";
/*
 * 066 §E-3 — 영역·프로젝트 규칙은 **한 곳에서 온다.** 새 업무 화면도 같은
 * 파일을 부른다. 두 화면이 각자 판단하면 언젠가 갈린다(§E-45).
 */
import {
  projectsForArea, clearsProject, PROJECT_CLEARED, PICK_AREA_FIRST,
  type ProjectPick,
} from "@/lib/area-project";
import { dueTone } from "@/lib/v3/tasks";
import { areaOf, type AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";
import { extractLinks } from "@/lib/v3/links";
import Attachments from "./Attachments";

interface Person { id: number; name: string }

const stateOf = (s: string): CbState =>
  s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

/** 활동 한 줄의 시각 — **KST 로** 그린다. UTC 를 잘라 쓰면 9시간이 어긋난다(§G). */
function stamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "numeric", day: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
}

export default function TaskDetailView({
  id, today, openAtMs, areas, people,
}: {
  id: number;
  /** KST 오늘. **서버가 정해서 넘긴다** — 브라우저 시계를 안 믿는다. */
  today: string;
  openAtMs: number;
  areas: AreaView[];
  people: Person[];
}) {
  const router = useRouter();
  const [task, setTask] = useState<DetailTask | null>(null);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [err, setErr] = useState("");        // 못 불러온 이유
  /** 칸마다 따로 (§G — 한 번에 하나씩 저장한다). 하나로 묶으면 어느 칸이 거부됐는지 모른다. */
  /*
   * 칸이 열둘로 늘었다(066 §E-37). **목록을 손으로 적지 않는다** —
   * `FIELD_LABEL` 의 열쇠에서 만든다. 손으로 적으면 칸을 더할 때 하나가 빠지고,
   * 빠진 칸은 「저장 중」도 「저장 안 됨」도 안 보이는 칸이 된다.
   */
  const [save, setSave] = useState<Record<EditField, SaveState>>(
    () => Object.fromEntries((Object.keys(FIELD_LABEL) as EditField[]).map((k) => [k, IDLE])) as Record<EditField, SaveState>);
  const put = (f: EditField, patch: Partial<SaveState>) =>
    setSave((prev) => ({ ...prev, [f]: { ...prev[f], ...patch } }));
  const [open, setOpen] = useState<Set<string>>(new Set());
  /*
   * ── 속성 일곱이 고를 재료 (066 §E-37) ────────────────────────────
   * `/api/meta/selectors` 하나로 프로젝트·목표를 받고, 상위 후보는 `/api/tasks`
   * 에서 받는다. **둘 다 이미 있는 경로다** — 새 API 는 없다.
   */
  const [projects, setProjects] = useState<ProjectPick[]>([]);
  const [goals, setGoals] = useState<{ id: number; title: string }[]>([]);
  const [others, setOthers] = useState<{ id: number; title: string; areaId: number | null; parentTaskId: number | null }[]>([]);
  /** 영역을 바꿔서 프로젝트를 비웠다는 한 줄 (§E-43). 조용히 비우지 않는다. */
  const [cleared, setCleared] = useState("");
  // 편집 중인 글자. 저장 전까지는 화면 것이 이긴다.
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`/api/tasks/${id}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(data.error ?? `업무를 불러오지 못했습니다 (${res.status})`); return; }
    setTask(data.task);
    setActivity(data.activity ?? []);
    setTitle(data.task.title);
    setNote(data.task.description ?? "");
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  /* 고를 재료. 못 받아도 화면은 뜬다 — 그때는 고르개에 「없습니다」가 선다. */
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/meta/selectors").catch(() => null);
      if (r && r.ok) {
        const d = await r.json().catch(() => ({}));
        setProjects((d.projects ?? []).map((x: { id: number; name: string; areaId?: number; area_id?: number; type?: string }) => ({
          id: x.id, name: x.name, areaId: (x.areaId ?? x.area_id) as number, type: x.type })));
        // 후보는 분기·월 목표다(서버가 이미 그렇게 고른다). 여기서 다시 고르지 않는다.
        const gs = [...(d.linkGoals ?? []), ...(d.monthGoals ?? [])] as { id: number; title: string }[];
        const seen = new Set<number>();
        setGoals(gs.filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
                   .map((g) => ({ id: g.id, title: g.title })));
      }
      const t = await fetch("/api/tasks").catch(() => null);
      if (t && t.ok) {
        const d = await t.json().catch(() => ({}));
        setOthers((d.tasks ?? []).map((x: { id: number; title: string; areaId?: number | null; parentTaskId?: number | null }) => ({
          id: x.id, title: x.title, areaId: x.areaId ?? null, parentTaskId: x.parentTaskId ?? null })));
      }
    })();
  }, []);

  /**
   * 한 칸을 보낸다. **안 바뀐 값은 안 보낸다** — 보내면 활동 로그가 더러워지고,
   * 「고친 적 없는데 고쳤다고 적혀 있다」가 된다.
   */
  const send = useCallback(async (
    field: EditField, value: string | number | number[] | null,
    extra?: Partial<Record<EditField, string | number | null>>,
  ) => {
    put(field, { busy: true, err: "" });
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody(field, value, extra)),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      // **서버가 준 이유를 그대로 낸다.** 삼키면 사람은 같은 저장을 반복한다.
      // 「마지막 저장」 시각은 **안 건드린다** — 이번 것은 저장 안 됐으니까.
      put(field, { busy: false, err: data.error ?? `저장하지 못했습니다 (${res.status})` });
      return false;
    }
    // 시각은 **서버 것**을 쓴다(응답의 `Date` 머리글). 브라우저 시계로 찍으면
    // 시계가 틀린 기계에서 증거로 내놓은 숫자가 거짓말을 한다.
    put(field, { busy: false, err: "", savedAt: stampFrom(res.headers.get("date")) });
    await load();
    // 목록·오늘 화면이 옛 값을 들고 있을 수 있다. 되돌아갈 때 새로 읽게 한다.
    router.refresh();
    return true;
  }, [id, load, router]);

  const toggle = (k: string) =>
    setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  /**
   * 그 칸의 저장 증거 한 줄. **안 사라진다** — 잠깐 떴다 사라지는 표시는
   * 못 보면 없는 것과 같다(047 §B). `aria-live` 로 소리로도 알린다.
   */
  const Note = ({ field, hint }: { field: EditField; hint: string }) => {
    const n = saveNote(save[field], hint);
    return (
      <p className={`v3-save t-${n.tone}`} aria-live="polite" data-field={field}>{n.text}</p>
    );
  };

  if (err) {
    return (
      <Card>
        <Empty title="이 업무를 열 수 없어요" why={err}
               action={{ label: "업무 목록으로", href: "/v3/tasks" }} />
      </Card>
    );
  }
  if (!task) return <Card><p className="v3-loading">불러오는 중…</p></Card>;

  const area = areaOf(areas, task.areaId);
  const canStatus = statusEditable(task.status);
  const tone = dueTone(task.dueDate, today);
  const openNote = dueOpenNote(task.dueDate, openAtMs);
  const kids = childSummary(task);
  // **저장된** 기록에서 뽑는다 — 치는 도중의 반쪽짜리 주소로 카드가 깜빡이지 않게.
  const attach = extractLinks(task.description);

  return (
    <>
      {/* 상위가 있으면 **여기가 어디인지** 먼저 적는다. 하위 업무를 열었는데
          위가 안 보이면 같은 제목이 여러 개일 때 길을 잃는다. */}
      {task.parentTaskId !== null && (
        <p className="v3-crumb">
          <Link href={taskHref(task.parentTaskId)}>{task.parentTitle ?? `#${task.parentTaskId}`}</Link>
          <span aria-hidden="true"> / </span>
          <span>하위 업무</span>
        </p>
      )}

      {/* 제목 — 이 화면의 본체다. 새 업무와 **같은 입력**을 쓴다. */}
      <textarea
        className="v3-title-in v3-dtitle"
        rows={1}
        value={title}
        aria-label="제목"
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => {
          /*
           * 빈 제목은 API 가 **조용히 무시한다**(§B-1 조사표). 화면만 비워 두면
           * 「화면은 비었는데 저장은 안 됨」이 되고, 새로고침하면 옛 제목이
           * 돌아온다 — 사람은 그걸 고장으로 읽는다.
           *
           * 그래서 보내기 전에 화면이 **서버 규칙을 그대로 비춘다**: 되돌리고
           * 이유를 적는다. API 는 안 고친다 (047 §B-1).
           */
          const why = titleReject(title);
          if (why) { setTitle(task.title); put("title", { busy: false, err: why }); return; }
          if (changed(task.title, title.trim())) void send("title", title.trim());
        }}
      />
      <Note field="title" hint="칸에서 벗어나면 저장됩니다." />

      <p className="v3-lede v3-dmeta">
        {area && <Tag area={area} />}
        <span>#{task.id}</span>
        {kids && <span>{kids}</span>}
      </p>

      {/*
        지금 상태를 **글자로도** 적는다(`sub`). 네 칸 중 하나만 테두리가 진한
        것으로 말하려 했더니, 「완료」 칸의 초록 체크가 늘 켜져 보여서 지금
        상태가 완료인 줄 읽혔다 — 체크는 그 칸이 무슨 상태인지를 그린 것이지
        지금 상태가 아니다. 모양 하나에 두 가지를 말하게 두지 않는다.
      */}
      <Card title="상태" sub={STATUS_CHOICES.find((s) => s.value === task.status)?.label}>
        {canStatus.ok ? (<>
          <div className="v3-chips v3-statuspick" role="group" aria-label="상태">
            {STATUS_CHOICES.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`v3-stbtn${task.status === s.value ? " on" : ""}`}
                aria-pressed={task.status === s.value}
                disabled={save.status.busy}
                onClick={() => { if (task.status !== s.value) void send("status", s.value); }}
              >
                <Checkbox state={stateOf(s.value)} />
                {s.label}
              </button>
            ))}
          </div>
          <Note field="status" hint="누르면 바로 저장됩니다." />
          {/* 완료 되돌리기는 **여기에만** 있다 (지시 §B-2). 목록의 체크는 안 만든다 —
              스치듯 눌러서 되돌아가는 자리가 아니다. */}
          {task.status === "done" && (
            <p className="v3-why">완료를 되돌리려면 위에서 다른 상태를 고르면 됩니다. 목록에는 이 자리가 없습니다.</p>
          )}
        </>) : (
          // 못 바꾸는 값은 **칸 없이 이유 한 줄** (지시 §B-1).
          <p className="v3-why">{canStatus.why}</p>
        )}
        {task.status === "dropped" && task.dropReason && (
          <p className="v3-why">중단 사유 — {task.dropReason}</p>
        )}
      </Card>

      {/*
        ── 속성 일곱 (066 §E-37) ─────────────────────────────────────
        영역 · 프로젝트 · 목표 · 상위 · 하위 · 우선순위 · 기간.

        **셋은 안 넣었다**(§E-38): 차단 · 이 업무가 막는 업무 · 공개 범위.
        가오픈 뒤다.

        저장은 여기서도 **한 칸씩**이다(§G) — 일곱을 「저장」 하나로 묶으면
        어느 칸이 왜 거절됐는지 알 수 없다. 칸마다 증거 한 줄이 붙는다.
      */}
      <Card title="속성" sub="일곱">
        {/* ① 영역 — 바꾸면 프로젝트가 안 맞을 수 있다. 그때는 **함께** 비운다.
            따로 보내면 첫 요청이 안 맞는 조합이라 400 을 맞는다(§E-44). */}
        <PropRow label="영역" editing={open.has("area")} onEdit={() => toggle("area")}
                 editor={
                   <>
                     <label htmlFor="v3-d-area">영역</label>
                     <select id="v3-d-area" value={task.areaId} disabled={save.areaId.busy}
                             onChange={(e) => {
                               const next = Number(e.target.value);
                               if (next === task.areaId) return;
                               // §E-43 — 조용히 비우지 않는다. 비웠다고 **적는다.**
                               if (clearsProject(projects, next, task.projectId)) {
                                 setCleared(PROJECT_CLEARED);
                                 void send("areaId", next, { projectId: null });
                               } else {
                                 setCleared("");
                                 void send("areaId", next);
                               }
                             }}>
                       {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                     </select>
                   </>
                 }>
          {area ? area.name : <span className="empty">알 수 없는 영역</span>}
        </PropRow>
        {open.has("area") && <Note field="areaId" hint="고르면 바로 저장됩니다." />}

        {/* ② 프로젝트 — **그 영역의 것만 나온다**(§E-42). 안 맞는 것은 내놓지 않는다 */}
        <PropRow label="프로젝트" editing={open.has("project")} onEdit={() => toggle("project")}
                 editor={(() => {
                   const pick = projectsForArea(projects, task.areaId);
                   if (pick.length === 0) {
                     return <span className="v3-newwhy">
                       {projects.length === 0 ? PICK_AREA_FIRST : "이 영역에는 프로젝트가 없습니다."}
                     </span>;
                   }
                   return (
                     <>
                       <label htmlFor="v3-d-pj">프로젝트</label>
                       <select id="v3-d-pj" value={task.projectId ?? ""} disabled={save.projectId.busy}
                               onChange={(e) => { setCleared("");
                                 void send("projectId", e.target.value === "" ? null : Number(e.target.value)); }}>
                         <option value="">— 없음</option>
                         {pick.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                       </select>
                       <span className="v3-newwhy">이 영역의 프로젝트만 나옵니다</span>
                     </>
                   );
                 })()}>
          {task.projectName ?? <span className="empty">＋ 프로젝트</span>}
        </PropRow>
        {/* 영역을 바꿔서 비웠으면 **여기 적혀 있다.** 조용히 비우지 않는다 */}
        {cleared && <p className="v3-why">{cleared}</p>}
        {open.has("project") && <Note field="projectId" hint="고르면 바로 저장됩니다." />}

        {/* ③ 목표 — 여럿이 붙는다. 하나를 켜고 끌 때 **배열 전체**를 보낸다 */}
        <PropRow label="목표" editing={open.has("goal")} onEdit={() => toggle("goal")}
                 editor={goals.length === 0
                   ? <span className="v3-newwhy">연결할 분기·월 목표가 없습니다.</span>
                   : (
                     <div className="v3-chips">
                       {goals.map((g) => {
                         const on = task.goalIds.includes(g.id);
                         return (
                           <InputChip key={g.id} filled={on} disabled={save.goalIds.busy}
                                      onClick={() => {
                                        const next = on ? task.goalIds.filter((x) => x !== g.id)
                                                        : [...task.goalIds, g.id];
                                        void send("goalIds", next);
                                      }}>
                             {on ? `✓ ${g.title}` : g.title}
                           </InputChip>
                         );
                       })}
                     </div>
                   )}>
          {task.goalIds.length === 0
            ? <span className="empty">＋ 목표</span>
            : goals.filter((g) => task.goalIds.includes(g.id)).map((g) => g.title).join(" · ")
              || `${task.goalIds.length}개 연결됨`}
        </PropRow>
        {open.has("goal") && <Note field="goalIds" hint="누르면 바로 저장됩니다." />}

        {/* ④ 상위 업무 — **값이 스스로 눌린다**(링크). 그래서 형제 모양이다(§E-39) */}
        <PropRow label="상위 업무" valueActs editing={open.has("parent")} onEdit={() => toggle("parent")}
                 editor={
                   <>
                     <label htmlFor="v3-d-pa">상위</label>
                     <select id="v3-d-pa" value={task.parentTaskId ?? ""} disabled={save.parentTaskId.busy}
                             onChange={(e) => void send("parentTaskId",
                               e.target.value === "" ? null : Number(e.target.value))}>
                       <option value="">— 없음 (최상위)</option>
                       {others.filter((o) => o.id !== task.id && o.parentTaskId === null
                                          && !task.children.some((c) => c.id === o.id))
                              .map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
                     </select>
                     {/* 하위를 가진 업무는 남의 하위가 될 수 없다 — 2단까지다(§A4) */}
                     <span className="v3-newwhy">상위가 되면 영역·프로젝트를 상위에서 물려받습니다</span>
                   </>
                 }>
          {task.parentTaskId === null
            ? <span className="empty">없음 (최상위)</span>
            : <Link className="v3-prop-link" href={taskHref(task.parentTaskId)}>
                {task.parentTitle ?? `#${task.parentTaskId}`}
              </Link>}
        </PropRow>
        {open.has("parent") && <Note field="parentTaskId" hint="고르면 바로 저장됩니다." />}

        {/* ⑤ 하위 업무 — **읽기 전용이다.** 값은 눌린다(링크) 하지만 고치는 자리는
            그 업무의 「상위 업무」다. 칸이 없고 왜 없는지 적혀 있는 편이 낫다 */}
        <PropRow label="하위 업무">
          {task.children.length === 0
            ? <span className="empty">없음</span>
            : task.children.map((c) => (
                <Link key={c.id} className="v3-prop-link" href={taskHref(c.id)}>{c.title}</Link>
              ))}
        </PropRow>
        <p className="v3-why">{CHILD_EDIT_WHY}</p>

        {/* ⑥ 우선순위 */}
        <PropRow label="우선순위" editing={open.has("prio")} onEdit={() => toggle("prio")}
                 editor={
                   <div className="v3-chips">
                     {PRIORITY_CHOICES.map((c) => (
                       <InputChip key={c.value} filled={task.priority === c.value}
                                  disabled={save.priority.busy}
                                  onClick={() => { if (task.priority !== c.value) void send("priority", c.value); }}>
                         {c.label}
                       </InputChip>
                     ))}
                   </div>
                 }>
          {PRIORITY_LABEL[task.priority] ?? task.priority}
        </PropRow>
        {open.has("prio") && <Note field="priority" hint="누르면 바로 저장됩니다." />}

        {/* ⑦ 기간 — 시작일과 기한. **기한을 고치는 자리는 아래 「담당과 기한」 하나다** —
            같은 값에 칸을 둘 두면 어느 쪽이 정본인지 묻게 된다(§E-45 의 뜻) */}
        <PropRow label="기간" editing={open.has("period")} onEdit={() => toggle("period")}
                 editor={
                   <>
                     <label htmlFor="v3-d-st">시작일</label>
                     <input id="v3-d-st" type="date" value={task.startDate ?? ""}
                            disabled={save.startDate.busy}
                            onChange={(e) => void send("startDate", e.target.value)} />
                     {task.startDate && (
                       <button type="button" className="v3-clear"
                               onClick={() => void send("startDate", "")}>지우기</button>
                     )}
                     <span className="v3-newwhy">기한은 아래 「담당과 기한」에서 정합니다</span>
                   </>
                 }>
          {periodText(task.startDate, task.dueDate) ?? <span className="empty">＋ 기간</span>}
        </PropRow>
        {open.has("period") && <Note field="startDate" hint="고르면 바로 저장됩니다." />}
      </Card>

      <Card title="담당과 기한">
        {/* 입력 칩 — 거르개의 검정 채움을 안 쓴다 (046 §A). */}
        <div className="v3-chips">
          <InputChip filled={task.assigneeName !== null} open={open.has("assignee")}
                     onClick={() => toggle("assignee")}>
            {task.assigneeName ? `담당 · ${task.assigneeName}` : "담당 없음"}
          </InputChip>
          <InputChip filled={task.dueDate !== null} open={open.has("due")}
                     onClick={() => toggle("due")}>
            {task.dueDate ? `기한 · ${task.dueDate}` : "＋ 기한"}
          </InputChip>
          {/* 기한이 가오픈 기준으로 어디 서 있는지. **같은 계산을 다시 쓴다** —
              대문 카운트다운·「오늘」의 D 와 한 곳(`lib/open-due.ts`)에서 나온다. */}
          {openNote && <span className={`v3-due t-${tone} v3-dopen`}>{openNote}</span>}
        </div>

        {open.has("assignee") && (
          <div className="v3-newrow">
            <label htmlFor="v3-d-as">담당</label>
            <select id="v3-d-as" value={task.assigneeId ?? ""} disabled={save.assigneeId.busy}
                    onChange={(e) => void send("assigneeId", Number(e.target.value))}>
              {task.assigneeId === null && <option value="">— 담당 없음</option>}
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* 「안 정함」을 안 내는 이유 — 없는 선택지는 왜 없는지가 안 보인다.
                (API 는 `assigneeId: null` 을 받지만 v3 에 비우는 자리는 두지 않는다.) */}
            <span className="v3-newwhy">담당을 비우는 자리는 두지 않았습니다</span>
          </div>
        )}
        {open.has("assignee") && <Note field="assigneeId" hint="고르면 바로 저장됩니다." />}
        {open.has("due") && (
          <div className="v3-newrow">
            <label htmlFor="v3-d-due">기한</label>
            <input id="v3-d-due" type="date" value={task.dueDate ?? ""} disabled={save.dueDate.busy}
                   onChange={(e) => void send("dueDate", e.target.value)} />
            {task.dueDate && (
              <button type="button" className="v3-clear" onClick={() => void send("dueDate", "")}>
                지우기
              </button>
            )}
            {/* 빈 문자열이 곧 「기한 없음」이다 — API 가 날짜꼴이 아니면 null 로 저장한다. */}
            <span className="v3-newwhy">기한 없는 업무는 아무 날에도 안 걸립니다</span>
          </div>
        )}
        {open.has("due") && <Note field="dueDate" hint="고르면 바로 저장됩니다." />}
      </Card>

      <Card title="진척" sub={`${task.effectiveProgress}%`}>
        {/* **읽기 전용이다** (지시 §B-2). `lib/progress.ts` 는 안 건드렸다 —
            여기서는 서버가 계산해 준 값을 그리고, 왜 못 바꾸는지만 적는다. */}
        <div className="v3-bar" role="img" aria-label={`진척 ${task.effectiveProgress}%`}>
          <span style={{ width: `${task.effectiveProgress}%` }} />
        </div>
        <p className="v3-why">{progressWhy(task)}</p>
      </Card>

      <Card title="기록">
        <textarea
          className="v3-note-in"
          rows={7}
          aria-label="기록"
          placeholder="무엇을 왜 하는지, 알아 둘 것이 있으면 적어 두세요."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (changed(task.description, note)) void send("description", note); }}
        />
        {/* 문구에 백틱·별표를 쓰지 않는다 — 여기는 마크다운이 아니라서 글자 그대로 찍힌다. */}
        <Note field="description" hint="칸에서 벗어나면 저장됩니다." />
      </Card>

      {/*
        ── 첨부 (051 §C) ────────────────────────────────────────────
        기록에 적힌 URL 을 **아래에 다시 보인다.** 올리는 것도 저장하는 것도
        없다 — DB·API 를 안 건드린다.

        **본문은 그대로 남는다.** 뽑아서 지우면 사용자가 적은 것이 바뀐다.
        위 칸의 글자와 여기 카드는 같은 것을 두 번 보이는 것뿐이다.

        `note`(편집 중인 글자)가 아니라 **저장된 `task.description`** 에서 뽑는다.
        치는 도중의 반쪽짜리 주소로 카드가 깜빡이면 읽을 수가 없다.
      */}
      {attach.length > 0 && (
        <Card title="첨부" sub={`${attach.length}개 · 기록에 적힌 링크`}>
          <Attachments links={attach} />
          <p className="v3-why">
            기록에 적은 링크를 그대로 보입니다. 파일을 올리거나 저장하지 않습니다 —
            원본 링크가 살아 있어야 보입니다.
          </p>
        </Card>
      )}

      {task.children.length > 0 && (
        <Card title="하위 업무" sub={kids ?? undefined}>
          {task.children.map((c) => (
            <div className="v3-row" key={c.id}>
              <Checkbox state={stateOf(c.status)} />
              <span className="v3-row-main">
                <Link className="v3-row-t" href={taskHref(c.id)}>{c.title}</Link>
              </span>
            </div>
          ))}
        </Card>
      )}

      {/* 활동은 041 그대로다 — `GET /api/tasks/{id}` 가 주는 것을 그리기만 한다. */}
      <Card title="활동" sub={`${activity.length}건`}>
        {activity.length === 0 ? (
          <Empty title="아직 활동이 없어요"
                 why="상태·담당·진척·목표 연결이 바뀌면 여기 쌓입니다. 제목과 기록 수정은 잡음이라 안 남깁니다." />
        ) : activity.map((a) => (
          <p className={`v3-act ${a.level}`} key={a.id}>
            <span className="v3-act-t">{stamp(a.created_at)}</span>
            {a.message}
          </p>
        ))}
      </Card>

      <div className="v3-newfoot">
        <Button onClick={() => router.push("/v3/tasks")}>업무 목록으로</Button>
      </div>
    </>
  );
}
