"use client";

// 등록 창 — 달력에서 날짜를 누르거나(끌면 기간) `+ 등록`, 한 줄 등록창의 `자세히` 로 연다 (팀 피드백 4 · 5).
//   [업무 | 일정] 라디오. 업무 = 이름 · 시작일~기한 · 담당 · 카테고리 · 목표(설명) · 공개 · 상태 · 메모.
//   일정 = 이름 · 시작일~종료일 · 공개. 알약 대신 라디오 · 선택 상자로 한눈에.
import { useState } from "react";
import { addDays, md, todayKst } from "@/lib/ed/core";
import { createTask, useMeta } from "./data";
import { api, emitChanged, Modal } from "./ui";

export interface AddPreset { start?: string; end?: string; title?: string; kind?: "task" | "event" }

function Radios<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { v: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="am-radios" role="radiogroup">
      {options.map((o) => (
        <label key={o.v} className={`am-radio${o.v === value ? " on" : ""}`}>
          <input type="radio" name={name} value={o.v} checked={o.v === value} onChange={() => onChange(o.v)} />
          <span>{o.label}{o.hint && <small>{o.hint}</small>}</span>
        </label>
      ))}
    </div>
  );
}

export default function AddModal({ preset, onClose, onDone }: { preset?: AddPreset; onClose: () => void; onDone?: (msg: string, taskId?: number) => void }) {
  const meta = useMeta();
  const today = todayKst();
  const [kind, setKind] = useState<"task" | "event">(preset?.kind ?? "task");
  const [title, setTitle] = useState(preset?.title ?? "");
  // 하루짜리는 기한만. 끌어서 고른 기간이면 시작일까지 채운다
  const ranged = !!preset?.start && !!preset?.end && preset.end > preset.start;
  const [start, setStart] = useState(ranged ? preset!.start! : "");
  const [due, setDue] = useState(preset?.end ?? preset?.start ?? today);
  const [evStart, setEvStart] = useState(preset?.start ?? today);
  const [evEnd, setEvEnd] = useState(preset?.end ?? preset?.start ?? today);
  const [who, setWho] = useState<number | "">("");
  const [area, setArea] = useState<number | "">("");
  const [goal, setGoal] = useState<number | "">("");
  const [scope, setScope] = useState<"team" | "private">("team");
  const [status, setStatus] = useState<"todo" | "doing">("todo");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const me = meta?.me.id;
  const assignee = scope === "private" ? me : (who === "" ? me : who);
  const goals = (meta?.goals ?? []).filter((g) => g.periodType !== "year");
  const taskOk = !!title.trim() && (!start || !due || start <= due);
  const evOk = !!title.trim() && !!evStart && !!evEnd && evEnd >= evStart;
  const ok = (kind === "task" ? taskOk : evOk) && !busy;

  const submit = async () => {
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      if (kind === "task") {
        const body: Record<string, unknown> = { title: title.trim(), assigneeId: assignee, status, visibility: scope, startDate: start || null, dueDate: due || null };
        if (area !== "") body.areaId = area;
        if (memo.trim()) body.description = memo.trim();
        const { id } = await createTask(body);
        if (goal !== "" && id) await api(`/api/tasks/${id}`, { method: "PATCH", body: { goalIds: [goal] } }).catch(() => {});
        if (goal !== "") emitChanged();
        const when = start && due ? `${md(start)}~${md(due)}` : due ? `기한 ${md(due)}` : "기한 없음";
        onDone?.(`업무 등록 · ${when}`, id);
      } else {
        await api(scope === "team" ? "/api/events" : "/api/personal-events", { method: "POST", body: { title: title.trim(), startDate: evStart, endDate: evEnd } });
        emitChanged();
        onDone?.(`일정 등록 · ${md(evStart)}${evEnd !== evStart ? `~${md(evEnd)}` : ""}${scope === "private" ? " · 나만" : ""}`);
      }
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "등록하지 못했습니다"); setBusy(false); }
  };
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } };

  return (
    <Modal onClose={onClose} label="등록" width={560}>
      <div className="am-h">
        <b>등록</b>
        <Radios name="am-kind" value={kind} onChange={(v) => { setKind(v); setErr(""); }}
                options={[{ v: "task", label: "업무" }, { v: "event", label: "일정", hint: "박람회 · 교육 · 출장" }]} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="am-b">
        <label className="am-f">
          <span>이름</span>
          <input className="ed-input" autoFocus value={title} maxLength={kind === "task" ? 200 : 120} onChange={(e) => setTitle(e.target.value)} onKeyDown={onEnter}
                 placeholder={kind === "task" ? "무엇을 하나요" : "일정 이름"} />
        </label>

        {kind === "task" ? (
          <>
            <div className="am-f">
              <span>기간</span>
              <div className="am-dates">
                <label><small>시작일</small><input type="date" className="ed-input" value={start} max={due || undefined} onChange={(e) => setStart(e.target.value)} /></label>
                <i>~</i>
                <label><small>기한</small><input type="date" className="ed-input" value={due} min={start || undefined} onChange={(e) => setDue(e.target.value)} /></label>
              </div>
              <div className="am-quick">
                <button type="button" onClick={() => { setStart(""); setDue(today); }}>오늘까지</button>
                <button type="button" onClick={() => { setStart(today); setDue(addDays(today, 6)); }}>이번 일주일</button>
                <button type="button" onClick={() => { setStart(""); setDue(""); }}>기한 없음</button>
              </div>
              <em className="am-hint">시작일을 넣으면 달력에 시작~기한 막대로 보입니다. 하루짜리는 기한만 두세요.</em>
            </div>
            <div className="am-grid">
              <label className="am-f">
                <span>담당</span>
                <select className="ed-input" value={scope === "private" ? (me ?? "") : who === "" ? (me ?? "") : who} disabled={scope === "private"}
                        onChange={(e) => setWho(Number(e.target.value))}>
                  {meta?.people.map((p) => <option key={p.id} value={p.id}>{p.id === me ? `나 · ${p.name}` : p.name}</option>)}
                </select>
              </label>
              <label className="am-f">
                <span>카테고리</span>
                <select className="ed-input" value={area} onChange={(e) => setArea(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">고르지 않음 (기타)</option>
                  {meta?.areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            <label className="am-f">
              <span>목표</span>
              <select className="ed-input" value={goal} onChange={(e) => setGoal(e.target.value ? Number(e.target.value) : "")}>
                <option value="">없음 — 상시 업무</option>
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
              <em className="am-hint">목표에 연결하면 그 목표의 달성률과 「보고」에 집계됩니다. 목표와 상관없는 일상 업무는 「없음」으로 두면 상시 업무로 셉니다.</em>
            </label>
            <div className="am-grid">
              <div className="am-f">
                <span>공개</span>
                <Radios name="am-scope" value={scope} onChange={setScope} options={[{ v: "team", label: "팀" }, { v: "private", label: "나만" }]} />
              </div>
              <div className="am-f">
                <span>상태</span>
                <Radios name="am-status" value={status} onChange={setStatus} options={[{ v: "todo", label: "할 일" }, { v: "doing", label: "진행 중" }]} />
              </div>
            </div>
            {scope === "private" && <em className="am-hint">나만 보는 업무는 담당이 나로 고정되고 집계 · 보고에 들어가지 않습니다.</em>}
            <label className="am-f">
              <span>메모 <small>(선택)</small></span>
              <textarea className="ed-input" rows={3} value={memo} maxLength={4000} onChange={(e) => setMemo(e.target.value)} placeholder="참고할 내용 · 링크" />
            </label>
          </>
        ) : (
          <>
            <div className="am-f">
              <span>기간</span>
              <div className="am-dates">
                <label><small>시작일</small><input type="date" className="ed-input" value={evStart}
                       onChange={(e) => { const v = e.target.value; setEvStart(v); if (v && evEnd < v) setEvEnd(v); }} /></label>
                <i>~</i>
                <label><small>종료일</small><input type="date" className="ed-input" value={evEnd} min={evStart} onChange={(e) => setEvEnd(e.target.value)} /></label>
              </div>
            </div>
            <div className="am-f">
              <span>공개</span>
              <Radios name="am-escope" value={scope} onChange={setScope} options={[{ v: "team", label: "팀", hint: "모두의 달력에" }, { v: "private", label: "나만", hint: "내 달력에만" }]} />
            </div>
          </>
        )}
        {err && <div className="ed-err">{err}</div>}
      </div>
      <div className="am-foot">
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn sm" onClick={onClose}>취소</button>
        <button type="button" className="ed-btn sm pri" onClick={() => void submit()} disabled={!ok}>{busy ? "등록 중…" : "등록"}</button>
      </div>
    </Modal>
  );
}
