"use client";

// 공통 프레임 — 배경 레이어 · 상단 메뉴바(로고 · 캡슐 메뉴 · 테마 · 계정) · LIVE 티커 (DESIGN.md 3장).
// 업무 상세 드로어도 여기서 띄운다: 어느 화면이든 주소에 `?task=ID` 가 붙으면 열린다.
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MENU } from "@/lib/v3/nine";
import { V3_BASE } from "@/lib/v3/routes";
import { DENIED_PARAM } from "@/lib/denied";
import { ago, initial } from "@/lib/ed/core";
import { KIND_LABEL, type ActivityKind } from "@/lib/activity-kinds";
import TaskDrawer from "./TaskDrawer";
import { Drawer } from "./ui";

export interface FrameUser { id: number; name: string; roleLabel: string; lead: boolean; admin: boolean }

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState("light");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light"); }, []);
  const toggle = useCallback(() => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("eduino-theme", next); } catch { /* 저장 못 해도 이 화면은 바뀐다 */ }
    setTheme(next);
  }, []);
  return [theme, toggle];
}

/** 배경 — blob 2 · 점 그리드 · 커서를 따라오는 빛 */
export function Backdrop() {
  const spot = useRef<HTMLElement>(null);
  useEffect(() => {
    let raf = 0;
    const move = (e: MouseEvent) => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => { if (spot.current) spot.current.style.transform = `translate(${e.clientX}px,${e.clientY}px)`; });
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => { window.removeEventListener("mousemove", move); cancelAnimationFrame(raf); };
  }, []);
  return (
    <div className="ed-bg" aria-hidden="true"><i className="a" /><i className="b" /><i className="g" /><i className="s" ref={spot} /></div>
  );
}

export function ThemePill() {
  const [theme, toggle] = useTheme();
  return <button type="button" className="ed-pill" title="테마" onClick={toggle}>{theme === "dark" ? "라이트" : "다크"}</button>;
}

interface Note { id: number; kind: ActivityKind; refType: string; refId: number | null; snippet: string; read: boolean; bundleCount: number; actorName: string | null; createdAt: string }

function Account({ user }: { user: FrameUser }) {
  const router = useRouter();
  const box = useRef<HTMLDetailsElement>(null);
  const [unread, setUnread] = useState(0);
  const [notes, setNotes] = useState<Note[] | null>(null);
  const load = useCallback(async () => {
    const r = await fetch("/api/notifications", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const d = await r.json();
    setUnread(d.unread ?? 0);
    return (d.items ?? []).slice(0, 40) as Note[];
  }, []);
  useEffect(() => {
    void load();
    const t = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 60000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (box.current?.open && !box.current.contains(e.target as Node)) box.current.open = false; };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && box.current) box.current.open = false; };
    document.addEventListener("mousedown", onDown); document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, []);
  const close = () => { if (box.current) box.current.open = false; };
  const openNotes = async () => { close(); setNotes((await load()) ?? []); };
  const mark = (body: unknown) => fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  const go = async (n: Note) => {
    if (!n.read) await mark({ id: n.id, action: "read" });
    setNotes(null); void load();
    if (n.refType === "task" && n.refId) router.push(`${V3_BASE}/my?task=${n.refId}`);
    else if (n.refType === "monthly_report" && n.refId) router.push(`${V3_BASE}/report?r=${n.refId}`);
  };
  return (
    <>
      <details className="ed-acct" ref={box}>
        <summary>
          <span className="ed-av">{initial(user.name)}{unread > 0 && <i className="nd" />}</span>
          <span className="nm">{user.name}</span><span className="cv">▼</span>
        </summary>
        <div className="ed-menu">
          <div className="pf">
            <span className="ed-av lg">{initial(user.name)}</span>
            <div style={{ minWidth: 0 }}><b>{user.name}</b><small>{user.roleLabel}</small></div>
          </div>
          <hr />
          <button type="button" onClick={() => void openNotes()}>알림{unread > 0 && <span className="cnt">{unread > 99 ? "99+" : unread}</span>}</button>
          <Link href={`${V3_BASE}/me`} onClick={close}>내 정보</Link>
          {user.admin && <Link href={`${V3_BASE}/members`} onClick={close}>구성원 관리</Link>}
          <Link href={`${V3_BASE}/me#push`} onClick={close}>알림 설정</Link>
          {user.lead && <Link href={`${V3_BASE}/settings`} onClick={close}>설정</Link>}
          <hr />
          <a className="out" href="/api/auth/logout">로그아웃</a>
        </div>
      </details>
      {notes && (
        <Drawer onClose={() => setNotes(null)} width={420}>
          <div className="dh">
            <div style={{ flex: 1, fontSize: 20, fontWeight: 700 }}>알림</div>
            {unread > 0 && <button type="button" className="ed-btn sm" onClick={async () => { await mark({ all: true }); setNotes((await load()) ?? []); }}>모두 읽음</button>}
            <button type="button" className="ed-x" onClick={() => setNotes(null)} aria-label="닫기">✕</button>
          </div>
          <div className="db" style={{ gap: 2 }}>
            {notes.length === 0 ? <div className="ed-empty">새 알림 없음</div> : notes.map((n) => (
              <button key={n.id} type="button" className="ed-note" onClick={() => void go(n)} data-new={n.read ? undefined : "1"}>
                <span className="k">{KIND_LABEL[n.kind] ?? n.kind}</span>
                <span className="s">{n.snippet}{n.bundleCount > 1 ? ` · ${n.bundleCount}개` : ""}</span>
                <em>{n.actorName ? `${n.actorName} · ` : ""}{ago(n.createdAt.replace(" ", "T").replace(/\+00$/, "Z"))}</em>
              </button>
            ))}
          </div>
        </Drawer>
      )}
    </>
  );
}

