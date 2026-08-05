"use client";

// 활동 (MD-P-2026-007) — 1급 표면. 필터 레일(200px) + 목록 + 전역 우측 패널.
//
// 핵심은 §B 사람 ⇄ 시스템 분리다. 개발팀 최다 실패 모드가 "봇·연동 알림이 사람 메시지를
// 익사시킴"이므로 기본 탭을 [사람]으로 두고, 사이드바 배지도 사람 안읽음만 센다.
// 시스템(마감 자동 알림 등)은 숫자 없이 점으로만 알린다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { relTime } from "./collab-ui";
import HoverActions from "./HoverActions";
import { openPanel } from "@/lib/side-panel";
import { READ_LIST_EVENT } from "@/lib/shortcuts";
import { toast } from "@/lib/quick";
import { pgDate } from "@/lib/pgtime";
import {
  RAIL_KINDS, KIND_LABEL, KIND_ICON, CHANNEL_LABEL, KIND_CHANNEL,
  type ActivityKind, type Channel,
} from "@/lib/activity-kinds";

interface NItem {
  id: number;
  kind: ActivityKind;
  channel: Channel;
  type: string;
  refType: string;
  refId: number | null;
  snippet: string;
  read: boolean;
  bundleCount: number;
  actorName: string | null;
  createdAt: string;
}
interface Counts { human: number; system: number; byKind: Record<string, number> }
interface ViewFilter { kind?: ActivityKind | "all"; channel?: Channel | "all"; unreadOnly?: boolean; builtin?: string }
interface SavedView { id: number; name: string; filter: ViewFilter }

const SCOPE = "activity";

/** 기본 제공 뷰 2개 (§D) — 내장이라 삭제·이름변경이 없다. */
const BUILTIN_VIEWS: { key: string; name: string; filter: ViewFilter }[] = [
  { key: "mine", name: "내 멘션만", filter: { kind: "mention", channel: "all" } },
  { key: "todo", name: "오늘 처리할 것", filter: { builtin: "todo" } },
];

