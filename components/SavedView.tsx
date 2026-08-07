"use client";

// 저장됨 (MD-P-2026-006 §C·G) — hover 액션 바의 [저장]으로 담은 항목들.
// "저장 → 한 곳에 모임 → 다시 찾기" 경로가 Slack과 같아 전이가 일어난다.
import { useCallback, useEffect, useState } from "react";
import PageShell from "./PageShell";
import EmptyState from "./EmptyState";
import Skeleton from "./Skeleton";
import HoverActions, { type SaveType } from "./HoverActions";
import { openPanel } from "@/lib/side-panel";
import { openTaskPanel } from "@/lib/task-panel";
import { SAVED_CHANGED_EVENT } from "@/lib/collab-events";
import { useRouter } from "next/navigation";

interface SavedItem {
  id: number;
  targetType: SaveType;
  targetId: number;
  title: string;
  meta: string;
  createdAt: string;
  missing: boolean;
}

const KIND: Record<SaveType, string> = { task: "업무", signal: "논의", decision: "결정", project: "프로젝트" };
const TYPES: (SaveType | "all")[] = ["all", "task", "signal", "decision", "project"];

export default function SavedView() {
  const router = useRouter();
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<SaveType | "all">("all");

  const load = useCallback(async () => {
    const res = await fetch("/api/saved").catch(() => null);
    if (res && res.ok) setItems((await res.json()).items ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    window.addEventListener(SAVED_CHANGED_EVENT, load);
    return () => window.removeEventListener(SAVED_CHANGED_EVENT, load);
  }, [load]);

  function open(it: SavedItem) {
    if (it.missing) return;
    if (it.targetType === "task") openTaskPanel(it.targetId);
    else if (it.targetType === "project") router.push(`/projects/${it.targetId}`);
    else openPanel(it.targetType, it.targetId);
  }

  const shown = filter === "all" ? items : items.filter((i) => i.targetType === filter);

  return (
    <PageShell
      crumb={["워크스페이스", "저장됨"]}
      title="저장됨"
      subtitle={<>목록·코멘트·업무 카드에 마우스를 올리면 뜨는 [저장]으로 담은 항목입니다.</>}
      filters={TYPES.map((t) => (
        <button key={t} className={`pg-chip${filter === t ? " on" : ""}`} onClick={() => setFilter(t)}>
          {t === "all" ? "전체" : KIND[t]}
        </button>
      ))}
      filterSummary={`${shown.length}건`}
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        {loading ? (
          <Skeleton variant="list" />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="inbox"
            title={filter === "all" ? "저장한 항목이 없어요" : `저장한 ${KIND[filter]}이(가) 없어요`}
            hint="목록·코멘트·업무 카드에 마우스를 올리면 뜨는 저장 아이콘을 누르면 여기에 담깁니다. 나중에 다시 찾을 것을 모아두는 자리예요."
          />
        ) : (
          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ninbox">
              {shown.map((it) => (
                <div key={it.id} className={`nitem ha-host${it.missing ? " gone" : ""}`} tabIndex={0} role="button"
                  onClick={() => open(it)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); open(it); } }}>
                  <span className="n-ic n-share">{it.targetType === "task" ? "📌" : it.targetType === "signal" ? "💬" : it.targetType === "decision" ? "✓" : "▣"}</span>
                  <span className="n-b">
                    <span className="n-top">
                      <span className="n-kind">{KIND[it.targetType]}</span>
                      {it.meta && <span className="n-who">{it.meta}</span>}
                      <span className="n-t num">{it.createdAt.slice(0, 10)}</span>
                    </span>
                    <span className="n-snip">{it.missing ? "삭제되었거나 접근할 수 없는 항목" : it.title}</span>
                  </span>
                  <HoverActions saveType={it.targetType} saveId={it.targetId} saved
                    onSavedChange={() => load()} />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
    </PageShell>
  );
}
