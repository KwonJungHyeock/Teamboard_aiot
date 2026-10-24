"use client";

// 전체 업무 — 성격별 4레인 + 일괄 처리 (DESIGN.md 5.6 · tasks.dc.html).
//   레인: 지남 / 진행 중(진행 + 검토, 행에 「검토」) / 예정(시작 전) / 완료
//   필터 세그먼트는 다른 레인을 흐리게만 한다. 건수 숫자는 어디에도 두지 않는다.
//   행을 누르면 상세 드로어(?task=), 이니셜 원을 누르면 선택 → 아래 가운데 일괄 처리 바.
import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { addDays, diffDays, lookOf, LOOK_LABEL, mdw, todayKst, type EdTask, type Look } from "@/lib/ed/core";
import { patchTask, useMeta, useTasks } from "../data";
import { emitChanged, Seg, useToast } from "../ui";

type Lane = "over" | "doing" | "todo" | "done";
type Filter = "all" | Lane;
const LANES: { k: Lane; label: string; looks: Look[] }[] = [
  { k: "over", label: "지남", looks: ["over"] },
  { k: "doing", label: "진행 중", looks: ["doing", "review"] },
  { k: "todo", label: "예정", looks: ["todo"] },
  { k: "done", label: "완료", looks: ["done"] },
];
const SHADES = ["var(--ink)", "color-mix(in oklch, var(--ink) 70%, var(--panel2))", "color-mix(in oklch, var(--ink) 48%, var(--panel2))",
  "color-mix(in oklch, var(--ink) 30%, var(--panel2))", "color-mix(in oklch, var(--ink) 18%, var(--panel2))"];

function dueText(t: EdTask, look: Look, today: string): string {
  if (look === "done") return "완료";
  if (!t.dueDate) return "—";
  const n = diffDays(t.dueDate, today);
  if (n < 0) return `${-n}일 지남`;
  if (n === 0) return "오늘";
  return mdw(t.dueDate);
}