export default function ActivityInbox() {
  const [items, setItems] = useState<NItem[]>([]);
  const [counts, setCounts] = useState<Counts>({ human: 0, system: 0, byKind: {} });
  const [mute, setMute] = useState<{ allUntil: string | null; projects: number[] }>({ allUntil: null, projects: [] });
  const [views, setViews] = useState<SavedView[]>([]);
  const [loading, setLoading] = useState(true);

  const [channel, setChannel] = useState<Channel>("human"); // 기본 = 사람 (§B)
  const [kind, setKind] = useState<ActivityKind | "all">("all");
  const [activeView, setActiveView] = useState<string | null>(null); // "builtin:todo" | "saved:3"
  const [sel, setSel] = useState<number[]>([]);
  const lastClicked = useRef<number | null>(null);
  const [marker, setMarker] = useState<string | null>(null);
  const pinned = useRef(false);
  const [muteMenu, setMuteMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const [viewName, setViewName] = useState("");

  const load = useCallback(async () => {
    try {
      const [nres, mres, vres] = await Promise.all([
        fetch("/api/notifications"),
        fetch("/api/read-markers"),
        fetch("/api/notifications/views"),
      ]);
      const d = await nres.json();
      setItems(d.items ?? []);
      setCounts(d.counts ?? { human: 0, system: 0, byKind: {} });
      setMute(d.mute ?? { allUntil: null, projects: [] });
      setViews((await vres.json()).views ?? []);
      const mk = (await mres.json()).markers?.[SCOPE] ?? null;
      // 기준선은 방문 중 움직이지 않는다 — 새 항목이 들어와도 구분선이 튀지 않게.
      if (!pinned.current) { pinned.current = true; setMarker(mk); }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(load, 12000);
    return () => clearInterval(t);
  }, [load]);

  /** 읽음 기준선 갱신 — Esc(§A) 또는 목록 이탈 시. 항목 자체는 건드리지 않는다. */
  const markList = useCallback(() => {
    fetch("/api/read-markers", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: SCOPE }),
    }).catch(() => {});
  }, []);
  useEffect(() => {
    window.addEventListener(READ_LIST_EVENT, markList);
    return () => { window.removeEventListener(READ_LIST_EVENT, markList); markList(); };
  }, [markList]);

  // ── 낙관적 갱신 (실패 시 롤백) ──
  const apply = useCallback((ids: number[], action: "read" | "unread" | "archive") => {
    setItems((cur) => {
      const touched = cur.filter((i) => ids.includes(i.id));
      setCounts((c) => {
        const next = { ...c, byKind: { ...c.byKind } };
        for (const i of touched) {
          const delta = action === "read" && !i.read ? -1
            : action === "unread" && i.read ? 1
              : action === "archive" && !i.read ? -1 : 0;
          if (!delta) continue;
          next.byKind[i.kind] = Math.max(0, (next.byKind[i.kind] ?? 0) + delta);
          if (i.channel === "human") next.human = Math.max(0, next.human + delta);
          else next.system = Math.max(0, next.system + delta);
        }
        return next;
      });
      return action === "archive"
        ? cur.filter((i) => !ids.includes(i.id))
        : cur.map((i) => (ids.includes(i.id) ? { ...i, read: action === "read" } : i));
    });
  }, []);

  const bulk = useCallback(async (ids: number[], action: "read" | "unread" | "archive", label: string) => {
    if (ids.length === 0) return;
    apply(ids, action);
    setSel([]);
    const res = await fetch("/api/notifications", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action }),
    }).catch(() => null);
    if (!res || !res.ok) {
      await load(); // 롤백 — 서버 상태로 되돌린다
      toast("처리에 실패해 되돌렸어요", "err");
      return;
    }
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
    toast(`${ids.length}건 ${label}`, "ok", {
      label: "실행취소",
      onClick: async () => {
        const undo = action === "archive" ? "unarchive" : action === "read" ? "unread" : "read";
        await fetch("/api/notifications", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids, action: undo }),
        }).catch(() => {});
        await load();
        window.dispatchEvent(new CustomEvent("tb:notif-changed"));
      },
    });
  }, [apply, load]);

  async function saveBulk(ids: number[]) {
    const targets = items.filter((i) => ids.includes(i.id) && i.refId != null
      && (i.refType === "task" || i.refType === "signal"));
    if (targets.length === 0) { toast("저장할 수 있는 항목이 없어요", "err"); return; }
    await Promise.all(targets.map((t) => fetch("/api/saved", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType: t.refType, targetId: t.refId, saved: true }),
    }).catch(() => null)));
    setSel([]);
    toast(`${targets.length}건 저장됨에 담았어요`);
  }

  /** 화면 이동 없이 전역 우측 패널을 연다 (MD-P-2026-006 §B). */
  function open(n: NItem) {
    if (!n.read) {
      apply([n.id], "read");
      fetch("/api/notifications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [n.id], action: "read" }),
      }).then(() => window.dispatchEvent(new CustomEvent("tb:notif-changed"))).catch(() => {});
    }
    if (n.refId == null) return;
    if (n.refType === "signal") openPanel("signal", n.refId);
    else if (n.refType === "task") openPanel("task", n.refId);
  }

  // ── 필터 적용 ──
  const view: ViewFilter | undefined = activeView?.startsWith("builtin:")
    ? BUILTIN_VIEWS.find((v) => `builtin:${v.key}` === activeView)?.filter
    : activeView?.startsWith("saved:")
      ? views.find((v) => `saved:${v.id}` === activeView)?.filter
      : undefined;

  const shown = useMemo(() => {
    if (view?.builtin === "todo") {
      // 오늘 처리할 것 = 승인 요청 + 마감(생성 규칙상 D-2 이내만 존재) + 안읽음 멘션
      return items.filter((i) => i.kind === "approval" || i.kind === "deadline" || (i.kind === "mention" && !i.read));
    }
    const ch = view?.channel ?? channel;
    const kd = view?.kind ?? kind;
    let out = items;
    if (ch !== "all") out = out.filter((i) => i.channel === ch);
    if (kd !== "all") out = out.filter((i) => i.kind === kd);
    if (view?.unreadOnly) out = out.filter((i) => !i.read);
    return out;
  }, [items, view, channel, kind]);

  // "여기까지 읽음" 구분선 (MD-P-2026-006 §F 유지)
  // 목록은 최신순이다. 기준선보다 오래된 첫 항목 '위'에 선을 건다.
  // 전부 새 항목이면 걸 자리가 없으므로 목록 맨 아래에 건다(= 위쪽이 전부 새 소식).
  const divider = useMemo<{ beforeId: number | null; atEnd: boolean }>(() => {
    if (!marker || shown.length === 0) return { beforeId: null, atEnd: false };
    const newerCount = shown.filter((n) => n.createdAt > marker).length;
    if (newerCount === 0) return { beforeId: null, atEnd: false };   // 새 소식 없음 → 선 없음
    if (newerCount === shown.length) return { beforeId: null, atEnd: true };
    return { beforeId: shown[newerCount].id, atEnd: false };
  }, [shown, marker]);

  function toggleSel(id: number, shift: boolean) {
    if (shift && lastClicked.current !== null) {
      const ids = shown.map((i) => i.id);
      const a = ids.indexOf(lastClicked.current);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSel((cur) => Array.from(new Set([...cur, ...range])));
        return;
      }
    }
    lastClicked.current = id;
    setSel((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  async function setMutePreset(preset: "1h" | "tomorrow" | "off") {
    setMuteMenu(false);
    const res = await fetch("/api/notifications/mute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "all", preset }),
    }).catch(() => null);
    if (!res || !res.ok) { toast("음소거 설정에 실패했어요", "err"); return; }
    setMute(await res.json());
    window.dispatchEvent(new CustomEvent("tb:notif-changed"));
    toast(preset === "off" ? "음소거를 해제했어요" : "알림을 잠시 껐어요");
  }

  async function muteProject(n: NItem) {
    const res = await fetch("/api/notifications/mute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scope: "project", refType: n.refType, refId: n.refId, on: true }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) { toast(d?.error ?? "음소거에 실패했어요", "err"); return; }
    setMute(d);
    toast("이 프로젝트 알림을 껐어요", "ok", {
      label: "실행취소",
      onClick: async () => {
        await fetch("/api/notifications/mute", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "project", projectId: d.projectId, on: false }),
        }).catch(() => {});
        await load();
      },
    });
  }

  async function saveCurrentView() {
    const name = viewName.trim();
    if (!name) return;
    setSaving(true);
    const res = await fetch("/api/notifications/views", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, filter: { kind, channel } }),
    }).catch(() => null);
    setSaving(false);
    const d = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) { toast(d?.error ?? "저장에 실패했어요", "err"); return; }
    setViewName("");
    await load();
    toast(`"${name}" 뷰를 저장했어요`);
  }

  const railCounts = counts.byKind;
  const muteUntil = pgDate(mute.allUntil);
  const muteUntilLabel = muteUntil
    ? muteUntil.toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="hv actv">
      <div className="top"><div className="crumb">워크스페이스 / <b>활동</b></div><span className="sp" /></div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">ACTIVITY</div>
            <h1>활동</h1>
            <p>사람이 부른 것과 시스템이 알린 것을 나눠 봅니다. 항목을 누르면 화면을 옮기지 않고 우측 패널이 열립니다.</p>
          </div>
          <div className="head-r">
            {muteUntilLabel && <span className="actv-muted" role="status">🔕 {muteUntilLabel}까지 음소거</span>}
            <div className="actv-mute-wrap">
              <button className="btn-outline" aria-expanded={muteMenu} onClick={() => setMuteMenu((v) => !v)}>
                {mute.allUntil ? "음소거 중" : "임시 음소거"}
              </button>
              {muteMenu && (
                <div className="actv-mute-menu" role="menu">
                  <button onClick={() => setMutePreset("1h")}>1시간</button>
                  <button onClick={() => setMutePreset("tomorrow")}>내일 오전 9시까지</button>
                  <button onClick={() => setMutePreset("off")}>해제</button>
                </div>
              )}
            </div>
            <button className="btn-outline"
              onClick={() => bulk(shown.filter((i) => !i.read).map((i) => i.id), "read", "읽음 처리했어요")}>
              이 필터 모두 읽음
            </button>
            <button className="btn-outline"
              onClick={() => bulk(items.filter((i) => !i.read).map((i) => i.id), "read", "읽음 처리했어요")}>
              모두 읽음
            </button>
          </div>
        </div>

        <div className="actv-body">
          {/* ── 필터 레일 (200px) ── */}
          <nav className="actv-rail" aria-label="활동 필터">
            <button className={`actv-r${!activeView && kind === "all" ? " on" : ""}`}
              onClick={() => { setActiveView(null); setKind("all"); }}>
              <span>전체</span>
              <em className="num">{channel === "human" ? counts.human : counts.system}</em>
            </button>
            {RAIL_KINDS.filter((k) => KIND_CHANNEL[k] === channel).map((k) => (
              <button key={k} className={`actv-r${!activeView && kind === k ? " on" : ""}`}
                onClick={() => { setActiveView(null); setKind(k); }}>
                <i className="actv-ic" aria-hidden="true"
                  style={{ color: `var(${KIND_ICON[k].tone})`, background: `color-mix(in srgb, var(${KIND_ICON[k].tone}) 13%, var(--card))` }}>
                  {KIND_ICON[k].icon}
                </i>
                <span>{KIND_LABEL[k]}</span>
                {(railCounts[k] ?? 0) > 0 && <em className="num">{railCounts[k]}</em>}
              </button>
            ))}

            <div className="actv-rail-sep" />
            <div className="actv-rail-h">저장된 뷰</div>
            {BUILTIN_VIEWS.map((v) => (
              <button key={v.key} className={`actv-r sm${activeView === `builtin:${v.key}` ? " on" : ""}`}
                onClick={() => setActiveView(activeView === `builtin:${v.key}` ? null : `builtin:${v.key}`)}>
                <span>{v.name}</span>
              </button>
            ))}
            {views.map((v) => (
              <div key={v.id} className={`actv-r sm ha-host${activeView === `saved:${v.id}` ? " on" : ""}`}>
                <button className="actv-r-b"
                  onClick={() => setActiveView(activeView === `saved:${v.id}` ? null : `saved:${v.id}`)}>
                  {v.name}
                </button>
                <HoverActions more={[
                  {
                    label: "이름 바꾸기",
                    onClick: async () => {
                      const name = window.prompt("새 이름", v.name);
                      if (!name?.trim()) return;
                      await fetch("/api/notifications/views", {
                        method: "PATCH", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ id: v.id, name: name.trim() }),
                      }).catch(() => {});
                      await load();
                    },
                  },
                  {
                    label: "삭제", danger: true,
                    onClick: async () => {
                      await fetch(`/api/notifications/views?id=${v.id}`, { method: "DELETE" }).catch(() => {});
                      if (activeView === `saved:${v.id}`) setActiveView(null);
                      await load();
                    },
                  },
                ]} />
              </div>
            ))}
            <div className="actv-save">
              <input value={viewName} placeholder="현재 필터 저장…" maxLength={40}
                onChange={(e) => setViewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") saveCurrentView(); }} />
              <button className="lk" disabled={saving || !viewName.trim()} onClick={saveCurrentView}>저장</button>
            </div>
          </nav>

          {/* ── 목록 ── */}
          <div className="actv-main">
            <div className="actv-bar">
              <div className="seg" role="group" aria-label="채널">
                {(["human", "system"] as Channel[]).map((c) => (
                  <button key={c} aria-pressed={channel === c && !activeView}
                    onClick={() => {
                      setActiveView(null);
                      setChannel(c);
                      // 다른 채널의 종류 필터가 남아 있으면 빈 목록이 된다 — 전체로 되돌린다
                      setKind((cur) => (cur !== "all" && KIND_CHANNEL[cur] !== c ? "all" : cur));
                    }}>
                    {CHANNEL_LABEL[c]}
                    {c === "human" && counts.human > 0 && <span className="pws-tab-n num">{counts.human}</span>}
                    {/* 시스템은 숫자 없이 점으로만 (§B) */}
                    {c === "system" && counts.system > 0 && <span className="actv-dot" title="새 시스템 알림" />}
                  </button>
                ))}
              </div>
              {activeView && (
                <span className="actv-viewtag">
                  저장된 뷰 적용 중 · <button className="lk" onClick={() => setActiveView(null)}>해제</button>
                </span>
              )}
              <span style={{ flex: 1 }} />
              {sel.length > 0 && (
                <div className="actv-bulk" role="group" aria-label="선택 처리">
                  <b className="num">{sel.length} 선택</b>
                  <button className="btn small" onClick={() => bulk(sel, "read", "읽음 처리했어요")}>읽음</button>
                  <button className="btn small" onClick={() => saveBulk(sel)}>저장</button>
                  <button className="btn small" onClick={() => bulk(sel, "archive", "보관했어요")}>보관</button>
                  <button className="lk" onClick={() => setSel([])}>선택 해제</button>
                </div>
              )}
            </div>

            {loading ? (
              <p className="gempty">불러오는 중...</p>
            ) : shown.length === 0 ? (
              <div className="actv-empty">
                <p>새 활동이 없어요.</p>
                <p className="sub">자주 쓰는 필터는 왼쪽 아래 <b>저장된 뷰</b>로 고정해두면 한 번에 돌아올 수 있어요.</p>
              </div>
            ) : (
              <section className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div className="ninbox">
                  {shown.map((n) => {
                    const ic = KIND_ICON[n.kind];
                    const linked = n.refId != null && (n.refType === "task" || n.refType === "signal");
                    return (
                      <div key={n.id}>
                        {divider.beforeId === n.id && (
                          <div className="readline" role="separator" aria-label="여기까지 읽음">
                            <span>여기까지 읽음</span>
                          </div>
                        )}
                        <div
                          className={`nitem ha-host${n.read ? "" : " unread"}${sel.includes(n.id) ? " picked" : ""}`}
                          tabIndex={0} role="button"
                          onClick={() => open(n)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); open(n); } }}
                        >
                          <span className="actv-check">
                            <input type="checkbox" checked={sel.includes(n.id)} aria-label="선택"
                              onChange={() => {}}
                              onClick={(e) => { e.stopPropagation(); toggleSel(n.id, e.shiftKey); }} />
                          </span>
                          <span className="n-ic" aria-hidden="true"
                            style={{ color: `var(${ic.tone})`, background: `color-mix(in srgb, var(${ic.tone}) 13%, var(--card))` }}>
                            {ic.icon}
                          </span>
                          <span className="n-b">
                            <span className="n-top">
                              <span className="n-kind">{KIND_LABEL[n.kind]}</span>
                              {n.bundleCount > 1 && <span className="actv-bundle num">{KIND_LABEL[n.kind]} {n.bundleCount}개</span>}
                              {n.actorName && <span className="n-who">{n.actorName}</span>}
                              <span className="n-t num">{relTime(n.createdAt)}</span>
                            </span>
                            <span className="n-snip">{n.snippet}</span>
                            {n.kind === "approval" && (
                              <span className="n-approve">
                                <Link className="lk" href="/inbox" onClick={(e) => e.stopPropagation()}>승인 대기로 이동 →</Link>
                              </span>
                            )}
                          </span>
                          {/* 시스템 알림에는 리액션·답글을 붙이지 않는다 — 마감 알림에 이모지를 달 이유가 없다.
                              사람 알림: 리액션 · 스레드 · 저장 · ⋯ / 시스템 알림: 저장 · 원본 열기 · ⋯ (MD-P-2026-018 §C) */}
                          <HoverActions
                            reactionTarget={
                              linked && n.channel === "human"
                                ? (n.refType === "signal" ? { type: "signal", id: n.refId! } : { type: "task", id: n.refId! })
                                : undefined
                            }
                            threadLabel={n.channel === "system" ? "원본 열기" : n.refType === "signal" ? "스레드 열기" : "업무 열기"}
                            onThread={linked ? () => open(n) : undefined}
                            saveType={linked ? (n.refType === "signal" ? "signal" : "task") : undefined}
                            saveId={linked ? n.refId! : undefined}
                            more={[
                              n.read
                                ? { label: "안읽음으로 표시", onClick: () => bulk([n.id], "unread", "안읽음으로 되돌렸어요") }
                                : { label: "읽음으로 표시", onClick: () => bulk([n.id], "read", "읽음 처리했어요") },
                              { label: "보관", onClick: () => bulk([n.id], "archive", "보관했어요") },
                              ...(linked ? [{ label: "이 프로젝트 알림 끄기", danger: true, onClick: () => muteProject(n) }] : []),
                            ]}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {divider.atEnd && (
                    <div className="readline" role="separator" aria-label="여기까지 읽음">
                      <span>여기까지 읽음</span>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
