"use client";

// 내부 링크 언퍼 카드 — 제목 + 상태 칩 + 담당 + 진척% (MD-P-2026-006 §E).
// 원래 ProjectCanvas 안에만 있었는데, 업무 문서(MD-P-2026-019 §F)도 같은 카드를 써야 해서
// 공용으로 올렸다. 두 벌로 만들지 않는다.
import { useRouter } from "next/navigation";
import { openTaskPanel } from "@/lib/task-panel";
import { openPanel } from "@/lib/side-panel";

export interface InternalCard {
  kind: "task" | "decision" | "project";
  id: number;
  title: string;
  statusLabel: string;
  statusTone: string;
  assigneeName: string | null;
  progress: number | null;
  href: string;
}

const KIND: Record<InternalCard["kind"], string> = { task: "업무", decision: "결정", project: "프로젝트" };

export default function InternalUnfurl({ card }: { card: InternalCard }) {
  const router = useRouter();
  const open = () => {
    if (card.kind === "task") openTaskPanel(card.id);
    else if (card.kind === "decision") openPanel("decision", card.id);
    else router.push(`/projects/${card.id}`);
  };
  return (
    <button className="iunf" onClick={open}>
      <span className="iunf-k">{KIND[card.kind]}</span>
      <span className="iunf-b">
        <span className="iunf-t">{card.title}</span>
        <span className="iunf-m">
          <span
            className="iunf-chip"
            style={{ color: `var(${card.statusTone})`, background: `color-mix(in srgb, var(${card.statusTone}) 13%, var(--card))` }}
          >
            {card.statusLabel}
          </span>
          {card.assigneeName && <span className="iunf-av" aria-hidden="true">{card.assigneeName.slice(0, 1)}</span>}
          {card.assigneeName && <span className="iunf-by">{card.assigneeName}</span>}
          {card.progress !== null && <span className="iunf-p num">{card.progress}%</span>}
        </span>
      </span>
    </button>
  );
}
