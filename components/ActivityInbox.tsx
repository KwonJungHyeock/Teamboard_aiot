"use client";

// 활동 (MD-P-2026-006 §F·G — 구 "알림") — 멘션·배정·답글·승인·공유·마감을 한 목록에서.
// 안읽음 = 제목 굵게 + 좌측 코랄 점. "여기까지 읽음" 구분선이 마지막 방문 지점을 표시한다.
// 항목 클릭은 화면을 옮기지 않고 전역 우측 패널을 연다(§B).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { relTime } from "./collab-ui";
import HoverActions from "./HoverActions";
import { openPanel } from "@/lib/side-panel";
import { READ_LIST_EVENT } from "@/lib/shortcuts";

interface NItem {
  id: number;
  type: string;
  refType: string;
  refId: number | null;
  snippet: string;
  read: boolean;
  actorName: string | null;
  createdAt: string;
  synthetic?: boolean;
}

const KIND: Record<string, { label: string; cls: string; icon: string }> = {
  mention: { label: "멘션", cls: "n-mention", icon: "@" },
  assign: { label: "배정", cls: "n-assign", icon: "📌" },
  reply: { label: "답글", cls: "n-reply", icon: "💬" },
  approval: { label: "승인 필요", cls: "n-approval", icon: "✓" },
  share: { label: "공유", cls: "n-share", icon: "🔗" },
  deadline: { label: "마감 임박", cls: "n-approval", icon: "⏰" },
  overdue: { label: "지연", cls: "n-approval", icon: "⚠" },
};

const FILTERS = [
  ["all", "전체"], ["mention", "멘션"], ["reply", "답글"], ["assign", "배정"], ["unread", "안읽음"],
] as const;
type Filter = (typeof FILTERS)[number][0];

const SCOPE = "activity";

export default function ActivityInbox() {
  const [items, setItems] = useState<NItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [marker, setMarker] = useState<string | null>(null); // "여기까지 읽음" 기준선
  const pinned = useRef(false);                              // 방문 중 기준선 고정

  const load = useCallback(async () => {
    try {
      const [nres, mres] = await Promise.all([
        fetch("/api/notifications"),
        fetch("/api/read-markers"),
      ]);
      const data = await nres.json();
      setItems(data.items ?? []);
      const mk = (await mres.json()).markers?.[SCOPE] ?? null;
      // 기준선은 방문 중 움직이지 않는다 — 새 항목이 들어와도 구분선이 튀지 않게.
      if (!pinned.current) { pinned.current = true; setMarker(mk); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);

  /** 목록을 읽음 처리 — Esc(§A) 또는 목록 이탈(언마운트) 시. */
  const markList = useCallback(() => {
    fetch("/api/read-markers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: SCOPE }),
    }).catch(() => {});
    fetch("/api/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }),
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
  }, []);

  useEffect(() => {
    window.addEventListener(READ_LIST_EVENT, markList);
    return () => {
      window.removeEventListener(READ_LIST_EVENT, markList);
      markList(); // 목록 이탈 시 읽음 처리
    };
  }, [markList]);

  async function markRead(id: number) {
    await fetch("/api/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
    }).catch(() => {});
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
  }

  /** 화면 이동 없이 전역 우측 패널을 연다 (§B). */
  function open(n: NItem) {
    if (!n.synthetic && !n.read) {
      markRead(n.id);
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    }
    if (n.refId == null) return;
    if (n.refType === "signal") openPanel("signal", n.refId);
    else if (n.refType === "task") openPanel("task", n.refId);
  }

  async function markAll() {
    await fetch("/api/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }),
    }).catch(() => {});
    setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
  }

  const unread = items.filter((i) => !i.read && !i.synthetic).length;
  const shown = useMemo(() => items.filter((n) => {
    if (filter === "all") return true;
    if (filter === "unread") return !n.read && !n.synthetic;
    return n.type === filter;
  }), [items, filter]);

  // 구분선 위치 — 기준선보다 새로운 항목 중 가장 오래된 것 바로 앞(목록은 최신순).
  const dividerId = useMemo(() => {
    if (!marker) return null;
    const newer = shown.filter((n) => n.createdAt > marker);
    return newer.length && newer.length < shown.length ? newer[newer.length - 1].id : null;
  }, [shown, marker]);

  return (
    <div className="hv">
      <div className="top"><div className="crumb">워크스페이스 / <b>활동</b></div><span className="sp" /></div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">ACTIVITY</div>
            <h1>활동</h1>
            <p>@멘션·배정·답글·승인·공유를 한곳에서. 항목을 누르면 화면을 옮기지 않고 우측 패널이 열립니다.</p>
          </div>
          <div className="head-r">
            {unread > 0 && <button className="btn-outline" onClick={markAll}>모두 읽음 ({unread})</button>}
          </div>
        </div>

        <div className="seg act-tabs" role="group" aria-label="필터">
          {FILTERS.map(([v, label]) => (
            <button key={v} aria-pressed={filter === v} onClick={() => setFilter(v)}>
              {label}
              {v === "unread" && unread > 0 && <span className="pws-tab-n num">{unread}</span>}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="gempty">불러오는 중...</p>
        ) : shown.length === 0 ? (
          <p className="gempty">
            {filter === "all" ? "아직 활동이 없어요. @멘션·업무 공유가 생기면 여기에 모입니다." : "이 필터에 해당하는 활동이 없어요."}
          </p>
        ) : (
          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ninbox">
              {shown.map((n) => {
                const k = KIND[n.type] ?? { label: n.type, cls: "n-share", icon: "•" };
                const linked = n.refId != null && (n.refType === "task" || n.refType === "signal");
                return (
                  <div key={n.id}>
                    {dividerId === n.id && (
                      <div className="readline" role="separator" aria-label="여기까지 읽음">
                        <span>여기까지 읽음</span>
                      </div>
                    )}
                    <div
                      className={`nitem ha-host ${n.read ? "" : "unread"}`}
                      tabIndex={0}
                      role="button"
                      onClick={() => open(n)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(n); } }}
                    >
                      <span className={`n-ic ${k.cls}`}>{k.icon}</span>
                      <span className="n-b">
                        <span className="n-top">
                          <span className="n-kind">{k.label}</span>
                          {n.actorName && <span className="n-who">{n.actorName}</span>}
                          <span className="n-t num">{relTime(n.createdAt)}</span>
                        </span>
                        <span className="n-snip">{n.snippet}</span>
                        {n.type === "approval" && (
                          <span className="n-approve">
                            <Link className="lk" href="/inbox" onClick={(e) => { e.stopPropagation(); markRead(n.id); }}>
                              승인 대기로 이동 →
                            </Link>
                          </span>
                        )}
                      </span>
                      {linked && (
                        <HoverActions
                          reactionTarget={n.refType === "signal" ? { type: "signal", id: n.refId! } : { type: "task", id: n.refId! }}
                          threadLabel={n.refType === "signal" ? "스레드 열기" : "업무 열기"}
                          onThread={() => open(n)}
                          saveType={n.refType === "signal" ? "signal" : "task"}
                          saveId={n.refId!}
                          more={n.read || n.synthetic ? [] : [{
                            label: "읽음으로 표시",
                            onClick: () => { markRead(n.id); setItems((c) => c.map((x) => (x.id === n.id ? { ...x, read: true } : x))); },
                          }]}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
