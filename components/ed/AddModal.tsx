"use client";

// 등록 창 — 달력의 `+ 등록` · 칸의 `+` · 고른 날 한 번 더 · 칸 끌기, 한 줄 등록창의 `자세히` 로 연다.
//   업무: 이름 · 기간(달력) · 담당 · 카테고리(고르거나 적기) · 목표(고르거나 적기).
//         함께하는 사람 · 공개 · 상태 · 메모는 「옵션」 안에 접어 둔다 — 대부분은 안 건드린다.
//   일정: 이름 · 기간 · 팀/나만.
import { useState } from "react";
import { md, todayKst } from "@/lib/ed/core";
import { areaOpts, canMakeGoal, createTask, dropArea, dropGoal, goalOpts, makeArea, makeGoal, useMeta } from "./data";
import Combo from "./Combo";
import { api, emitChanged, Modal, Seg } from "./ui";

export interface AddPreset { start?: string; end?: string; title?: string; kind?: "task" | "event" }

/** 날짜 칸 — 누르면 바로 달력이 열린다(showPicker) */
export function DateIn({ value, onChange, min, max, label }: { value: string; onChange: (v: string) => void; min?: string; max?: string; label: string }) {
  return (
    <input type="date" className="ed-input am-date" aria-label={label} value={value} min={min} max={max}
           onClick={(e) => { try { e.currentTarget.showPicker(); } catch { /* 오래된 브라우저는 그냥 칸 */ } }}
           onChange={(e) => onChange(e.target.value)} />
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
  const [area, setArea] = useState<number | null>(null);
  const [goal, setGoal] = useState<number | null>(null);
  const [scope, setScope] = useState<"team" | "private">("team");
  const [status, setStatus] = useState<"todo" | "doing">("todo");
  const [memo, setMemo] = useState("");
  const [members, setMembers] = useState<number[]>([]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const me = meta?.me.id;
  const personal = scope === "private";
  const assignee = personal ? me : (who === "" ? me : who);
  const taskOk = !!title.trim() && (!start || !due || start <= due);
  const evOk = !!title.trim() && !!evStart && !!evEnd && evEnd >= evStart;
  const ok = (kind === "task" ? taskOk : evOk) && !busy;
  const fail = (e: unknown) => setErr(e instanceof Error ? e.message : "처리하지 못했습니다");

  const submit = async () => {
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      if (kind === "task") {
        const body: Record<string, unknown> = { title: title.trim(), assigneeId: assignee, status, visibility: scope, startDate: start || null, dueDate: due || null };
        if (area !== null) body.areaId = area;
        if (memo.trim()) body.description = memo.trim();
        const with_ = members.filter((m) => m !== assignee);
        if (!personal && with_.length) body.memberIds = with_;
        const { id } = await createTask(body);
        if (goal !== null && id) { await api(`/api/tasks/${id}`, { method: "PATCH", body: { goalIds: [goal] } }).catch(() => {}); emitChanged(); }
        onDone?.(`업무 등록 · ${start && due ? `${md(start)}~${md(due)}` : due ? md(due) : "기한 없음"}`, id);
      } else {
        await api(personal ? "/api/personal-events" : "/api/events", { method: "POST", body: { title: title.trim(), startDate: evStart, endDate: evEnd } });
        emitChanged();
        onDone?.(`일정 등록 · ${md(evStart)}${evEnd !== evStart ? `~${md(evEnd)}` : ""}${personal ? " · 나만" : ""}`);
      }
      onClose();
    } catch (e) { fail(e); setBusy(false); }
  };
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); } };
  const others = (meta?.people ?? []).filter((p) => p.id !== assignee);
  const nm = (p: { id: number; name: string }) => (p.id === me ? `나 · ${p.name}` : p.name);

  return (
    <Modal onClose={onClose} label="등록" width={520}>
      <div className="am-h">
        <Seg value={kind} onChange={(v) => { setKind(v); setErr(""); }} options={[{ v: "task", label: "업무" }, { v: "event", label: "일정" }]} />
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="am-b">
        <input className="ed-input am-title" autoFocus value={title} maxLength={kind === "task" ? 200 : 120} onChange={(e) => setTitle(e.target.value)} onKeyDown={onEnter}
               placeholder={kind === "task" ? "업무 이름" : "일정 이름"} aria-label="이름" />

        {kind === "task" ? (
          <>
            <div className="am-f">
              <span>기간</span>
              <div className="am-dates">
                <DateIn label="시작일" value={start} max={due || undefined} onChange={setStart} />
                <i>~</i>
                <DateIn label="기한" value={due} min={start || undefined} onChange={setDue} />
              </div>
            </div>
            <div className="am-grid">
              <label className="am-f">
                <span>담당</span>
                <select className="ed-input" value={assignee ?? ""} disabled={personal} onChange={(e) => setWho(Number(e.target.value))}>
                  {meta?.people.map((p) => <option key={p.id} value={p.id}>{nm(p)}</option>)}
                </select>
              </label>
              <div className="am-f">
                <span>카테고리</span>
                <Combo label="카테고리" value={area} options={areaOpts(meta)} none="기타" onPick={setArea}
                       onCreate={async (name) => { try { setArea(await makeArea(name)); } catch (e) { fail(e); } }}
                       onRemove={async (o) => { try { if (await dropArea(o) && area === o.id) setArea(null); } catch (e) { fail(e); } }} />
              </div>
            </div>
            <div className="am-f">
              <span>목표 <small>달성률 · 보고에 집계</small></span>
              <Combo label="목표" value={goal} options={goalOpts(meta, personal)} none="없음 (상시 업무)" onPick={setGoal}
                     onCreate={canMakeGoal(meta, personal) ? async (t) => { try { setGoal(await makeGoal(t, personal)); } catch (e) { fail(e); } } : undefined}
                     onRemove={async (o) => { try { if (await dropGoal(o) && goal === o.id) setGoal(null); } catch (e) { fail(e); } }} />
            </div>

            <button type="button" className="am-more" aria-expanded={more} onClick={() => setMore((x) => !x)}>
              옵션 {more ? "접기" : `· 함께하는 사람 · 공개 · 메모`}<span>{more ? "▴" : "▾"}</span>
            </button>
            {more && (
              <>
                {!personal && others.length > 0 && (
                  <div className="am-f">
                    <span>함께하는 사람</span>
                    <div className="am-checks">
                      {others.map((p) => (
                        <label key={p.id} className={`am-radio${members.includes(p.id) ? " on" : ""}`}>
                          <input type="checkbox" checked={members.includes(p.id)}
                                 onChange={(e) => setMembers((xs) => e.target.checked ? [...xs, p.id] : xs.filter((x) => x !== p.id))} />
                          <span>{nm(p)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="am-grid">
                  <div className="am-f">
                    <span>공개</span>
                    <Seg value={scope} onChange={(v) => { setScope(v); setGoal(null); }} options={[{ v: "team", label: "팀" }, { v: "private", label: "나만" }]} />
                  </div>
                  <div className="am-f">
                    <span>상태</span>
                    <Seg value={status} onChange={setStatus} options={[{ v: "todo", label: "할 일" }, { v: "doing", label: "진행 중" }]} />
                  </div>
                </div>
                <textarea className="ed-input" rows={2} value={memo} maxLength={4000} onChange={(e) => setMemo(e.target.value)} placeholder="메모" aria-label="메모" />
              </>
            )}
          </>
        ) : (
          <>
            <div className="am-f">
              <span>기간</span>
              <div className="am-dates">
                <DateIn label="시작일" value={evStart} onChange={(v) => { setEvStart(v); if (v && evEnd < v) setEvEnd(v); }} />
                <i>~</i>
                <DateIn label="종료일" value={evEnd} min={evStart} onChange={setEvEnd} />
              </div>
            </div>
            <div className="am-f">
              <span>공개</span>
              <Seg value={scope} onChange={setScope} options={[{ v: "team", label: "팀" }, { v: "private", label: "나만" }]} />
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
