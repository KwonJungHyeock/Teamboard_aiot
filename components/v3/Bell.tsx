"use client";

// 알림함 — 위 막대의 종 (2026-10). 옛 「알림함」을 지운 뒤에도 알림(배정 · 멘션 · 마감 …)은
// 계속 쌓이고 있었는데 볼 곳이 없었다. 기존 `/api/notifications` 를 그대로 쓴다 — 새 규칙 없음.
//
//   · 숫자는 **사람이 보낸 안 읽은 것**만(배정 · 멘션 · 답글 · 승인 · 결정). 시스템(마감)은 점 하나
//   · 누르면 그 업무로 가고 읽음이 된다. 「모두 읽음」 한 번
//   · 1분마다 다시 묻는다 — 탭이 숨어 있으면 쉰다
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KIND_LABEL, type ActivityKind } from "@/lib/activity-kinds";
import { taskHref } from "@/lib/v3/routes";

interface Item {
  id: number; kind: ActivityKind; channel: "human" | "system"; refType: string; refId: number | null;
  snippet: string; read: boolean; bundleCount: number; actorName: string | null; createdAt: string;
}

function ago(s: string, now: number): string {
  const t = Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z"));
  if (Number.isNaN(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 60 / 24)}일 전`;
}
const hrefOf = (i: Item) => (i.refType === "task" && i.refId ? taskHref(i.refId) : null);

export default function Bell() {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [sysUnread, setSysUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    setItems((d.items ?? []).slice(0, 40)); setUnread(d.unread ?? 0); setSysUnread(d.systemUnread ?? 0); setNow(Date.now());
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);
  // 바깥을 누르거나 Esc 면 닫힌다
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const mark = async (body: unknown) => {
    await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  };
  const go = async (i: Item) => {
    if (!i.read) { setItems((xs) => xs.map((x) => (x.id === i.id ? { ...x, read: true } : x))); await mark({ id: i.id, action: "read" }); }
    const h = hrefOf(i);
    setOpen(false);
    if (h) router.push(h);
    load();
  };
  const readAll = async () => { await mark({ all: true }); load(); };

  const label = unread ? `알림 — 안 읽은 것 ${unread}개` : sysUnread ? "알림 — 새 마감 소식" : "알림";
  return (
    <div className="v3-bell" ref={box}>
      <button type="button" className={`v3-bell-b${open ? " on" : ""}`} aria-label={label} aria-expanded={open}
              onClick={() => { setOpen((o) => !o); if (!open) load(); }}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor"
          d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-1.7 1.7A1 1 0 0 0 4 19.4h16a1 1 0 0 0 .7-1.7L19 16Z" /></svg>
        {unread > 0 ? <span className="v3-bell-n">{unread > 99 ? "99+" : unread}</span> : sysUnread > 0 ? <span className="v3-bell-dot" /> : null}
      </button>
      {open && (
        <div className="v3-bell-p" role="dialog" aria-label="알림함">
          <div className="v3-bell-h">
            <b>알림</b>
            {(unread > 0 || sysUnread > 0) && <button type="button" onClick={() => void readAll()}>모두 읽음</button>}
          </div>
          {items.length === 0 ? <p className="v3-bell-e">새 알림이 없습니다.</p> : (
            <ul>
              {items.map((i) => (
                <li key={i.id}>
                  <button type="button" className={`v3-bell-i${i.read ? "" : " new"}`} onClick={() => void go(i)}>
                    <span className={`v3-bell-k ${i.channel}`}>{KIND_LABEL[i.kind] ?? i.kind}</span>
                    <span className="v3-bell-s">{i.snippet}{i.bundleCount > 1 ? ` · ${i.bundleCount}개` : ""}</span>
                    <em>{i.actorName ? `${i.actorName} · ` : ""}{ago(i.createdAt, now)}</em>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
