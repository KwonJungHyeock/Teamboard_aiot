"use client";

// v3 「새 업무」 (MD-P-2026-045 §B).
//
// ── 필수는 둘뿐이다 ─────────────────────────────────────────────
//
// **제목과 카테고리.** 담당·기한·하위·파일은 접힌 점선 칩이고, 안 채워도 저장된다.
// 등록이 어려우면 사람은 등록을 안 하고, 안 등록된 일은 없는 일이 된다.
//
// ── 「기록」이 저장되는 곳 (§B-1 조사 결과) ─────────────────────
//
// 지시서는 `task.body` 라고 했는데 **그 컬럼은 없다.** 실재하는 것은
// `task.description` (text · NOT NULL · 기본값 '')이고 `POST /api/tasks` 가
// `payload.description` 으로 받는다(4000자에서 자른다). 이름만 다르므로
// 칸은 그대로 짓고 **보내는 이름을 실재하는 것으로** 맞췄다.
//
// ── project 를 안 고른다 ────────────────────────────────────────
//
// 이번 등록 흐름에 프로젝트는 없다. `POST /api/tasks` 는 `projectId` 를
// 요구하지 않는다(안 보내면 null). `area_id` 는 NOT NULL 인데 **카테고리가
// 그걸 채운다** — 그래서 카테고리가 필수다.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Chip, Button } from "./parts";
import type { AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";

interface Person { id: number; name: string }

export default function NewTaskView({
  areas, people, me,
}: { areas: AreaView[]; people: Person[]; me: Person }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  // 접힌 것들 — 열어야 보인다. 안 열면 안 보내진다.
  const [open, setOpen] = useState<Set<string>>(new Set());
  /*
   * 담당의 기본값은 **나**다. 「안 정함」이 아니다.
   *
   * `POST /api/tasks` 는 `assigneeId` 를 안 보내면 **세션 사용자를 넣는다**
   * (`payload.assigneeId ? Number(...) : session.id`). 즉 이 API 로는 담당 없는
   * 업무를 만들 수 없다. 그런데 화면에 「안 정함」을 내면 고른 대로 저장됐다고
   * 믿게 되고, 목록에서 자기 이름을 보고서야 안다.
   *
   * API 를 고치는 것은 이번 범위 밖이다. 그러니 **화면이 사실대로 말한다** —
   * 기본은 나, 바꾸고 싶으면 고른다.
   */
  const [assigneeId, setAssigneeId] = useState<string>(String(me.id));
  const [dueDate, setDueDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const titleRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { titleRef.current?.focus(); }, []);

  const toggle = (k: string) =>
    setOpen((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  const ready = title.trim().length > 0 && areaId !== null;
  /** 왜 못 누르는지 — **비활성 버튼 옆에 이유를 적는다.** 안 적으면 고장으로 읽힌다. */
  const blockedWhy = title.trim().length === 0
    ? "제목을 적어 주세요"
    : areaId === null ? "카테고리를 골라 주세요" : null;

  const save = useCallback(async () => {
    if (!ready || busy) return;
    setBusy(true); setErr("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `description` — 실재하는 컬럼 이름이다(§B-1). `body` 가 아니다.
      // 프로젝트는 안 보낸다: 이번 등록 흐름에 프로젝트가 없다.
      body: JSON.stringify({
        title: title.trim(),
        areaId,
        description: note,
        assigneeId: Number(assigneeId),
        dueDate: dueDate === "" ? undefined : dueDate,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // **서버가 준 이유를 그대로 낸다.** 삼키면 사람은 같은 저장을 반복한다.
      setErr(data.error ?? `저장하지 못했습니다 (${res.status})`);
      return;
    }
    if (!data.id) { setErr("저장은 됐는데 업무 번호를 못 받았습니다. 「업무」에서 확인해 주세요."); return; }
    // 목적지는 한 곳에서 낸다(§G). C-4 가 생기면 `taskHref` 한 줄만 바뀐다.
    router.push(taskHref(data.id));
  }, [ready, busy, title, areaId, note, assigneeId, dueDate, router]);

  // ⌘Enter / Ctrl+Enter 로 저장.
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void save(); }
  };

  return (
    <div onKeyDown={onKey}>
      <h1 className="v3-h1">새 업무</h1>
      <p className="v3-lede">제목과 카테고리만 있으면 저장됩니다. 나머지는 나중에 채워도 됩니다.</p>

      <Card>
        {/* 제목 — 큰 입력. 여기가 이 화면의 본체다. */}
        <textarea
          ref={titleRef}
          className="v3-title-in"
          rows={1}
          placeholder="무엇을 할 일인가요?"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />

        {/* 카테고리 — **area 수만큼.** 넷이 아니다(043 §1). 줄바꿈해서 다 보인다.
            색은 목록·태그와 **같은 팔레트**에서 온다 — 여기서 따로 정하지 않는다. */}
        <div className="v3-newlab">카테고리 <em>필수</em></div>
        <div className="v3-chips v3-catpick">
          {areas.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`v3-catbtn ${a.tone}${areaId === a.id ? " on" : ""}`}
              aria-pressed={areaId === a.id}
              onClick={() => setAreaId(a.id)}
            >
              {a.name}
            </button>
          ))}
        </div>

        {/* 기록 — 자유 서술. `task.description` 에 들어간다. */}
        <div className="v3-newlab">기록</div>
        <textarea
          className="v3-note-in"
          rows={5}
          placeholder="무엇을 왜 하는지, 알아 둘 것이 있으면 적어 두세요. 나중에 상세에서 이어 씁니다."
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {/* 접힌 점선 칩 — 안 채워도 저장된다. 여는 것은 사람이 정한다. */}
        <div className="v3-chips">
          <Chip dashed on={open.has("assignee")} onClick={() => toggle("assignee")}>
            {`담당 · ${people.find((p) => String(p.id) === assigneeId)?.name ?? me.name}`}
          </Chip>
          <Chip dashed on={open.has("due")} onClick={() => toggle("due")}>
            {dueDate ? `기한 · ${dueDate}` : "＋ 기한"}
          </Chip>
        </div>

        {open.has("assignee") && (
          <div className="v3-newrow">
            <label htmlFor="v3-as">담당</label>
            <select id="v3-as" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {/* 「안 정함」이 없는 이유를 적는다 — 없는 선택지는 왜 없는지가 안 보인다. */}
            <span className="v3-newwhy">담당 없이 저장할 수는 없습니다</span>
          </div>
        )}
        {open.has("due") && (
          <div className="v3-newrow">
            <label htmlFor="v3-due">기한</label>
            <input id="v3-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            {dueDate && <button type="button" className="v3-clear" onClick={() => setDueDate("")}>지우기</button>}
          </div>
        )}

        {err && <p className="v3-err v3-newerr">{err}</p>}

        <div className="v3-newfoot">
          <Button primary disabled={!ready || busy} onClick={() => void save()}>
            {busy ? "저장 중…" : "저장"}
          </Button>
          {/* 못 누르는 이유를 **버튼 옆에** 적는다. 눌렀는데 아무 일도 안 일어나면
              고장으로 읽힌다 — 여기선 아예 못 누르고, 왜인지가 보인다. */}
          {blockedWhy && <span className="v3-newwhy">{blockedWhy}</span>}
          {!blockedWhy && <span className="v3-newwhy">⌘Enter 로도 저장됩니다</span>}
        </div>
      </Card>
    </div>
  );
}
