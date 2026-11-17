"use client";

// 정리 필요함 (2026-11 모니터링 · 팀장) — 통계 · 보고 숫자를 틀어지게 하는 업무를 한 화면에서 바로 고친다.
//   · 담당 없음 → 담당 고르기          · 기한 없음 → 달력
//   · 카테고리 「기타」 → 고르거나 적기  · 목표 미연결 → 목표 고르기 · 「상시 업무」로 두기
//   · 검토에 오래 머묾(5일+) → 완료 · 진행으로
// 대상은 팀 공개 · 상위 업무 · 열린 것(시작 전 · 진행 · 검토 · 보류)만. 고치면 그 줄은 목록에서 빠진다.
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { addDays, todayKst, type EdTask } from "@/lib/ed/core";
import { areaOpts, dropArea, goalOpts, makeArea, patchTask, useMeta, useTasks } from "../data";
import Combo from "../Combo";
import { DateIn } from "../AddModal";
import { useToast } from "../ui";

const STALE_DAYS = 5;

export default function Tidy() {
  const router = useRouter();
  const meta = useMeta();
  const { tasks, setTasks } = useTasks();
  const [toast, show] = useToast();
  const today = todayKst();

  const open = useMemo(() => (tasks ?? []).filter((t) => t.parentTaskId === null && t.visibility === "team"
    && ["todo", "doing", "review", "hold"].includes(t.status)), [tasks]);
  const touched = (t: EdTask) => (t.updatedAt ? new Date(Date.parse(t.updatedAt.replace(" ", "T").replace(/\+00$/, "Z")) + 9 * 3600e3).toISOString().slice(0, 10) : today);
  const groups = useMemo(() => [
    { key: "who", title: "담당 없음", hint: "누가 할지 정해 주세요", rows: open.filter((t) => t.assigneeId === null) },
    { key: "due", title: "기한 없음", hint: "기한이 없으면 지남 · 준수율에 잡히지 않습니다", rows: open.filter((t) => !t.dueDate) },
    { key: "area", title: "카테고리 「기타」", hint: "파트별 집계 · 보고에서 「기타」로 묶입니다", rows: open.filter((t) => t.areaName === "기타") },
    { key: "goal", title: "목표 미연결", hint: "목표 달성률에 들어가지 않습니다 · 일상 업무면 「상시 업무」로", rows: open.filter((t) => t.goalIds.length === 0 && t.goalSource !== "none") },
    { key: "stale", title: `검토에 ${STALE_DAYS}일 넘게 머묾`, hint: "확인하고 완료하거나 진행으로 돌려 주세요", rows: open.filter((t) => t.status === "review" && touched(t) < addDays(today, -STALE_DAYS)) },
  ], [open, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = groups.reduce((s, g) => s + g.rows.length, 0);

  const save = async (t: EdTask, body: Record<string, unknown>, local: Partial<EdTask>, msg: string) => {
    setTasks((xs) => xs && xs.map((x) => (x.id === t.id ? { ...x, ...local } : x)));
    try { await patchTask(t.id, body); show(msg); } catch (e) { show(e instanceof Error ? e.message : "저장하지 못했습니다"); }
  };
  const fail = (e: unknown) => show(e instanceof Error ? e.message : "처리하지 못했습니다");

  const fix = (key: string, t: EdTask) => {
    if (!meta) return null;
    if (key === "who") return (
      <select className="ed-input" value="" aria-label="담당 고르기"
              onChange={(e) => { const p = meta.people.find((x) => x.id === Number(e.target.value)); if (p) void save(t, { assigneeId: p.id }, { assigneeId: p.id, assigneeName: p.name }, `담당 · ${p.name}`); }}>
        <option value="">담당 고르기</option>{meta.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
    );
    if (key === "due") return <DateIn label="기한" value="" min={t.startDate ?? undefined} onChange={(v) => { if (v) void save(t, { dueDate: v }, { dueDate: v }, "기한을 넣었습니다"); }} />;
    if (key === "area") return (
      <Combo label="카테고리" value={t.areaId} options={areaOpts(meta)}
             onPick={(id) => { const a = meta.areas.find((x) => x.id === id); if (a && a.id !== t.areaId) void save(t, { areaId: a.id }, { areaId: a.id, areaName: a.name }, `카테고리 · ${a.name}`); }}
             onCreate={async (name) => { try { const id = await makeArea(name); await save(t, { areaId: id }, { areaId: id, areaName: name }, `카테고리 · ${name}`); } catch (e) { fail(e); } }}
             onRemove={async (o) => { try { const m = await dropArea(o); if (m) show(m); } catch (e) { fail(e); } }} />
    );
    if (key === "goal") return (
      <>
        <Combo label="목표" value={null} options={goalOpts(meta, false)} placeholder="목표 고르기"
               onPick={(id) => { if (id) void save(t, { goalIds: [id] }, { goalIds: [id] }, "목표에 연결했습니다"); }} />
        <button type="button" className="ed-btn sm" onClick={() => void save(t, { goalSource: "none" }, { goalSource: "none" }, "상시 업무로 두었습니다")}>상시 업무</button>
      </>
    );
    return (
      <>
        <button type="button" className="ed-btn sm pri" onClick={() => void save(t, { status: "done" }, { status: "done" }, "완료했습니다")}>완료</button>
        <button type="button" className="ed-btn sm" onClick={() => void save(t, { status: "doing" }, { status: "doing" }, "진행으로 돌렸습니다")}>진행으로</button>
      </>
    );
  };

  return (
    <div className="ed-page td">
      <div className="td-head">
        <div>
          <h1 className="ed-h1">정리 필요함</h1>
          <p>통계 · 보고 숫자를 틀어지게 하는 업무입니다. 이 자리에서 바로 고치면 목록에서 빠집니다.</p>
        </div>
        {tasks && <span className="ed-badge">{total ? `${total}건` : "깨끗함"}</span>}
      </div>
      {!tasks ? <div className="ed-empty">불러오는 중</div> : total === 0 ? <div className="td-sec"><div className="td-done">✓ 정리할 업무가 없습니다</div></div> : (
        groups.filter((g) => g.rows.length).map((g) => (
          <section key={g.key} className="td-sec">
            <h2>{g.title}<span className="tn">{g.rows.length}</span><small>{g.hint}</small></h2>
            {g.rows.slice(0, 50).map((t) => (
              <div key={t.id} className="td-row">
                <button type="button" className="tt" onClick={() => router.push(`?task=${t.id}`, { scroll: false })}>{t.title}</button>
                <span className="who">{t.assigneeName ?? "담당 없음"} · {t.areaName}</span>
                <div className="fx">{fix(g.key, t)}</div>
              </div>
            ))}
            {g.rows.length > 50 && <div className="pc-empty">외 {g.rows.length - 50}건 — 위에서부터 정리하면 이어서 보입니다</div>}
          </section>
        ))
      )}
      {toast}
    </div>
  );
}