export default function Tasks() {
  const router = useRouter();
  const path = usePathname();
  const meta = useMeta();
  const { tasks } = useTasks();
  const today = todayKst();
  const sp = useSearchParams();
  // 업무 현황에서 넘어올 때 — `?who=ACTOR_ID`(그 사람 업무만) · `?f=over`(지남 세그먼트)
  const [filter, setFilter] = useState<Filter>(() => {
    const f = sp.get("f");
    return f === "over" || f === "doing" || f === "todo" || f === "done" ? f : "all";
  });
  const who = Number(sp.get("who")) || null;
  const whoName = who ? meta?.people.find((p) => p.id === who)?.name ?? null : null;
  const clearWho = () => {
    const q = new URLSearchParams(sp.toString()); q.delete("who");
    router.replace(q.toString() ? `${path}?${q}` : path, { scroll: false });
  };
  const [sel, setSel] = useState<number[]>([]);
  const [pop, setPop] = useState(0);
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector(".ed-drawer")) setSel([]); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const list = useMemo(() => (tasks ?? []).filter((t) => t.parentTaskId === null && ["todo", "doing", "review", "done"].includes(t.status)
    && (!who || t.assigneeId === who)), [tasks, who]);

  // 이니셜 — 같은 첫 글자가 겹치면 뒤 사람은 끝 글자(박주희 「박」 · 박정길 「길」)
  const initials = useMemo(() => {
    const m = new Map<number, string>(); const used = new Set<string>();
    for (const p of meta?.people ?? []) {
      const n = p.name.trim(); let c = n.charAt(0);
      if (used.has(c) && n.length > 1) c = n.charAt(n.length - 1);
      used.add(c); m.set(p.id, c);
    }
    return m;
  }, [meta]);
  // 구성 막대 농도 — 사람을 색이 아니라 ink 농도 다섯 단계로(업무가 많은 순)
  const shade = useMemo(() => {
    const cnt = new Map<number, number>();
    for (const t of list) if (t.assigneeId) cnt.set(t.assigneeId, (cnt.get(t.assigneeId) ?? 0) + 1);
    const order = Array.from(cnt.entries()).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    return new Map(order.map((id, i) => [id, SHADES[Math.min(i, 4)]]));
  }, [list]);

  const lanes = useMemo(() => LANES.map((L) => {
    const xs = list.map((t) => ({ t, look: lookOf(t, today) })).filter((x) => L.looks.includes(x.look));
    xs.sort((a, b) => {
      if (L.k === "done") return (b.t.completedAt ?? b.t.dueDate ?? "").localeCompare(a.t.completedAt ?? a.t.dueDate ?? "");
      return (a.t.dueDate ?? "9999").localeCompare(b.t.dueDate ?? "9999") || a.t.id - b.t.id;
    });
    const share = new Map<number, number>();
    for (const x of xs) if (x.t.assigneeId) share.set(x.t.assigneeId, (share.get(x.t.assigneeId) ?? 0) + 1);
    return { ...L, xs, share: Array.from(share.entries()).sort((a, b) => b[1] - a[1]) };
  }), [list, today]);

  const toggle = (id: number) => { setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])); setPop((n) => n + 1); };
  const open = (id: number) => { const q = new URLSearchParams(sp.toString()); q.set("task", String(id)); router.push(`${path}?${q}`, { scroll: false }); };

  const bulk = async (label: string, body: (t: EdTask) => Record<string, unknown>) => {
    if (busy) return;
    setBusy(true);
    const ids = sel; const byId = new Map(list.map((t) => [t.id, t]));
    let fail = 0;
    for (const id of ids) {
      const t = byId.get(id); if (!t) continue;
      try { await patchTask(id, body(t), true); } catch { fail++; }
    }
    setSel([]); setBusy(false); emitChanged();
    showToast(fail ? `${ids.length - fail}건 ${label} · ${fail}건 실패` : `${ids.length}건을 ${label}`);
  };

  const csv = () => {
    const shown = lanes.filter((l) => filter === "all" || l.k === filter).flatMap((l) => l.xs);
    const goalName = new Map((meta?.goals ?? []).map((g) => [g.id, g.title]));
    const head = "업무,담당,카테고리,상태,기한,목표";
    const body = shown.map(({ t, look }) => [t.title, t.assigneeName ?? "", t.areaName, LOOK_LABEL[look], dueText(t, look, today),
      t.goalIds.map((g) => goalName.get(g) ?? "").filter(Boolean).join(" / ")]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`﻿${head}\n${body}`], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `전체업무_${today}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="tsk">
      <div className="tsk-head">
        <h1 className="ed-h1">전체 업무</h1>
        <button type="button" className="tsk-csv" onClick={csv}>CSV 내보내기</button>
      </div>
      <div className="tsk-bar">
        <Seg value={filter} onChange={(v) => setFilter(v)} className="tsk-seg"
             options={[{ v: "all", label: "전체" }, { v: "over", label: "지남" }, { v: "doing", label: "진행 중" }, { v: "todo", label: "예정" }, { v: "done", label: "완료" }]} />
        {who && <span className="tsk-who"><i>{whoName ? whoName.charAt(0) : "?"}</i>{whoName ?? "담당"}<button type="button" onClick={clearWho} aria-label="담당 조건 지우기">✕</button></span>}
        {(filter !== "all" || who) && <button type="button" className="tsk-clear" onClick={() => { setFilter("all"); if (who) clearWho(); }}>조건 지우기</button>}
      </div>
      <section className="tsk-lanes">
        {lanes.map((l, li) => {
          const dim = filter !== "all" && filter !== l.k;
          const hot = l.k === "over" && l.xs.length > 0;
          return (
            <div key={l.k} className={`tsk-lane l-${l.k}${dim ? " dim" : ""}${hot ? " hot" : ""}`} style={{ animationDelay: `${li * 0.06}s` }}>
              <div className="tsk-lh">
                <div className="t"><span>{l.label}</span><i className={hot ? "ping" : undefined} /></div>
                <div className="sh" style={{ animationDelay: `${0.35 + li * 0.08}s` }}>
                  {l.share.map(([who, n]) => <span key={who} style={{ flexGrow: n, background: shade.get(who) }} title={meta?.people.find((p) => p.id === who)?.name} />)}
                </div>
              </div>
              <div className="tsk-rows ed-scroll">
                {l.xs.map(({ t, look }, i) => {
                  const on = sel.includes(t.id);
                  const done = look === "done";
                  return (
                    <div key={t.id} role="button" tabIndex={0} className={`tsk-row${on ? " on" : ""}${done ? " done" : ""}`}
                         style={{ animationDelay: `${0.1 + li * 0.06 + Math.min(i, 8) * 0.03}s` }}
                         onClick={() => (sel.length ? toggle(t.id) : open(t.id))}
                         onKeyDown={(e) => { if (e.key === "Enter") open(t.id); if (e.key === " ") { e.preventDefault(); toggle(t.id); } }}>
                      <button type="button" className={`tsk-av${on ? ` sel${pop % 2 ? "A" : "B"}` : ""}`} aria-pressed={on} aria-label={on ? "선택 해제" : "선택"}
                              onClick={(e) => { e.stopPropagation(); toggle(t.id); }}>
                        {on ? "✓" : (t.assigneeId ? initials.get(t.assigneeId) : null) ?? (t.assigneeName ?? "?").charAt(0)}
                      </button>
                      <div className="tt"><span>{t.title}</span>{t.status === "review" && !done && <em>검토</em>}</div>
                      <span className={`du${look === "over" ? " red" : t.dueDate === today && !done ? " now" : ""}`}>{dueText(t, look, today)}</span>
                    </div>
                  );
                })}
                {tasks && l.xs.length === 0 && <div className="tsk-empty">없음</div>}
              </div>
            </div>
          );
        })}
      </section>
      {sel.length > 0 && (
        <div className="tsk-bulk" role="toolbar" aria-label="일괄 처리">
          <span>{sel.length}건 선택</span>
          <button type="button" className="pri" disabled={busy} onClick={() => void bulk("완료 처리했어요", () => ({ status: "done" }))}>완료 처리</button>
          <button type="button" disabled={busy} onClick={() => void bulk("7일 미뤘어요", (t) => ({ dueDate: addDays(t.dueDate ?? today, 7) }))}>기한 +7일</button>
          <button type="button" disabled={busy} onClick={() => void bulk("검토로 옮겼어요", () => ({ status: "review" }))}>검토로</button>
          <button type="button" onClick={() => setSel([])}>해제</button>
        </div>
      )}
      {toast}
    </div>
  );
}
