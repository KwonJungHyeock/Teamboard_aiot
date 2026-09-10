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
// ── 저장은 한 칸씩 ──────────────────────────────────────────────
//
// 「저장」 버튼 하나로 묶지 않는다. 다섯 칸이 각자 다른 이유로 거절당할 수
// 있는데(400·403), 묶어 보내면 어느 칸 때문인지 알 수가 없다. 한 칸씩 보내면
// 서버가 준 이유가 **그 칸 옆에** 선다.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, InputChip, Button, Tag, Checkbox, Empty } from "./parts";
import type { CbState } from "./parts";
import {
  STATUS_CHOICES, statusEditable, progressWhy, dueOpenNote, patchBody, changed,
  childSummary, type DetailTask, type ActivityRow, type EditField,
} from "@/lib/v3/detail";
import { dueTone } from "@/lib/v3/tasks";
import { areaOf, type AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";

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
  const [saveErr, setSaveErr] = useState(""); // 서버가 거절한 이유 — **그대로** 낸다
  const [busy, setBusy] = useState<EditField | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
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

  /**
   * 한 칸을 보낸다. **안 바뀐 값은 안 보낸다** — 보내면 활동 로그가 더러워지고,
   * 「고친 적 없는데 고쳤다고 적혀 있다」가 된다.
   */
  const save = useCallback(async (field: EditField, value: string | number | null) => {
    setSaveErr("");
    setBusy(field);
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patchBody(field, value)),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      // **서버가 준 이유를 그대로 낸다.** 삼키면 사람은 같은 저장을 반복한다.
      setSaveErr(data.error ?? `저장하지 못했습니다 (${res.status})`);
      return false;
    }
    await load();
    // 목록·오늘 화면이 옛 값을 들고 있을 수 있다. 되돌아갈 때 새로 읽게 한다.
    router.refresh();
    return true;
  }, [id, load, router]);

  const toggle = (k: string) =>
    setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

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
          const next = title.trim();
          // 빈 제목은 API 가 **조용히 무시한다**(§B-1). 조용히 무시되느니
          // 되돌려 놓고 이유를 적는다 — 지웠는데 남아 있으면 고장으로 읽힌다.
          if (next === "") { setTitle(task.title); setSaveErr("제목은 비울 수 없습니다."); return; }
          if (changed(task.title, next)) void save("title", next);
        }}
      />

      <p className="v3-lede v3-dmeta">
        {area && <Tag area={area} />}
        <span>#{task.id}</span>
        {kids && <span>{kids}</span>}
      </p>

      {saveErr && <p className="v3-err v3-dsave">{saveErr}</p>}

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
                disabled={busy === "status"}
                onClick={() => { if (task.status !== s.value) void save("status", s.value); }}
              >
                <Checkbox state={stateOf(s.value)} />
                {s.label}
              </button>
            ))}
          </div>
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
            <select id="v3-d-as" value={task.assigneeId ?? ""} disabled={busy === "assigneeId"}
                    onChange={(e) => void save("assigneeId", Number(e.target.value))}>
              {task.assigneeId === null && <option value="">— 담당 없음</option>}
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* 「안 정함」을 안 내는 이유 — 없는 선택지는 왜 없는지가 안 보인다.
                (API 는 `assigneeId: null` 을 받지만 v3 에 비우는 자리는 두지 않는다.) */}
            <span className="v3-newwhy">담당을 비우는 자리는 두지 않았습니다</span>
          </div>
        )}
        {open.has("due") && (
          <div className="v3-newrow">
            <label htmlFor="v3-d-due">기한</label>
            <input id="v3-d-due" type="date" value={task.dueDate ?? ""} disabled={busy === "dueDate"}
                   onChange={(e) => void save("dueDate", e.target.value)} />
            {task.dueDate && (
              <button type="button" className="v3-clear" onClick={() => void save("dueDate", "")}>
                지우기
              </button>
            )}
            {/* 빈 문자열이 곧 「기한 없음」이다 — API 가 날짜꼴이 아니면 null 로 저장한다. */}
            <span className="v3-newwhy">기한 없는 업무는 아무 날에도 안 걸립니다</span>
          </div>
        )}
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
          onBlur={() => { if (changed(task.description, note)) void save("description", note); }}
        />
        {/* 문구에 백틱·별표를 쓰지 않는다 — 여기는 마크다운이 아니라서 글자 그대로 찍힌다. */}
        <p className="v3-why">칸에서 벗어나면 저장됩니다.</p>
      </Card>

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
        {busy && <span className="v3-newwhy">저장 중…</span>}
      </div>
    </>
  );
}
