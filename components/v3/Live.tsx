"use client";

// 줄에서 바로 끝내기 — **공용 부품** (MD-P-2026-070 §A · §B · §C · §D · §F · §G).
//
// ── 켜는 자리는 한 줄이다 (§G-50) ────────────────────────────────
//
//     <Live tasks={tasks} setTasks={setTasks} goals={…}> … </Live>
//
// 이 안에 있는 줄(`LiveCheck` · `StatusChip` · `QuickActions`)만 움직인다. 밖에서는
// 전부 `null` 이거나 예전 모양 그대로다 — 업무 목록은 다음 회차에 이 한 줄을
// 더하면 붙는다. 대시보드 안에 숨겨 두지 않는다(§G-49).
//
// ── 무엇을 보내는가 ─────────────────────────────────────────────
//
// **`PATCH /api/tasks/{id}` 에 `{ status }` 하나.** 새 API 는 없다(§B · §H-53).
// 규칙(문구 · 시간 · 키 · 찾기)은 전부 `lib/v3/live.ts` 에 있다 — 검사기가 같은
// 함수를 부른다.
import {
  createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from "react";
import { Checkbox, type CbState } from "./parts";
import {
  toastMs, STATUS_PICK, pickLabel, toggled, changedLine, undoneLine, FAIL_LINE,
  PROGRESS_KEPT_LINE, progressToRestore, canRestoreProgress, clip,
  nextTimeLine, SHORTCUTS, keyAct, moveSel, findItems, FIND_GROUPS, type FindItem,
} from "@/lib/v3/live";
import { NINE } from "@/lib/v3/nine";

/** 이 부품이 다루는 업무 한 줄 — 대시보드와 목록이 같이 쓰는 모양의 부분집합. */
export interface LiveTask {
  id: number;
  title: string;
  status: string;
  completedAt?: string | null;
  /** 실효 진척 — 되돌리기가 **원래 값**을 다시 보낸다 (073 §A) */
  progress?: number;
  /** 집계 대상 하위 수 — 있으면 진척은 하위로 계산된다 */
  childCounted?: number;
}

/* ══ §F 움직임 — 값은 CSS 한 곳(`--v3-motion`)에 있다 ═══════════════ */

/**
 * 움직여도 되는가. `prefers-reduced-motion` 을 **여기서 다시 묻지 않는다** —
 * CSS 한 덩어리가 그 조건에서 `--v3-motion` 을 0 으로 만든다(§F-48). JS 는 그
 * 값을 읽을 뿐이다. 조건이 두 곳에 있으면 한쪽만 고쳐진다.
 */
export function motionOn(): boolean {
  if (typeof window === "undefined") return false;
  const root = document.querySelector(".v3") ?? document.documentElement;
  const v = getComputedStyle(root).getPropertyValue("--v3-motion").trim();
  return v !== "" && parseFloat(v) > 0;
}

/* ══ §A-1 토스트 ═══════════════════════════════════════════════════ */

interface ToastIn { strong?: string; text: string; action?: { label: string; run: () => void } }
interface ToastRow extends ToastIn { id: number }

/* ══ 맥락 ══════════════════════════════════════════════════════════ */

interface Ctx {
  toast: (t: ToastIn) => number;
  dismiss: (id: number) => void;
  toggle: (id: number) => void;
  setStatus: (id: number, next: string) => void;
  openPicker: (id: number, anchor: HTMLElement) => void;
  pickerFor: number | null;
  soon: (what: string) => void;
  /** 처음 건드렸을 때의 상태 — 줄이 목록에서 **빠지지 않게** 한다(§B-12) */
  listedStatus: (t: { id: number; status: string }) => string;
}
const LiveCtx = createContext<Ctx | null>(null);
/** 밖에서 부르면 `null` — 그러면 부품은 예전 모양 그대로다. */
export function useLive(): Ctx | null { return useContext(LiveCtx); }

function typing(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !n.tagName) return false;
  const tag = n.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || n.isContentEditable === true;
}

