"use client";

// v3 「업무」 (MD-P-2026-044 §B).
//
// ── 무엇을 먹는가 ────────────────────────────────────────────────
//
// `/api/tasks` 하나뿐이다. 새 API 는 없다. 묶고·거르고·세는 규칙은
// `lib/v3/tasks.ts` 에 있다.
//
// ── 행에 네 가지만 ──────────────────────────────────────────────
//
// 체크 · 제목 · 담당 · 기한. **ID · 우선순위 · 진척 막대는 안 넣는다** —
// 목록에서 그 셋을 보고 할 수 있는 판단이 없다. 상세에 있다.
// 하위가 있는 업무만 제목 아래 한 줄이 붙는다.
//
// ── 접지 않는다 ────────────────────────────────────────────────
//
// 「오늘」은 오래 밀린 것을 접는다. 여기는 **전부 보는 자리**라 안 접는다.
// 대신 기한 표시를 오늘 화면과 **같은 기준**으로 눕힌다 —
// 7일 이내 지남은 코랄, 7일 초과는 회색.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Chip, ListRow, Empty, Button, Menu, MenuItem } from "./parts";
import type { CbState } from "./parts";
import { childLine, shortDue, type TodayTask } from "@/lib/v3/today";
import {
  countByArea, areaLeak, groupTasks, allGroups, dueTone,
  dueMonth, dueSelLabel, DUE_FILTERS, GROUPS,
  type SortKey, type DueSel, type ChipView,
} from "@/lib/v3/tasks";
/*
 * 066 §C-2 — **조건은 한 파일에서 온다.** 주소를 읽는 것도, 행을 고르는 것도,
 * 권한을 거르는 것도 여기 하나다. CSV 경로(`/api/tasks/csv`)가 같은 함수를
 * 부른다 — 각자 만들면 화면은 막혀 있는데 파일로는 남의 것이 나간다(§C-19).
 */
