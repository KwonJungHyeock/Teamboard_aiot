"use client";

// 운영 전략 (/v3/strategy, 지시서 v1): 축 4행 × 단계 2열 표. 칸 안에 항목을 한 줄씩.
//   거르개: 내 담당 · 검토 중 · 승인 대기 · 폐기(폐기한 것만 다시 보고 되살린다)
//   항목을 누르면 오른쪽 상세 패널(업무 상세와 같은 서랍). `?item=ID` 로도 연다(알림함에서)
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { STRATEGY_AXES, STRATEGY_PHASES, statusLabel, type StrategyAxis, type StrategyPhase } from "@/lib/strategy-words";
import { api, useOnChanged } from "../ui";
import StrategyPanel, { kstDay, LockIcon, type SgItem } from "../StrategyPanel";

type Chip = "mine" | "review" | "pending" | "dropped";
const CHIPS: { k: Chip; label: string }[] = [
  { k: "mine", label: "내 담당" }, { k: "review", label: "검토 중" }, { k: "pending", label: "승인 대기" }, { k: "dropped", label: "폐기" },
];

export default function Strategy() {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [data, setData] = useState<{ items: SgItem[]; me: { id: number; lead: boolean; write: boolean } } | null>(null);
  const [chips, setChips] = useState<Chip[]>([]);
  const [open, setOpen] = useState<number | { axis: StrategyAxis; phase: StrategyPhase } | null>(null);

  const load = useCallback(async () => {
    try { setData(await api("/api/ed/strategy")); } catch { setData({ items: [], me: { id: 0, lead: false, write: false } }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useOnChanged(() => { void load(); });
  // 알림함에서 ?item=ID
  useEffect(() => {
    const id = Number(sp.get("item"));
    if (Number.isInteger(id) && id > 0) { setOpen(id); router.replace(path, { scroll: false }); }
  }, [sp, path, router]);

  const on = (k: Chip) => chips.includes(k);
  const toggle = (k: Chip) => setChips((xs) => (xs.includes(k) ? xs.filter((x) => x !== k) : [...xs, k]));
  const shown = useMemo(() => (data?.items ?? []).filter((i) =>
    (on("dropped") ? i.status === "dropped" : i.status !== "dropped")
    && (!on("mine") || i.ownerId === data?.me.id)
    && (!on("review") || i.status === "review")
    && (!on("pending") || i.pending > 0)), [data, chips]); // eslint-disable-line react-hooks/exhaustive-deps
  const cell = (axis: string, phase: number) => shown.filter((i) => i.axis === axis && i.phase === phase);
  const write = !!data?.me.write;

  return (
    <div className="ed-page sg">
      <div className="sg-head">
        <h1 className="ed-h1">운영 전략</h1>
        <div className="sg-chips" role="group" aria-label="거르개">
          {CHIPS.map((c) => (
            <button key={c.k} type="button" className="sg-chip" aria-pressed={on(c.k)} onClick={() => toggle(c.k)}>
              {c.label}{c.k === "pending" && data ? <i>{data.items.filter((i) => i.pending > 0 && i.status !== "dropped").length}</i> : null}
            </button>
          ))}
        </div>
        <span className="sg-sp" />
        {write && <button type="button" className="sg-add" onClick={() => setOpen({ axis: "inflow", phase: 1 })}>+ 항목</button>}
      </div>

      {!data ? <div className="ed-empty">불러오는 중</div> : (
        <div className="sg-grid" role="table" aria-label="운영 전략 표">
          <div className="sg-row hd" role="row">
            <div className="sg-ax" role="columnheader" />
            {STRATEGY_PHASES.map((p) => (
              <div key={p.key} className="sg-ph" role="columnheader"><b>{p.label}</b><span>{p.sub}</span></div>
            ))}
          </div>
          {STRATEGY_AXES.map((a) => (
            <div key={a.key} className="sg-row" role="row">
              <div className="sg-ax" role="rowheader"><b>{a.label}</b><span>{cell(a.key, 1).length + cell(a.key, 2).length}개</span></div>
              {STRATEGY_PHASES.map((p) => {
                const xs = cell(a.key, p.key);
                return (
                  <div key={p.key} className="sg-cell" role="cell" data-ph={`${p.label} ${p.sub}`}>
                    {xs.map((i) => (
                      <button key={i.id} type="button" className={`sg-it${open === i.id ? " on" : ""}${i.status === "dropped" ? " gone" : ""}`} onClick={() => setOpen(i.id)}>
                        <span className="l1">
                          {i.locked && <LockIcon />}
                          <b className="tt">{i.title}</b>
                          {i.pending > 0 && <em className="sg-wait">승인 대기</em>}
                        </span>
                        {i.standard && i.standard !== i.title && <span className="l2">{i.standard}</span>}
                        <span className="l3">
                          <span className={i.ownerName ? undefined : "none"}>{i.ownerName ?? "담당 없음"}</span>
                          <span className={`st ${i.status}`}>{statusLabel(i.status)}</span>
                          <span>{kstDay(i.changedAt)}</span>
                          <span>의견 {i.comments}</span>
                        </span>
                      </button>
                    ))}
                    {!xs.length && <span className="sg-none">{chips.length ? "맞는 항목 없음" : "항목 없음"}</span>}
                    {write && !on("dropped") && (
                      <button type="button" className="sg-plus" onClick={() => setOpen({ axis: a.key, phase: p.key })}>+ 추가</button>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {open !== null && data && (
        <StrategyPanel key={typeof open === "number" ? open : `new-${open.axis}-${open.phase}`} target={open} me={data.me}
                       onClose={() => setOpen(null)} onSaved={(id) => { void load(); if (id) setOpen(id); }} />
      )}
    </div>
  );
}