interface Tick { id: number; who: string | null; message: string; at: string }
/** LIVE 티커 — 최신 활동 1줄. 20초마다 묻고, 바뀌면 tickIn */
function LiveTicker() {
  const [t, setT] = useState<Tick | null>(null);
  const [, setNow] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await fetch("/api/live", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !alive) return;
      const d = await r.json();
      const top = (d.entries ?? [])[0] as Tick | undefined;
      if (top) {
        setT((cur) => (cur?.id === top.id ? cur : top));
        window.dispatchEvent(new CustomEvent("ed:live", { detail: d.entries }));
      }
      setNow(Date.now());
    };
    void load();
    const iv = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 20000);
    window.addEventListener("ed:changed", load);
    return () => { alive = false; clearInterval(iv); window.removeEventListener("ed:changed", load); };
  }, []);
  if (!t) return <footer className="ed-live"><span>LIVE</span><div /></footer>;
  // 「권정혁이(가) 업무 완료 — "…"」 → 이름(굵게) + 나머지
  const name = t.who ?? "";
  let rest = t.message;
  if (name && rest.startsWith(name)) rest = rest.slice(name.length).replace(/^이\(가\)\s*/, "").replace(/^(이|가)\s+/, "");
  return (
    <footer className="ed-live">
      <span>LIVE</span>
      <div key={t.id}>{name && <b>{name}</b>}{rest}<small>{ago(t.at)}</small></div>
    </footer>
  );
}

/** 권한 없는 화면에서 돌아왔을 때 한 줄(`?denied=`) — 닫으면 주소에서도 뺀다 */
function DeniedToast() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const k = sp.get(DENIED_PARAM);
  useEffect(() => {
    if (!k) return;
    const t = setTimeout(() => {
      const q = new URLSearchParams(sp.toString()); q.delete(DENIED_PARAM);
      router.replace(q.toString() ? `${path}?${q}` : path, { scroll: false });
    }, 3200);
    return () => clearTimeout(t);
  }, [k, sp, router, path]);
  return k ? <div className="ed-toast" role="status">권한이 없는 화면입니다</div> : null;
}

function DrawerHost() {
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const id = Number(sp.get("task"));
  if (!Number.isInteger(id) || id <= 0) return null;
  const close = () => {
    const q = new URLSearchParams(sp.toString()); q.delete("task");
    router.replace(q.toString() ? `${path}?${q}` : path, { scroll: false });
  };
  return <TaskDrawer key={id} id={id} onClose={close} />;
}

export default function Frame({ user, children }: { user: FrameUser; children: React.ReactNode }) {
  const path = usePathname() ?? "";
  const scroll = path.startsWith(`${V3_BASE}/stats`);
  useEffect(() => { document.body.classList.toggle("ed-scroll-page", scroll); }, [scroll]);
  return (
    <div className={`ed-app${scroll ? " scroll" : ""}`}>
      <Backdrop />
      <header className="ed-top">
        <Link href={`${V3_BASE}/control`} className="ed-logo" aria-label="업무 현황으로">
          <img className="lt" src="/brand/ed-mark.png" alt="" /><img className="dk" src="/brand/ed-mark-dark.png" alt="" />
          <b><span>통합업무관리</span><span>AI 로봇 플랫폼팀</span></b>
        </Link>
        <nav className="ed-nav" aria-label="메뉴">
          {MENU.filter((m) => !m.lead || user.lead).map((m) => {
            const on = m.match.some((p) => path === p || path.startsWith(`${p}/`));
            return <Link key={m.href} href={m.href} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>{m.label}</Link>;
          })}
        </nav>
        <div className="ed-right"><ThemePill /><Account user={user} /></div>
      </header>
      <main className="ed-main">{children}</main>
      <LiveTicker />
      <Suspense fallback={null}><DrawerHost /><DeniedToast /></Suspense>
    </div>
  );
}