import {
  parseListQuery, serializeListQuery, isEmptyListQuery, selectRows, countMine,
  listChips, type ListQuery,
} from "@/lib/v3/list-query";
import { chipRow, type AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";
// 목록에는 **썸네일이 아니라 개수만** (051 §C-3).
import { countLinks } from "@/lib/v3/links";
// 여러 건 한 번에 (057 §B) — 규칙은 lib 에, 화면은 부르기만.
import { BulkBar, BulkResultBar } from "./BulkBar";
import {
  beforeOf, patchFor, undoPatch, needsChange, whyFrom, emptyResult, pruneSelection,
  type BulkChange, type BulkField, type BulkResult, type BulkTask,
} from "@/lib/v3/bulk";

const SORT_LABEL: Record<SortKey, string> = { due: "기한순", recent: "최신순" };

interface Person { id: number; name: string }

/**
 * 상태 탭 넷 — **지시서 §C-15 의 차례 그대로다.**
 *
 * `[전체][진행][검토][완료]`. 「전체」는 상태 축을 비우는 것이고 나머지는 하나씩
 * 고른다. **탭이라 하나만** 골린다 — 여러 개를 고르는 자리였으면 칩이어야 한다.
 *
 * 주소의 모양(`st=doing,review`)은 그대로 둔다. 옛 링크가 여럿을 담고 있으면
 * 걸러지는 것은 그대로고, 탭은 「전체」로 보인다 — 없는 탭을 켜서 거짓말하지 않는다.
 */
const STATUS_TABS = [
  { v: null, label: "전체" },
  { v: "doing", label: "진행" },
  { v: "review", label: "검토" },
  { v: "done", label: "완료" },
] as const;

export default function TasksView({
  today, areas, people, me,
}: { today: string; areas: AreaView[]; people: Person[];
     /** 보는 사람의 `actor.id`. 「내 항목」과 권한 거르기가 이 값을 쓴다 (066 §C). */
     me: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [err, setErr] = useState("");
  // 건수 0인 카테고리는 접혀 있다. **접혔다는 사실은 보인다** — `＋n`.
  const [openHidden, setOpenHidden] = useState(false);
  // 「묶기: 상태」 — 네 상태를 건수와 함께 펼쳐 보이는 안내.
  const [openGroups, setOpenGroups] = useState(false);

  /*
   * 고른 카테고리와 정렬은 **주소에 담긴다** — 그대로 공유된다(지시 §B 정렬).
   * 상태를 컴포넌트에만 두면 링크를 보낸 사람과 받은 사람이 다른 것을 본다.
   */
  const STATUS_VALUES = useMemo(() => GROUPS.map((g) => g.statuses[0] as string), []);
  /**
   * 걸린 조건 한 벌 — **전부 주소에서 읽는다** (051 §B).
   *
   * 상태를 컴포넌트에만 두면 링크를 보낸 사람과 받은 사람이 다른 것을 본다.
   * 축은 다섯이고 **더 늘리지 않는다**: 카테고리 · 담당 · 상태 · 기한 · 검색.
   * 「내 항목」은 새 축이 아니라 **담당 축의 값**이다 (066 §C-16).
   *
   * 읽는 일은 `parseListQuery()` 가 한다 (066 §C-2) — CSV 가 같은 함수를 쓴다.
   */
  const query: ListQuery = useMemo(() => parseListQuery(sp), [sp]);
  const picked = query.cat;
  const sort: SortKey = sp.get("sort") === "recent" ? "recent" : "due";
  /*
   * 완료 묶음은 **기본으로 접힌다** (045 §A).
   *
   * 「목록은 접지 마십시오」는 **밀린 것**에 대한 말이었다. 완료는 다르다 —
   * 로컬만 봐도 27건 중 12건이 완료라 스크롤의 절반이 끝난 일이다.
   * 펼친 상태는 **주소에 담는다.** 접힌 채 공유하면 받은 사람이 다른 것을 본다.
   */
  const showDone = sp.get("done") === "1";

  /*
   * ── 연달아 누르면 앞의 조건이 지워지던 자리 ──────────────────────
   *
   * 주소가 정본이다. 그런데 `useSearchParams` 는 `router.replace` 가 **끝나야**
   * 새 값을 들고, 그 사이에 다음 클릭이 오면 **옛 주소 위에** 쌓아서 앞의 조건을
   * 덮어쓴다. 검사기 ① 이 그렇게 잡았다 — 넷을 걸었는데 주소엔 `?due=late` 만 남았다.
   *
   * 그래서 **마지막으로 쓴 주소를 손에 들고** 거기에 쌓는다. 그 주소가 실제로
   * 반영되면(`sp` 가 같아지면) 손을 놓고 다시 `sp` 를 따른다. 뒤로가기로 주소가
   * 바뀔 때도 손을 놓는다 — 안 놓으면 뒤로 간 자리가 다음 클릭에 되살아난다.
   */
  const spStr = sp.toString();
  const wrote = useRef<string | null>(null);
  useEffect(() => { if (wrote.current !== null && spStr === wrote.current) wrote.current = null; }, [spStr]);
  useEffect(() => {
    const drop = () => { wrote.current = null; };
    window.addEventListener("popstate", drop);
    return () => window.removeEventListener("popstate", drop);
  }, []);

  const setQuery = useCallback((next: {
    cat?: Set<number>; who?: Set<number>; status?: Set<string>; due?: DueSel; q?: string;
    mine?: boolean; sort?: SortKey; done?: boolean;
  }) => {
    const p = new URLSearchParams(wrote.current ?? spStr);
    /** 빈 값은 주소에서 **뺀다.** 기본값을 적으면 「돌아온 자리」가 둘이 된다. */
    const put = (k: string, v: string) => { if (v === "") p.delete(k); else p.set(k, v); };
    const list = (s: Set<number>) => Array.from(s).sort((a, b) => a - b).join(",");
    if (next.cat !== undefined) put("cat", list(next.cat));
    if (next.who !== undefined) put("who", list(next.who));
    if (next.status !== undefined) {
      // 화면 순서(GROUPS)대로 적는다 — 고른 차례대로 적으면 같은 조건이 다른 주소가 된다.
      put("st", STATUS_VALUES.filter((v) => next.status!.has(v)).join(","));
    }
    if (next.due !== undefined) put("due", next.due === "all" ? "" : next.due);
    if (next.q !== undefined) put("q", next.q.trim());
    // 「내 항목」 — 켜면 `mine=1`, 끄면 주소에서 **빠진다**(기본값은 안 적는다).
    if (next.mine !== undefined) { if (next.mine) p.set("mine", "1"); else p.delete("mine"); }
    if (next.sort !== undefined) put("sort", next.sort === "due" ? "" : next.sort);
    if (next.done !== undefined) { if (next.done) p.set("done", "1"); else p.delete("done"); }
    wrote.current = p.toString();
    router.replace(p.toString() ? `?${p}` : "?", { scroll: false });
  }, [router, spStr, STATUS_VALUES]);

  /** 조건 하나만 푼다 (칩의 ×). **그것만** 풀린다 — 나머지는 그대로 남는다. */
  const clearOne = useCallback((c: ChipView) => {
    if (c.axis === "cat") { const n = new Set(query.cat); n.delete(c.value as number); setQuery({ cat: n }); }
    else if (c.axis === "who") { const n = new Set(query.who); n.delete(c.value as number); setQuery({ who: n }); }
    else if (c.axis === "status") { const n = new Set(query.status); n.delete(c.value as string); setQuery({ status: n }); }
    else if (c.axis === "due") setQuery({ due: "all" });
    else if (c.axis === "mine") setQuery({ mine: false });
    else setQuery({ q: "" });
  }, [query, setQuery]);

  /** 다섯을 한 번에 푼다. 정렬·완료 펼침은 **조건이 아니라 보기 방식**이라 안 건드린다. */
  const clearAll = useCallback(() => {
    setQuery({ cat: new Set(), who: new Set(), status: new Set(), due: "all", q: "", mine: false });
  }, [setQuery]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("업무를 불러오지 못했습니다."))))
      .then((d) => setTasks(d.tasks ?? []))
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  /*
   * 검색은 **치는 즉시** 걸린다. 다만 주소는 한 박자 늦게 바꾼다(디바운스) —
   * 글자마다 `router.replace` 를 하면 뒤로가기 기록이 한 글자씩 쌓인다.
   *
   * 그래서 칸의 값은 화면이 들고(`text`), 주소는 300ms 뒤에 따라간다.
   * 주소가 밖에서 바뀌면(× 로 지우기 · 뒤로가기) 칸도 따라간다.
   */
  const [text, setText] = useState(query.q);
  useEffect(() => { setText(query.q); }, [query.q]);
  useEffect(() => {
    if (text === query.q) return;
    const id = setTimeout(() => setQuery({ q: text }), 300);
    return () => clearTimeout(id);
  }, [text, query.q, setQuery]);

  const counts = useMemo(() => countByArea(tasks ?? []), [tasks]);
  const { shown, hidden } = useMemo(() => chipRow(areas, counts), [areas, counts]);
  const leak = useMemo(() => areaLeak(tasks ?? [], areas), [tasks, areas]);
  /*
   * **CSV 와 같은 함수다** (§C-19 · §C-27). 권한 거르기도 이 안에 있다 —
   * `/api/tasks` 가 이미 SQL 에서 걸렀으므로 여기서는 아무것도 안 빠지는 것이
   * 정상이고, 그물이 없는 것이 사고다.
   */
  const filtered = useMemo(
    () => selectRows(tasks ?? [], query, me, today), [tasks, query, me, today]);
  const chips = useMemo(() => listChips(query, areas, people), [query, areas, people]);
  const nothing = isEmptyListQuery(query);
  /*
   * ▾ 단추에 적는 값. **접힌 동안에도 무엇이 걸렸는지 보인다** —
   * 열어 봐야 아는 조건은 없는 조건과 같다.
   */
  const catValue = picked.size === 0 ? null
    : areas.filter((a) => picked.has(a.id)).map((a) => a.name).join(" · ");
  const whoValue = query.who.size === 0 ? null
    : people.filter((p) => query.who.has(p.id)).map((p) => p.name).join(" · ");
  /** 머리 보조설명의 둘째 숫자 (§C-18). **거른 목록에서** 센다. */
  const mineCount = useMemo(() => countMine(filtered, me), [filtered, me]);
  /**
   * CSV 주소 — **지금 걸린 조건 그대로**(§C-21).
   *
   * `<Link>` 가 아니라 `<a href>` 다(§C-22): Next 가 미리 불러오면 사람이
   * 누르지 않아도 전 건이 만들어진다.
   */
  const csvHref = useMemo(() => {
    const qs = serializeListQuery(query);
    return `/api/tasks/csv${qs ? `?${qs}` : ""}`;
  }, [query]);
  /*
   * 완료 묶음은 기본으로 접히지만, **상태를 완료로 골랐으면 펼친다.**
   * 안 그러면 「상태 · 완료」가 걸려 있는데 결과가 0건으로 보이고,
   * 그건 거른 것이 아니라 접은 것이다 — 화면이 거짓말을 한다.
   */
  const doneWanted = showDone || query.status.has("done");
  const groups = useMemo(
    () => groupTasks(filtered, sort).filter((g) => g.key !== "done" || doneWanted),
    [filtered, sort, doneWanted]);
  const doneCount = useMemo(
    () => filtered.filter((t) => t.status === "done").length, [filtered]);
  const everyGroup = useMemo(() => allGroups(filtered, sort), [filtered, sort]);

  const toggle = (id: number) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id); else next.add(id);
    setQuery({ cat: next });
  };

  /*
   * ══ 여러 건 한 번에 (057 §B) ═══════════════════════════════════
   *
   * **새 API 는 없다.** 기존 `PATCH /api/tasks/{id}` 를 건마다 한 번씩,
   * **차례로** 부른다. 한꺼번에 몰아치면 어느 것이 왜 실패했는지 섞이고,
   * 열아홉 건이면 서버에 열아홉 개가 동시에 꽂힌다.
   */
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(0);
  const [outTotal, setOutTotal] = useState(0);
  const [result, setResult] = useState<BulkResult | null>(null);

  const rows: BulkTask[] = useMemo(
    () => (tasks ?? []).filter((t) => filtered.some((f) => f.id === t.id))
      .map((t) => ({ id: t.id, title: t.title, status: t.status,
                     assigneeId: t.assigneeId ?? null, dueDate: t.dueDate ?? null })),
    [tasks, filtered]);

  /* 거르개를 바꾸면 화면에서 사라진 행은 **선택에서도 빠진다.** 안 보이는 것을
     바꾸면 무엇이 바뀌었는지 사람이 못 본다. */
  const visibleKey = rows.map((r) => r.id).join(",");
  useEffect(() => {
    setSel((prev) => (prev.size === 0 ? prev : pruneSelection(prev, rows)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const pick = useCallback((id: number) => {
    setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);

  /** 한 건 보내고 결과를 그대로 돌려준다. 실패를 삼키지 않는다 (§G 051). */
  const sendOne = useCallback(async (id: number, patch: Record<string, unknown>) => {
    const r = await fetch(`/api/tasks/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (r.ok) return { ok: true, why: "" };
    let body: unknown = null;
    try { body = await r.json(); } catch { body = null; }
    return { ok: false, why: whyFrom(r.status, body) };
  }, []);

  /** 목록을 다시 읽는다 — 화면이 서버와 갈리면 되돌리기가 엉뚱한 값을 쓴다. */
  const reload = useCallback(async () => {
    const r = await fetch("/api/tasks");
    if (r.ok) setTasks((await r.json()).tasks ?? []);
  }, []);

  const runBulk = useCallback(async (c: BulkChange) => {
    const targets = rows.filter((t) => sel.has(t.id));
    const todo = targets.filter((t) => needsChange(t, c));
    const field: BulkField = c.field;
    const out = emptyResult(field);
    out.skipped = targets.length - todo.length;
    setBusy(true); setSent(0); setOutTotal(todo.length); setResult(null);
    try {
      for (const t of todo) {
        // **직전 값을 먼저 손에 든다.** 보내고 나면 그 값은 어디에도 없다.
        const before = beforeOf(t);
        const r = await sendOne(t.id, patchFor(c));
        if (r.ok) out.done.push(before);
        // 한 건이 거부돼도 **멈추지 않는다.** 전부 되돌리면 나머지를 사람이 다시 한다.
        else out.failed.push({ id: t.id, title: t.title, ok: false, why: r.why });
        setSent((n) => n + 1);
      }
      await reload();
    } finally {
      setBusy(false);
      setResult(out);
    }
  }, [rows, sel, sendOne, reload]);

  /** 되돌리기 — **성공한 건만**, 각자 제 직전 값으로. 「전부 todo 로」가 아니다. */
  const runUndo = useCallback(async () => {
    if (result === null) return;
    const back = result.done;
    const out = emptyResult(result.field);
    setBusy(true); setSent(0); setOutTotal(back.length);
    try {
      for (const b of back) {
        const r = await sendOne(b.id, undoPatch(b, result.field));
        if (r.ok) out.done.push(b);
        else out.failed.push({ id: b.id, title: b.title, ok: false, why: r.why });
        setSent((n) => n + 1);
      }
      await reload();
    } finally {
      setBusy(false);
      // 되돌린 결과도 남긴다 — 되돌리다 실패한 건이 있으면 그것도 보여야 한다.
      setResult({ ...out, field: result.field });
    }
  }, [result, sendOne, reload]);

  const allPicked = rows.length > 0 && rows.every((t) => sel.has(t.id));

  const stateOf = (s: string): CbState =>
    s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <h1 className="v3-h1">업무</h1>
      {/*
        머리 보조설명 — **두 숫자** (§C-18). 「24건 · 내 것 5건」.
        둘 다 같은 목록에서 센다. 「내 것」을 따로 불러와 세면 조건이 걸린 화면에서
        두 숫자가 서로 다른 모집단을 말한다.
      */}
      <p className="v3-lede">
        {tasks === null ? "불러오는 중…"
          : `${total}건 · 내 것 ${mineCount}건${nothing ? "" : ` · 조건 ${chips.length}개로 거름 (전체 ${leak.total}건)`}`}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      {/*
        ── 거르개 줄 — **차례가 고정이다** (§C-15) ────────────────────
            [◉내 항목] | [전체][진행][검토][완료] | [영역▾][담당▾][기한▾]

        「내 항목」이 맨 앞에 **혼자** 떨어져 있다(§C-16) — 하루에 열 번 누르는
        것이고 나머지는 가끔 쓰는 것이다. 자주 하는 것은 한 번에 닿는 칩으로.

        영역·담당·기한은 ▾ 로 접는다(§C-17). 사람이 늘어도 **줄의 모양이 안
        바뀐다.** 담당을 탭으로 깔면 사람이 들어올 때마다 화면이 달라지고,
        전체를 보려면 매번 탭을 옮겨야 한다.
      */}
      <div className="v3-fbar" role="group" aria-label="거르개">
        <Chip on={query.mine} onClick={() => setQuery({ mine: !query.mine })}>
          ◉ 내 항목
        </Chip>

        <span className="v3-fbar-div" aria-hidden="true" />

        <div className="v3-tabs" role="group" aria-label="상태">
          {STATUS_TABS.map((t) => {
            /* 「전체」는 축이 비었을 때. 옛 링크가 둘 이상을 담고 있으면 어느
               탭도 안 켜진다 — 없는 탭을 켜서 거짓말하지 않는다. */
            const on = t.v === null
              ? query.status.size === 0
              : query.status.size === 1 && query.status.has(t.v);
            return (
              <button key={t.label} type="button" className={`v3-tab${on ? " on" : ""}`}
                      aria-pressed={on}
                      onClick={() => setQuery({ status: t.v === null ? new Set() : new Set([t.v]) })}>
                {t.label}
              </button>
            );
          })}
        </div>

        <span className="v3-fbar-div" aria-hidden="true" />

        {/* 영역 — 건수를 **메뉴 안에서** 그대로 보인다. 칩 줄에서 옮겨 오며
            숫자를 버리지 않는다. 0건인 영역도 그대로 나온다 —
            「없는 것」과 「0건인 것」은 다른 말이다. */}
        <Menu label="영역" value={catValue}>
          <MenuItem on={picked.size === 0} count={tasks === null ? undefined : leak.total}
                    onClick={() => setQuery({ cat: new Set() })}>전체</MenuItem>
          {[...shown, ...hidden].map(({ area, count }) => (
            <MenuItem key={area.id} on={picked.has(area.id)} count={count}
                      onClick={() => toggle(area.id)}>
              {area.name}
            </MenuItem>
          ))}
        </Menu>

        <Menu label="담당" value={whoValue}>
          {people.map((p) => (
            <MenuItem key={p.id} on={query.who.has(p.id)}
                      onClick={() => {
                        const n = new Set(query.who);
                        if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                        setQuery({ who: n });
                      }}>
              {p.name}
            </MenuItem>
          ))}
        </Menu>

        {/* 기한은 **하나만** 고른다 — 「지남」이면서 「기한 없음」인 업무는 없다. */}
        <Menu label="기한" value={query.due === "all" ? null : dueSelLabel(query.due)}>
          {DUE_FILTERS.map((d) => (
            <MenuItem key={d.key} on={query.due === d.key}
                      onClick={() => setQuery({ due: d.key })}>
              {d.label}
            </MenuItem>
          ))}
          {/* 달로 온 경우(집계 화면의 칸) — 그 달을 **항목으로** 보인다.
              안 보이면 넷이 다 비어서 아무 조건도 안 걸린 것처럼 읽힌다. */}
          {dueMonth(query.due) !== null && (
            <MenuItem on onClick={() => setQuery({ due: "all" })}>
              {dueSelLabel(query.due)}
            </MenuItem>
          )}
        </Menu>

        <span className="v3-fbar-gap" />

        <input
          className="v3-search"
          type="search"
          value={text}
          placeholder="제목에서 찾기"
          aria-label="제목에서 찾기"
          onChange={(e) => setText(e.target.value)}
        />

        {/*
          ⤓ CSV (§C-21) — **지금 화면에 보이는 것과 같은 조건.**
          `<Link>` 가 아니라 평범한 `<a href>` 다(§C-22): 미리 불러오는 링크로
          만들면 누르지 않아도 전 건이 만들어진다.
        */}
        <a className="v3-btn v3-csv" href={csvHref} download>⤓ CSV</a>
      </div>

      {/* 보기 방식 — **조건이 아니다.** 그래서 거르개 줄과 갈라 둔다.
          거르개 줄의 차례가 고정이라는 것은 거기에 다른 것을 끼우지 않는다는
          뜻이다(§C-15). */}
      <div className="v3-vbar" role="group" aria-label="보기">
        <Button className="v3-sortbtn" aria-expanded={openGroups}
                onClick={() => setOpenGroups((v) => !v)}>
          묶기 · 상태
        </Button>
        <Button className="v3-sortbtn"
                onClick={() => setQuery({ sort: sort === "due" ? "recent" : "due" })}>
          정렬 · {SORT_LABEL[sort]}
        </Button>
        {/* 「전체 선택」 — **지금 보이는 것**만 고른다. 거르개 뒤에 숨은 것까지
            고르면 사람이 못 본 것을 바꾸게 된다. */}
        {tasks !== null && rows.length > 0 && (
          <label className="v3-selall">
            <input type="checkbox" checked={allPicked}
                   onChange={() => setSel(allPicked ? new Set() : new Set(rows.map((t) => t.id)))} />
            전체 선택
          </label>
        )}
      </div>

      {/*
        걸린 조건을 **그대로 나열한다.** 각 칩에 × 가 있어 그것만 풀 수 있다.
        조건이 어디 숨어 있으면 빈 목록이 고장으로 읽힌다.
      */}
      {!nothing && (
        <div className="v3-active" role="status">
          <span className="v3-fx-l">걸린 조건</span>
          {chips.map((c) => (
            <button key={`${c.axis}:${String(c.value)}`} type="button" className="v3-acx"
                    onClick={() => clearOne(c)} aria-label={`${c.label} 조건 지우기`}>
              {c.label}<span aria-hidden="true">×</span>
            </button>
          ))}
          <Button className="v3-sortbtn" onClick={clearAll}>조건 지우기</Button>
        </div>
      )}

      {openGroups && tasks !== null && (
        <p className="v3-groups" role="note">
          {everyGroup.map((g) => (
            <span key={g.key} className={g.rows.length === 0 ? "zero" : ""}>
              {g.label} <b>{g.rows.length}</b>
            </span>
          ))}
          <em>0건인 묶음은 목록에 안 그립니다.</em>
        </p>
      )}

      {/* 칩 숫자의 합이 전체와 맞는가. **맞지 않으면 어딘가 새고 있다.**
          0건이라고 믿지 않고 세어서, 샐 때만 말한다. */}
      {tasks !== null && (leak.noArea > 0 || leak.unknownArea > 0) && (
        <p className="v3-leak">
          카테고리가 없는 업무 {leak.noArea}건
          {leak.unknownArea > 0 && ` · 모르는 카테고리 ${leak.unknownArea}건`}
          {" — 칩 숫자의 합에 안 들어갑니다."}
        </p>
      )}

      {tasks === null ? <Card><p className="v3-loading">불러오는 중…</p></Card>
        : groups.length === 0 ? (
          <Card>
            {/*
              **0건이면 걸린 조건을 그대로 나열한다** (지시 §B).
              빈 목록이 이유 없이 비어 있으면 고장으로 읽힌다. 조건은 위에도
              칩으로 서 있지만, 여기서 한 번 더 적는다 — 결과가 없다는 말과
              그 이유가 같은 자리에 있어야 한다.
            */}
            <Empty
              title={nothing ? "업무가 없어요" : "조건에 맞는 업무가 없어요"}
              why={nothing
                ? "아직 등록된 업무가 없습니다. 「새 업무」에서 만들 수 있습니다."
                : `걸린 조건 — ${chips.map((c) => c.label).join(" · ")}. 전체 ${leak.total}건 중 0건입니다.`}
              action={nothing ? { label: "새 업무 만들기", href: "/v3/new" } : undefined}
            />
            {!nothing && (
              <div className="v3-newfoot">
                <Button primary onClick={clearAll}>조건 지우기</Button>
                <span className="v3-newwhy">조건을 하나씩 풀려면 위 칩의 × 를 누르세요</span>
              </div>
            )}
          </Card>
        ) : (<>
          {groups.map((g) => (
          <Card key={g.key} title={g.label} sub={`${g.rows.length}건`}>
            {/*
              **행에 네 가지만** — 체크 · 제목 · 담당 · 기한 (지시 §C-2).
              카테고리 태그도 안 붙인다. 다섯 번째가 되는 순간 64px 행이
              빽빽해지고, 카테고리는 이미 위 칩 줄이 답하고 있다.
            */}
            {g.rows.map((t) => {
              const tone = dueTone(t.dueDate, today);
              return (
                <ListRow
                  key={t.id}
                  href={taskHref(t.id)}
                  title={t.title}
                  sub={childLine(t, tasks)}
                  state={stateOf(t.status)}
                  assignee={t.assigneeName}
                  due={shortDue(t.dueDate)}
                  late={tone === "late"}
                  dueTone={tone}
                  clip={countLinks(t.description)}
                  selected={sel.has(t.id)}
                  onSelect={() => pick(t.id)}
                />
              );
            })}
          </Card>
          ))}

          {/* 완료 — **기본으로 접힌 한 줄.** 건수는 접혀 있어도 보인다.
              조용히 빼면 「완료가 없다」로 읽히고, 그건 사실이 아니다. */}
          {doneCount > 0 && !showDone && (
            <button type="button" className="v3-donebar" aria-expanded="false"
                    onClick={() => setQuery({ done: true })}>
              <span className="v3-stale-cv" aria-hidden="true">▸</span>
              완료 {doneCount}건
            </button>
          )}
          {doneCount > 0 && showDone && (
            <button type="button" className="v3-donebar" aria-expanded="true"
                    onClick={() => setQuery({ done: false })}>
              <span className="v3-stale-cv" aria-hidden="true">▾</span>
              완료 {doneCount}건 접기
            </button>
          )}
        </>)}

      {/*
        ── 작업 줄과 결과 줄 (057 §B) ───────────────────────────────
        작업 줄은 **하나라도 골랐을 때만** 선다. 결과 줄은 닫기를 눌러야 없어진다 —
        시간이 지나 사라지면 되돌릴 길도 같이 사라진다.
      */}
      {result !== null && (
        <BulkResultBar r={result} busy={busy} onUndo={runUndo} onClose={() => setResult(null)} />
      )}
      <BulkBar n={sel.size} people={people} busy={busy} sent={sent} total={outTotal}
               onChange={runBulk} onClear={() => setSel(new Set())} />
    </>
  );
}
