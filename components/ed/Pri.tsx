"use client";

// 우선순위(0050) — 배지와 고르기. 보통은 배지를 그리지 않는다(대부분이 보통이라, 다 그리면 아무것도 안 보인다).
import { PRIORITY_LABEL, PRIORITY_OPTS, type PriorityV } from "@/lib/ed/core";
import { Seg } from "./ui";

export function PriBadge({ p }: { p?: string | null }) {
  if (!p || p === "mid" || !PRIORITY_LABEL[p]) return null;
  return <em className={`ed-pri ${p}`} title={`우선순위 ${PRIORITY_LABEL[p]}`}>{PRIORITY_LABEL[p]}</em>;
}

export function PriPick({ value, onChange, full }: { value: string | null | undefined; onChange: (v: PriorityV) => void; full?: boolean }) {
  const v = (PRIORITY_OPTS.some((o) => o.v === value) ? value : "mid") as PriorityV;
  return <Seg full={full} value={v} onChange={onChange} options={PRIORITY_OPTS.map((o) => ({ v: o.v, label: o.label }))} />;
}
