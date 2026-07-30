"use client";

// 알림 인박스 (협업 C) — 멘션·배정·답글·승인·공유. 미확인 굵게+좌측 점.
// 클릭 → 해당 위치 이동 + 읽음 처리. 승인은 인라인(승인 대기로 이동).
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { relTime } from "./collab-ui";

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

function hrefFor(n: NItem): string {
  if (n.refType === "signal") return `/signals?signal=${n.refId}`;
  if (n.refType === "task") return `/tasks?task=${n.refId}`;
  if (n.refType === "activity") return `/`;
  return "/";
}

export default function NotificationInbox() {
  const router = useRouter();
  const [items, setItems] = useState<NItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
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

  async function markRead(id: number) {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => {});
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
  }

  async function open(n: NItem) {
    // 합성(마감/지연) 항목은 저장 알림이 아니므로 읽음 처리 없이 이동만
    if (!n.synthetic && !n.read) { await markRead(n.id); setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, read: true } : x))); }
    router.push(hrefFor(n));
  }

  async function markAll() {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ all: true }) }).catch(() => {});
    setItems((cur) => cur.map((x) => ({ ...x, read: true })));
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
  }

  const unread = items.filter((i) => !i.read && !i.synthetic).length;

  return (
    <div className="hv">
      <div className="top"><div className="crumb">워크스페이스 / <b>알림</b></div><span className="sp" /></div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">NOTIFICATIONS</div>
            <h1>알림</h1>
            <p>@멘션·배정·답글·승인·공유를 한곳에서. 클릭하면 해당 위치로 이동하고 읽음 처리됩니다.</p>
          </div>
          <div className="head-r">
            {unread > 0 && <button className="btn-outline" onClick={markAll}>모두 읽음 ({unread})</button>}
          </div>
        </div>

        {loading ? (
          <p className="gempty">불러오는 중...</p>
        ) : items.length === 0 ? (
          <p className="gempty">아직 알림이 없어요. @멘션·업무 공유가 생기면 여기에 모입니다.</p>
        ) : (
          <section className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="ninbox">
              {items.map((n) => {
                const k = KIND[n.type] ?? { label: n.type, cls: "n-share", icon: "•" };
                return (
                  <button key={n.id} className={`nitem ${n.read ? "" : "unread"}`} onClick={() => open(n)}>
                    <span className={`n-ic ${k.cls}`}>{k.icon}</span>
                    <span className="n-b">
                      <span className="n-top">
                        <span className="n-kind">{k.label}</span>
                        {n.actorName && <span className="mu" style={{ fontSize: 12, color: "var(--muted)" }}>{n.actorName}</span>}
                        <span className="n-t num">{relTime(n.createdAt)}</span>
                      </span>
                      <span className="n-snip">{n.snippet}</span>
                      {n.type === "approval" && (
                        <span className="n-approve">
                          <Link className="lk" href="/inbox" onClick={(e) => { e.stopPropagation(); markRead(n.id); }}>승인 대기로 이동 →</Link>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
