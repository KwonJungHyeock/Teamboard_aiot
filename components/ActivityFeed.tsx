"use client";

// 팀 타임라인 활동 피드 (협업 A) — 업무 공유 포스트: 액터·업무 chip·노트·리액션·[열기].
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar, ReactionChips, renderRich, relTime, type ReactionSummary, type Person } from "./collab-ui";

interface AItem {
  id: number;
  actorName: string;
  avatarUrl: string | null;
  kind: string;
  refType: string;
  refId: number | null;
  note: string;
  taskTitle: string | null;
  taskStatus: string | null;
  createdAt: string;
  reactions: ReactionSummary[];
}

export default function ActivityFeed({ compact = false }: { compact?: boolean }) {
  const [items, setItems] = useState<AItem[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/feed");
      const data = await res.json();
      setItems(data.items ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    fetch("/api/meta/selectors").then((r) => r.json()).then((d) => setPeople(d.actors ?? [])).catch(() => {});
  }, []);

  const names = people.map((p) => p.name);
  const shown = compact ? items.slice(0, 4) : items;

  function setReactions(id: number, next: ReactionSummary[]) {
    setItems((cur) => cur.map((a) => (a.id === id ? { ...a, reactions: next } : a)));
  }

  if (loading) return <p className="gempty">불러오는 중...</p>;
  if (items.length === 0) return <p className="gempty">아직 공유된 활동이 없어요. 업무를 “팀 타임라인 공유”하면 여기에 나타납니다.</p>;

  return (
    <div className="afeed">
      {shown.map((a) => (
        <article className="acard" key={a.id}>
          <Avatar name={a.actorName} url={a.avatarUrl} />
          <div className="acard-b">
            <div className="acard-top">
              <b>{a.actorName}</b>
              <span className="mu" style={{ fontSize: 12.5, color: "var(--muted)" }}>업무를 공유했어요</span>
              {a.refType === "task" && a.refId && (
                <Link className="a-taskchip" href={`/tasks?task=${a.refId}`}>
                  <span className="dotc" style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--edu)" }} />
                  {a.taskTitle ?? `#${a.refId}`}
                </Link>
              )}
              <span className="acard-t num">{relTime(a.createdAt)}</span>
            </div>
            {a.note && <p className="acard-note">{renderRich(a.note, names)}</p>}
            <ReactionChips targetType="activity" targetId={a.id} reactions={a.reactions} onChanged={(next) => setReactions(a.id, next)} />
          </div>
        </article>
      ))}
      {compact && items.length > shown.length && (
        <Link className="collab-more" href="/notifications">전체 활동 보기 →</Link>
      )}
    </div>
  );
}