export function Live<T extends LiveTask>({
  tasks, setTasks, goals, onNew, me, children,
}: {
  tasks: T[] | null;
  /** 보는 사람의 actor.id — 진행률을 되돌릴 권한을 묻는다 (073 §A-6) */
  me: number;
  setTasks: (f: (ts: T[] | null) => T[] | null) => void;
  /** ⌘K 의 「목표」 묶음 */
  goals?: { id: number; title: string }[] | null;
  /** C — 새 업무. 셸이 이미 듣고 있으면 안 준다 */
  onNew?: () => void;
  children: React.ReactNode;
}) {
  const [toasts, setToasts] = useState<ToastRow[]>([]);
  const seq = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const h = timers.current.get(id);
    if (h) { clearTimeout(h); timers.current.delete(id); }
  }, []);
  /** 한 동작에 한 줄. 버튼이 있으면 5초, 없으면 2.6초(§A-1-2). */
  const toast = useCallback((t: ToastIn) => {
    const id = ++seq.current;
    setToasts((ts) => [...ts, { ...t, id }]);
    timers.current.set(id, setTimeout(() => dismiss(id), toastMs(!!t.action)));
    return id;
  }, [dismiss]);
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  /*
   * ── §B-12 줄이 **빠지지 않는다** ──────────────────────────────────
   * 「내 업무」는 안 끝난 것만 모은다. 체크하자마자 줄이 사라지면 취소선도
   * 되돌리기도 볼 수 없다. 그래서 **처음 건드렸을 때의 상태**를 기억해 두고,
   * 목록에 넣을지는 그 상태로 정한다. 숫자(타일)는 지금 상태로 센다.
   */
  const firstStatus = useRef(new Map<number, string>());
  const [, bump] = useState(0);
  const listedStatus = useCallback(
    (t: { id: number; status: string }) => firstStatus.current.get(t.id) ?? t.status, []);

  /* ── §A-2 낙관적 업데이트 ──────────────────────────────────────── */
  /** 같은 업무의 요청은 **차례로** 보낸다. 되돌리기가 앞 요청을 앞지르면 순서가 뒤집힌다. */
  const lanes = useRef(new Map<number, Promise<unknown>>());
  const send = useCallback((id: number, body: { status: string; progress?: number }): Promise<boolean> => {
    const prev = lanes.current.get(id) ?? Promise.resolve();
    const p = prev.then(() => fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then((r) => r.ok).catch(() => false));
    lanes.current.set(id, p);
    return p;
  }, []);

  /*
   * ── 073 §A — 진행률 편집자 ─────────────────────────────────────────
   * 되돌리기가 진행률을 되돌릴 수 있는지는 **서버와 같은 함수**(`canEditProgress`)로 묻는다.
   * 편집자 번호는 이미 있는 `/api/meta/selectors` 가 준다 — 새 API 는 없다. 못 받으면 `null`
   * (= 권한 없음)이고, 그때는 상태만 되돌리고 그렇다고 **말한다**.
   */
  const editorId = useRef<number | null>(null);
  /** 편집자 번호를 받는 중이면 되돌리기가 **기다린다** — 받기 전에 누르면 권한 없음으로 잘못 읽는다 */
  const editorReady = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    editorReady.current = fetch("/api/meta/selectors").then((r) => (r.ok ? r.json() : null)).then((d) => {
      editorId.current = typeof d?.progressEditorId === "number" ? d.progressEditorId : null;
    }).catch(() => {});
  }, []);

  /**
   * @param restore 되돌리기일 때 — **앞 동작 전의 진행률.** 앞 동작이 진행률을 안 바꿨으면 `null`.
   */
  const change = useCallback(function change(
    id: number, next: string, mode: "do" | "undo", restore: number | null = null,
  ) {
    const t = (tasksRef.current ?? []).find((x) => x.id === id);
    if (!t || t.status === next) return;
    const prev = t.status;
    const prevDone = t.completedAt ?? null;
    const prevProgress = t.progress;
    if (!firstStatus.current.has(id)) { firstStatus.current.set(id, prev); bump((n) => n + 1); }
    /*
     * 보낼 것 — 상태 하나, 또는 (되돌리기이고 · 앞 동작이 진행률을 바꿨고 · 되돌릴 권한이 있으면)
     * 진행률까지. 권한 없이 진행률을 같이 보내면 **요청 전체가 403** 이라 상태도 안 돌아간다.
     */
    const withProgress = mode === "undo" && restore !== null && canRestoreProgress(me, editorId.current);
    const keptProgress = mode === "undo" && restore !== null && !withProgress;
    const body = withProgress ? { status: next, progress: restore as number } : { status: next };
    // ① 화면을 **먼저** 바꾼다 — 서버를 기다려 멈추지 않는다(§A-2-5). 완료면 서버가 100 으로 올린다
    setTasks((ts) => ts && ts.map((x) => (x.id === id
      ? { ...x, status: next, completedAt: next === "done" ? new Date().toISOString() : null,
          progress: next === "done" ? 100 : withProgress ? (restore as number) : x.progress } : x)));
    const line = mode === "undo" ? undoneLine(next, t.title) : changedLine(next, t.title);
    // 073 §A-6 — 권한이 없어 진행률은 못 되돌렸으면 **그렇다고 적는다**
    const shown = toast(keptProgress
      ? { text: `${PROGRESS_KEPT_LINE} · ${clip(t.title)}` }
      : mode === "undo"
        ? { strong: line.strong, text: line.rest }
        : { strong: line.strong, text: line.rest,
            action: { label: "되돌리기", run: () => {
              const restoreTo = progressToRestore(t, next);
              void editorReady.current.then(() => change(id, prev, "undo", restoreTo));
            } } });
    // ② 그다음 보낸다
    void send(id, body).then((ok) => {
      if (ok) return;
      // ③ 실패 — **원래대로 되돌리고 알린다.** 조용히 되돌리지 않는다(§A-2-6)
      setTasks((ts) => ts && ts.map((x) => (x.id === id && x.status === next
        ? { ...x, status: prev, completedAt: prevDone, progress: prevProgress } : x)));
      dismiss(shown);
      toast({ text: FAIL_LINE, action: { label: "다시", run: () => change(id, next, mode, restore) } });
    });
  }, [send, setTasks, toast, dismiss, me]);

  const toggle = useCallback((id: number) => {
    const t = (tasksRef.current ?? []).find((x) => x.id === id);
    if (t) change(id, toggled(t.status), "do");
  }, [change]);
  const setStatus = useCallback((id: number, next: string) => change(id, next, "do"), [change]);
  const soon = useCallback((what: string) => { toast({ text: nextTimeLine(what) }); }, [toast]);

  /* ── §B-2 고르개 ───────────────────────────────────────────────── */
  const [picker, setPicker] = useState<{ id: number; anchor: HTMLElement } | null>(null);
  const openPicker = useCallback((id: number, anchor: HTMLElement) => {
    setPicker((p) => (p && p.id === id && p.anchor === anchor ? null : { id, anchor }));
  }, []);

  /* ── §C 키보드 — 고른 줄은 DOM 차례로 센다 ────────────────────────
   * 같은 업무가 「내 업무」와 「오늘 할 일」에 둘 다 설 수 있다. 번호가 아니라
   * **화면에 선 차례**로 옮겨야 J 가 눈에 보이는 순서대로 간다. 고른 표시는
   * `data-sel` 로 단다 — React 가 관리하는 className 을 손으로 건드리지 않는다.
   */
  const box = useRef<HTMLDivElement>(null);
  const sel = useRef(-1);
  const rows = (): HTMLElement[] =>
    Array.from(box.current?.querySelectorAll<HTMLElement>("[data-live-row]") ?? []);
  const mark = useCallback((i: number) => {
    const rs = rows();
    rs.forEach((r, k) => { if (k === i) r.setAttribute("data-sel", "1"); else r.removeAttribute("data-sel"); });
    sel.current = i;
    // 화면 안으로 따라온다(§C-27). 움직임이 꺼져 있으면 바로 간다(§F-46).
    rs[i]?.scrollIntoView({ block: "nearest", behavior: motionOn() ? "smooth" : "auto" });
  }, []);
  const selRow = () => rows()[sel.current] ?? null;

  const [find, setFind] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const act = keyAct(e, typing(e.target));
      if (!act) return;
      if (act === "find") { e.preventDefault(); setPicker(null); setFind((v) => !v); return; }
      if (act === "close") { setPicker(null); setFind(false); return; }
      if (find) return;                               // 찾기가 열려 있으면 줄 키는 쉰다
      if (act === "new") { if (onNew) { e.preventDefault(); onNew(); } return; }
      if (act === "next" || act === "prev") {
        e.preventDefault();
        setPicker(null);
        mark(moveSel(sel.current, rows().length, act === "next" ? 1 : -1));
        return;
      }
      const r = selRow();
      const id = Number(r?.getAttribute("data-live-row"));
      if (!r || !id) return;
      e.preventDefault();
      if (act === "toggle") toggle(id);
      if (act === "status") {
        const chip = r.querySelector<HTMLElement>("[data-live-chip]");
        if (chip) setPicker({ id, anchor: chip });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [find, mark, onNew, toggle]);

  // 줄을 마우스로 누르면 그 줄이 골라진다 — 키보드와 마우스가 같은 「고른 줄」을 본다
  const onClickBox = (e: React.MouseEvent) => {
    const r = (e.target as HTMLElement).closest("[data-live-row]") as HTMLElement | null;
    if (!r) return;
    const i = rows().indexOf(r);
    if (i >= 0 && i !== sel.current) {
      rows().forEach((x, k) => { if (k === i) x.setAttribute("data-sel", "1"); else x.removeAttribute("data-sel"); });
      sel.current = i;
    }
  };

  const ctx = useMemo<Ctx>(() => ({
    toast, dismiss, toggle, setStatus, openPicker, pickerFor: picker?.id ?? null, soon, listedStatus,
  }), [toast, dismiss, toggle, setStatus, openPicker, picker, soon, listedStatus]);

  const findAll = useMemo<FindItem[]>(() => [
    ...(tasks ?? []).map((t) => ({ group: "업무" as const, id: `t${t.id}`, label: t.title })),
    ...(goals ?? []).map((g) => ({ group: "목표" as const, id: `g${g.id}`, label: g.title })),
    ...NINE.filter((s) => !s.prefix || s.key === "goals")
      .map((s) => ({ group: "화면" as const, id: `s${s.key}`, label: s.label })),
    { group: "동작", id: "a-new", label: "새 업무 만들기" },
  ], [tasks, goals]);

  const pickTask = picker ? (tasks ?? []).find((t) => t.id === picker.id) ?? null : null;

  return (
    <LiveCtx.Provider value={ctx}>
      <div className="v3-live" ref={box} onClickCapture={onClickBox}>
        {children}
      {picker && pickTask && (
        <StatusPicker anchor={picker.anchor} current={pickTask.status}
                      onPick={(s) => { setPicker(null); setStatus(pickTask.id, s); }}
                      onClose={() => setPicker(null)} />
      )}
      {find && (
        <FindBox all={findAll} onClose={() => setFind(false)}
                 onOpen={(it) => { setFind(false); soon(it.create ? it.label : `「${it.label}」 열기`); }} />
      )}
      <div className="v3-toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div className="v3-toast" key={t.id} data-toast-ms={toastMs(!!t.action)}>
            <span className="v3-toast-t">{t.strong && <b>{t.strong}</b>}{t.text}</span>
            {t.action && (
              <button type="button" className="v3-toast-b"
                      onClick={() => { dismiss(t.id); t.action!.run(); }}>
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      </div>
    </LiveCtx.Provider>
  );
}

/* ══ §B-1 체크박스 ═════════════════════════════════════════════════ */

const cbOf = (s: string): CbState =>
  s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

/** 맥락 안이면 눌리는 체크, 밖이면 예전 그대로 **모양만**. */
export function LiveCheck({ task }: { task: LiveTask }) {
  const live = useLive();
  return <Checkbox state={cbOf(task.status)} onToggle={live ? () => live.toggle(task.id) : undefined} />;
}

/* ══ §B-2 상태 칩 ══════════════════════════════════════════════════ */

export function StatusChip({ task }: { task: LiveTask }) {
  const live = useLive();
  if (!live) return <span className="v3-due">{pickLabel(task.status)}</span>;
  return (
    <button type="button" className={`v3-stchip s-${task.status}`} data-live-chip=""
            aria-haspopup="listbox" aria-expanded={live.pickerFor === task.id}
            onClick={(e) => live.openPicker(task.id, e.currentTarget)}>
      <i className="v3-stdot" aria-hidden="true" />
      {pickLabel(task.status)}
      {/* 마우스를 올렸을 때만 선다(§B-17) — CSS 가 정한다 */}
      <span className="v3-stchip-cv" aria-hidden="true">⌄</span>
    </button>
  );
}

function StatusPicker({
  anchor, current, onPick, onClose,
}: { anchor: HTMLElement; current: string; onPick: (s: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  /*
   * 칩 **아래**에 뜬다. 아래가 모자라면 위에(§B-14). 자리는 그려 본 뒤의 높이로
   * 정한다 — 줄 수로 짐작하면 글자 크기가 바뀔 때 틀린다.
   */
  const place = useCallback(() => {
    const a = anchor.getBoundingClientRect();
    const h = box.current?.offsetHeight ?? 0;
    const below = window.innerHeight - a.bottom;
    const up = below < h + 8 && a.top > h + 8;
    setPos({ left: a.left, top: up ? a.top - h - 4 : a.bottom + 4 });
  }, [anchor]);
  useLayoutEffect(() => { place(); }, [place]);
  /*
   * 바깥을 누르면 닫힌다. Esc 는 `Live` 가 듣는다(§B-16). **스크롤로는 안 닫는다** —
   * 칩을 따라간다. 스크롤로 닫으면 칩을 누르는 순간의 자동 스크롤에 바로 닫힌다.
   */
  useEffect(() => {
    const away = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!box.current?.contains(n) && !anchor.contains(n)) onClose();
    };
    document.addEventListener("mousedown", away);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchor, onClose, place]);
  return (
    <div className="v3-stpick" role="listbox" ref={box}
         style={pos ? { left: pos.left, top: pos.top } : { visibility: "hidden" }}>
      {STATUS_PICK.map((s) => (
        <button type="button" role="option" key={s.key} aria-selected={s.key === current}
                className={`v3-stpick-i s-${s.key}`} onClick={() => onPick(s.key)}>
          <i className="v3-stdot" aria-hidden="true" />
          <span>{s.label}</span>
          <span className="v3-stpick-k" aria-hidden="true">{s.key === current ? "✓" : ""}</span>
        </button>
      ))}
    </div>
  );
}

/* ══ §B-3 빠른 동작 — 평소엔 없다 ══════════════════════════════════ */

/** 그림은 `Clip` 과 같은 결 — 선 하나, 글자색을 따른다. 색을 새로 들이지 않는다. */
const QUICK = [
  { k: "due", label: "기한 바꾸기",
    d: "M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" },
  { k: "who", label: "담당 바꾸기",
    d: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" },
  { k: "more", label: "더 보기", d: "M5 12h.01M12 12h.01M19 12h.01" },
] as const;

/**
 * 세 자리. **열을 하나 더 둔다**(84px) — 기한 위에 겹쳐 덮지 않는다(§B-19).
 * 이번 회차에는 무엇을 여는지까지는 안 만든다. 누르면 「다음 회차」라고 알린다 —
 * 아무 일도 안 일어나는 자리를 만들지 않는다(§B-20).
 */
export function QuickActions({ task }: { task: LiveTask }) {
  const live = useLive();
  if (!live) return null;
  return (
    <span className="v3-quick">
      {QUICK.map((q) => (
        <button type="button" key={q.k} className="v3-quick-b" title={q.label} aria-label={`${q.label} · ${task.title}`}
                onClick={() => live.soon(q.label)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={q.k === "more" ? 3 : 2}
               strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={q.d} /></svg>
        </button>
      ))}
    </span>
  );
}

/* ══ §C-28 단축키 칩 ═══════════════════════════════════════════════ */

/** 적혀 있지 않은 단축키는 없는 것과 같다. 맥락 밖에서는 안 그린다 — 안 듣는 키를 적지 않는다. */
export function ShortcutBar() {
  const live = useLive();
  if (!live) return null;
  return (
    <p className="v3-keys" aria-label="단축키">
      {SHORTCUTS.map((s) => (
        <span className="v3-key" key={s.label}>
          {s.keys.map((k) => <kbd key={k}>{k}</kbd>)}
          {s.label}
        </span>
      ))}
    </p>
  );
}

/* ══ §F-47 숫자 세어 올리기 ════════════════════════════════════════ */

const COUNT_MS = 400;
/** 0 에서 세어 올린다. 움직임이 꺼져 있으면 **최종값이 바로** 선다(§F-46). */
export function CountUp({ n }: { n: number }) {
  const live = useLive();
  // 처음 그릴 때부터 0 — 최종값이 한 번 번쩍 보이고 0 으로 떨어지지 않게
  const [shown, setShown] = useState(() => (live && n > 0 && motionOn() ? 0 : n));
  /*
   * **다 센 뒤에만** 「이미 셌다」로 친다. 「처음 한 번」으로 막으면 개발 모드의
   * StrictMode 가 효과를 두 번 돌릴 때 첫 번(곧 취소되는 것)이 그 한 번을 써 버려서
   * 한 번도 안 센다 — 070 검사기가 [0→16] 으로 잡았다.
   */
  const counted = useRef(false);
  useEffect(() => {
    if (!live || counted.current || n === 0 || !motionOn()) { counted.current = true; setShown(n); return; }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / COUNT_MS);
      setShown(Math.round(n * (1 - (1 - k) * (1 - k))));
      if (k < 1) raf = requestAnimationFrame(tick);
      else counted.current = true;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n, live]);
  return <>{shown}</>;
}

/* ══ §D ⌘K 찾기 ════════════════════════════════════════════════════ */

function FindBox({
  all, onClose, onOpen,
}: { all: FindItem[]; onClose: () => void; onOpen: (it: FindItem) => void }) {
  const [q, setQ] = useState("");
  const [cur, setCur] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const items = useMemo(() => findItems(all, q), [all, q]);
  useEffect(() => { setCur(0); }, [q]);
  useEffect(() => {
    input.current?.focus();
    // 닫을 때 **포커스를 뗀다**(§D-38). 안 떼면 닫은 뒤 J·K 가 글자로 먹힌다.
    const el = input.current;
    return () => { el?.blur(); };
  }, []);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCur((c) => Math.min(items.length - 1, c + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setCur((c) => Math.max(0, c - 1)); }
    if (e.key === "Enter" && items[cur]) { e.preventDefault(); onOpen(items[cur]); }
  };
  let idx = -1;
  return (
    <div className="v3-find-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="v3-find" role="dialog" aria-label="찾기">
        <input ref={input} className="v3-find-in" value={q} placeholder="업무 · 목표 · 화면 · 동작 찾기"
               onChange={(e) => setQ(e.target.value)} onKeyDown={key} aria-label="찾기" />
        <div className="v3-find-list" role="listbox">
          {items.length === 0 && <p className="v3-find-none">찾을 것이 없습니다</p>}
          {FIND_GROUPS.map((g) => {
            const inG = items.filter((i) => i.group === g);
            if (inG.length === 0) return null;
            return (
              <div className="v3-find-g" key={g}>
                <span className="v3-find-gt">{g}</span>
                {inG.map((it) => {
                  idx = items.indexOf(it);
                  const i = idx;
                  return (
                    <button type="button" role="option" key={it.id} aria-selected={i === cur}
                            className={`v3-find-i${it.create ? " create" : ""}`}
                            onMouseEnter={() => setCur(i)} onClick={() => onOpen(it)}>
                      {it.label}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
        <p className="v3-find-foot"><kbd>↑↓</kbd> 이동 · <kbd>↵</kbd> 열기 · <kbd>esc</kbd> 닫기</p>
      </div>
    </div>
  );
}
