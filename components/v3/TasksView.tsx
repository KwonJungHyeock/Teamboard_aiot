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
import { Card, Chip, InputChip, ListRow, Empty, Button } from "./parts";
import type { CbState } from "./parts";
import { childLine, shortDue, type TodayTask } from "@/lib/v3/today";
import {
  countByArea, areaLeak, groupTasks, allGroups, dueTone,
  applyFilters, activeChips, isEmptyQuery, isDueKey, DUE_FILTERS, GROUPS,
  type SortKey, type Query, type DueKey, type ChipView,
} from "@/lib/v3/tasks";
import { chipRow, type AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";
// 목록에는 **썸네일이 아니라 개수만** (051 §C-3).
import { countLinks } from "@/lib/v3/links";

const SORT_LABEL: Record<SortKey, string> = { due: "기한순", recent: "최신순" };

interface Person { id: number; name: string }

/** 주소의 `1,2,3` 을 번호 집합으로. 이상한 값은 조용히 버린다 — 주소는 손으로 고친다. */
function nums(raw: string | null): Set<number> {
  return new Set((raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
}
function strs(raw: string | null, allowed: readonly string[]): Set<string> {
  return new Set((raw ?? "").split(",").filter((s) => allowed.includes(s)));
}

export default function TasksView({
  today, areas, people,
}: { today: string; areas: AreaView[]; people: Person[] }) {
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
   */
  const query: Query = useMemo(() => ({
    cat: nums(sp.get("cat")),
    who: nums(sp.get("who")),
    status: strs(sp.get("st"), STATUS_VALUES),
    due: isDueKey(sp.get("due")) ? (sp.get("due") as DueKey) : "all",
    q: sp.get("q") ?? "",
  }), [sp, STATUS_VALUES]);
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
    cat?: Set<number>; who?: Set<number>; status?: Set<string>; due?: DueKey; q?: string;
    sort?: SortKey; done?: boolean;
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
    else setQuery({ q: "" });
  }, [query, setQuery]);

  /** 다섯을 한 번에 푼다. 정렬·완료 펼침은 **조건이 아니라 보기 방식**이라 안 건드린다. */
  const clearAll = useCallback(() => {
    setQuery({ cat: new Set(), who: new Set(), status: new Set(), due: "all", q: "" });
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
  const filtered = useMemo(
    () => applyFilters(tasks ?? [], query, today), [tasks, query, today]);
  const chips = useMemo(() => activeChips(query, areas, people), [query, areas, people]);
  const nothing = isEmptyQuery(query);
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

  const stateOf = (s: string): CbState =>
    s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

  const total = groups.reduce((n, g) => n + g.rows.length, 0);

  return (
    <>
      <h1 className="v3-h1">업무</h1>
      <p className="v3-lede">
        {tasks === null ? "불러오는 중…"
          : `${total}건${nothing ? "" : ` · 조건 ${chips.length}개로 거름 (전체 ${leak.total}건)`}`}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      {/* 카테고리 칩 줄 — **사이드바가 아니라 줄**이다.
          「어디로 갈까」가 아니라 「무엇을 볼까」이기 때문이다. */}
      <div className="v3-chips" role="group" aria-label="카테고리">
        <Chip on={picked.size === 0} onClick={() => setQuery({ cat: new Set() })}
              count={tasks === null ? undefined : leak.total}>
          전체
        </Chip>
        {shown.map(({ area, count }) => (
          <Chip key={area.id} on={picked.has(area.id)} count={count}
                onClick={() => toggle(area.id)}>
            {area.name}
          </Chip>
        ))}
        {/* 건수 0인 카테고리 — 접되 **몇 개가 접혔는지는 보인다.**
            조용히 없애면 일곱 개가 다 있는지 세어 볼 수가 없다. */}
        {hidden.length > 0 && !openHidden && (
          <Chip dashed onClick={() => setOpenHidden(true)}>＋{hidden.length}</Chip>
        )}
        {openHidden && hidden.map(({ area, count }) => (
          <Chip key={area.id} on={picked.has(area.id)} count={count}
                onClick={() => toggle(area.id)}>
            {area.name}
          </Chip>
        ))}

        <span className="v3-chips-sp" />
        {/* 「묶기: 상태」 — 네 상태를 **전부** 건수와 함께 보인다(0건 포함).
            빈 묶음을 목록에 안 그리므로, 「없어서 안 보이는 것」과 「원래 없는 것」을
            여기서 갈라 준다. */}
        <Button className="v3-sortbtn" aria-expanded={openGroups}
                onClick={() => setOpenGroups((v) => !v)}>
          묶기 · 상태
        </Button>
        <Button className="v3-sortbtn"
                onClick={() => setQuery({ sort: sort === "due" ? "recent" : "due" })}>
          정렬 · {SORT_LABEL[sort]}
        </Button>
      </div>

      {/*
        ── 거르개 축 셋 + 검색 (051 §B) ─────────────────────────────
        카테고리는 위 칩 줄이 이미 한다. 여기는 담당 · 상태 · 기한 · 검색.
        **축을 더 만들지 않는다** — 우선순위·프로젝트·생성일 필터는 없다.
      */}
      <div className="v3-filters" role="group" aria-label="거르개">
        <input
          className="v3-search"
          type="search"
          value={text}
          placeholder="제목에서 찾기"
          aria-label="제목에서 찾기"
          onChange={(e) => setText(e.target.value)}
        />

        <div className="v3-fx">
          <span className="v3-fx-l">담당</span>
          {people.map((p) => (
            <InputChip key={p.id} filled={query.who.has(p.id)}
                       aria-pressed={query.who.has(p.id)}
                       onClick={() => {
                         const n = new Set(query.who);
                         if (n.has(p.id)) n.delete(p.id); else n.add(p.id);
                         setQuery({ who: n });
                       }}>
              {p.name}
            </InputChip>
          ))}
        </div>

        <div className="v3-fx">
          <span className="v3-fx-l">상태</span>
          {GROUPS.map((g) => (
            <InputChip key={g.key} filled={query.status.has(g.statuses[0])}
                       aria-pressed={query.status.has(g.statuses[0])}
                       onClick={() => {
                         const n = new Set(query.status);
                         const v = g.statuses[0] as string;
                         if (n.has(v)) n.delete(v); else n.add(v);
                         setQuery({ status: n });
                       }}>
              {g.label}
            </InputChip>
          ))}
        </div>

        <div className="v3-fx">
          <span className="v3-fx-l">기한</span>
          {/* 기한은 **하나만** 고른다 — 「지남」이면서 「기한 없음」인 업무는 없다.
              「전체」도 골라진 것으로 그린다. 넷이 똑같이 비어 보이면 지금 무엇이
              걸려 있는지 알 수가 없다 — 다만 조건은 아니라서 위 칩 줄에는 안 선다. */}
          {DUE_FILTERS.map((d) => (
            <InputChip key={d.key} filled={query.due === d.key}
                       aria-pressed={query.due === d.key}
                       onClick={() => setQuery({ due: d.key })}>
              {d.label}
            </InputChip>
          ))}
        </div>
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
    </>
  );
}
