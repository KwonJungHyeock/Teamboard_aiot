"use client";

// v3 「팀 현황」 — 담당자 열 (MD-P-2026-052 §A).
//
// ── 무엇을 먹는가 ────────────────────────────────────────────────
//
// `/api/tasks` 하나뿐이다. 새 API 는 없다. 열로 가르는 규칙은
// `lib/v3/team.ts` 에 있고, 거르개는 051 의 것을 그대로 쓴다.
//
// ── 열이 곧 담당이다 ────────────────────────────────────────────
//
// 그래서 **담당 거르개는 여기 안 그린다.** 열이 이미 담당인데 담당을 또 거르면
// 「고른 사람만 열이 남는」 것처럼 읽히는데, 그건 이 화면이 하는 일이 아니다.
// 칩을 눌러도 **사람은 그대로 서 있고 건수만 준다.**
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Chip, InputChip, Empty, Button, Checkbox } from "./parts";
import type { CbState } from "./parts";
import { shortDue, type TodayTask } from "@/lib/v3/today";
import {
  countByArea, applyFilters, activeChips, isEmptyQuery, isDueKey, dueTone,
  DUE_FILTERS, GROUPS, EMPTY_QUERY,
  type Query, type DueKey, type ChipView,
} from "@/lib/v3/tasks";
import {
  buildColumns, columnLayout, columnTally, headLine, foldRows, isOpen, COL_MAX,
  type Person,
} from "@/lib/v3/team";
import { chipRow, type AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";
import { countLinks } from "@/lib/v3/links";
import { roleLabel, showsAdminGrantBadge } from "@/lib/types";

function nums(raw: string | null): Set<number> {
  return new Set((raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
}
function strs(raw: string | null, allowed: readonly string[]): Set<string> {
  return new Set((raw ?? "").split(",").filter((s) => allowed.includes(s)));
}

const stateOf = (s: string): CbState =>
  s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

export default function TeamView({
  today, areas, people,
}: { today: string; areas: AreaView[]; people: Person[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [err, setErr] = useState("");
  /** 다섯을 넘겨 펼친 열. 열마다 따로 — 한 사람 펼쳤다고 다 펴지면 화면이 무너진다. */
  const [openCols, setOpenCols] = useState<Set<string>>(new Set());

  /*
   * 거르개는 051 의 것을 **담당만 빼고** 그대로 쓴다.
   * 상태는 셋뿐이다 — 완료는 이 화면에 애초에 안 서므로, 고를 수 있게 두면
   * 「골랐는데 아무것도 없다」가 되고 그건 거른 것이 아니라 없는 것이다.
   */
  const STATUS_VALUES = useMemo(
    () => GROUPS.filter((g) => g.key !== "done").map((g) => g.statuses[0] as string), []);

  const query: Query = useMemo(() => ({
    ...EMPTY_QUERY,
    cat: nums(sp.get("cat")),
    status: strs(sp.get("st"), STATUS_VALUES),
    due: isDueKey(sp.get("due")) ? (sp.get("due") as DueKey) : "all",
    q: sp.get("q") ?? "",
  }), [sp, STATUS_VALUES]);

  // 051 에서 고친 자리와 같다 — 연달아 누르면 앞의 조건이 덮어써진다.
  const spStr = sp.toString();
  const wrote = useRef<string | null>(null);
  useEffect(() => { if (wrote.current !== null && spStr === wrote.current) wrote.current = null; }, [spStr]);
  useEffect(() => {
    const drop = () => { wrote.current = null; };
    window.addEventListener("popstate", drop);
    return () => window.removeEventListener("popstate", drop);
  }, []);

  const setQuery = useCallback((next: {
    cat?: Set<number>; status?: Set<string>; due?: DueKey; q?: string;
  }) => {
    const p = new URLSearchParams(wrote.current ?? spStr);
    const put = (k: string, v: string) => { if (v === "") p.delete(k); else p.set(k, v); };
    if (next.cat !== undefined) {
      put("cat", Array.from(next.cat).sort((a, b) => a - b).join(","));
    }
    if (next.status !== undefined) {
      put("st", STATUS_VALUES.filter((v) => next.status!.has(v)).join(","));
    }
    if (next.due !== undefined) put("due", next.due === "all" ? "" : next.due);
    if (next.q !== undefined) put("q", next.q.trim());
    wrote.current = p.toString();
    router.replace(p.toString() ? `?${p}` : "?", { scroll: false });
  }, [router, spStr, STATUS_VALUES]);

  const clearOne = useCallback((c: ChipView) => {
    if (c.axis === "cat") { const n = new Set(query.cat); n.delete(c.value as number); setQuery({ cat: n }); }
    else if (c.axis === "status") { const n = new Set(query.status); n.delete(c.value as string); setQuery({ status: n }); }
    else if (c.axis === "due") setQuery({ due: "all" });
    else setQuery({ q: "" });
  }, [query, setQuery]);

  const clearAll = useCallback(() => {
    setQuery({ cat: new Set(), status: new Set(), due: "all", q: "" });
  }, [setQuery]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("업무를 불러오지 못했습니다."))))
      .then((d) => setTasks(d.tasks ?? []))
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const [text, setText] = useState(query.q);
  useEffect(() => { setText(query.q); }, [query.q]);
  useEffect(() => {
    if (text === query.q) return;
    const id = setTimeout(() => setQuery({ q: text }), 300);
    return () => clearTimeout(id);
  }, [text, query.q, setQuery]);

  const all = tasks ?? [];
  // 칩 건수는 **거르기 전 진행 중 전체**로 센다 — 칩 숫자가 누를 때마다 움직이면
  // 그 숫자로는 아무것도 못 센다 (044 에서 세운 판단 그대로).
  const openAll = useMemo(() => all.filter((t) => isOpen(t.status)), [all]);
  const counts = useMemo(() => countByArea(openAll), [openAll]);
  const { shown: chipsShown, hidden } = useMemo(() => chipRow(areas, counts), [areas, counts]);
  const [openHidden, setOpenHidden] = useState(false);

  const filtered = useMemo(() => applyFilters(all, query, today), [all, query, today]);
  const cols = useMemo(() => buildColumns(filtered, people, today), [filtered, people, today]);
  const tally = useMemo(() => columnTally(cols, filtered), [cols, filtered]);
  const chips = useMemo(() => activeChips(query, areas, []), [query, areas]);
  const nothing = isEmptyQuery(query);
  const layout = columnLayout(cols.length);

  return (
    <>
      <h1 className="v3-h1">팀 현황</h1>
      <p className="v3-lede">
        {tasks === null ? "불러오는 중…"
          : `${cols.length}열 · 진행 중 ${tally.sum}건${nothing ? "" : ` · 조건 ${chips.length}개로 거름`}`}
        {" — 완료는 안 보입니다."}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      {/* 카테고리 칩 — **거르개다.** 눌러도 사람은 그대로 서 있고 건수만 준다. */}
      <div className="v3-chips" role="group" aria-label="카테고리">
        <Chip on={query.cat.size === 0} onClick={() => setQuery({ cat: new Set() })}
              count={tasks === null ? undefined : openAll.length}>
          전체
        </Chip>
        {chipsShown.map(({ area, count }) => (
          <Chip key={area.id} on={query.cat.has(area.id)} count={count}
                onClick={() => {
                  const n = new Set(query.cat);
                  if (n.has(area.id)) n.delete(area.id); else n.add(area.id);
                  setQuery({ cat: n });
                }}>
            {area.name}
          </Chip>
        ))}
        {hidden.length > 0 && !openHidden && (
          <Chip dashed onClick={() => setOpenHidden(true)}>＋{hidden.length}</Chip>
        )}
        {openHidden && hidden.map(({ area, count }) => (
          <Chip key={area.id} on={query.cat.has(area.id)} count={count}
                onClick={() => {
                  const n = new Set(query.cat);
                  if (n.has(area.id)) n.delete(area.id); else n.add(area.id);
                  setQuery({ cat: n });
                }}>
            {area.name}
          </Chip>
        ))}
      </div>

      {/* 거르개 — 051 의 축에서 **담당만 뺐다.** 열이 이미 담당이다. */}
      <div className="v3-filters" role="group" aria-label="거르개">
        <input className="v3-search" type="search" value={text} placeholder="제목에서 찾기"
               aria-label="제목에서 찾기" onChange={(e) => setText(e.target.value)} />
        <div className="v3-fx">
          <span className="v3-fx-l">상태</span>
          {GROUPS.filter((g) => g.key !== "done").map((g) => (
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
          {/* 완료가 없는 이유를 적는다 — 없는 선택지는 왜 없는지가 안 보인다. */}
          <span className="v3-newwhy">완료는 이 화면에 안 섭니다</span>
        </div>
        <div className="v3-fx">
          <span className="v3-fx-l">기한</span>
          {DUE_FILTERS.map((d) => (
            <InputChip key={d.key} filled={query.due === d.key}
                       aria-pressed={query.due === d.key}
                       onClick={() => setQuery({ due: d.key })}>
              {d.label}
            </InputChip>
          ))}
        </div>
      </div>

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

      {/* 열 건수의 합이 진행 중 전체와 맞는가. **안 맞으면 어딘가 새고 있다.**
          맞다고 믿지 않고 세어서, 어긋날 때만 말한다. */}
      {tasks !== null && !tally.ok && (
        <p className="v3-leak">
          열 건수의 합 {tally.sum}건이 진행 중 {tally.open}건과 안 맞습니다 —
          어느 열에도 안 들어간 업무가 있습니다.
        </p>
      )}

      {tasks === null ? <Card><p className="v3-loading">불러오는 중…</p></Card>
        : cols.length === 0 ? (
          <Card>
            <Empty
              title="세울 열이 없어요"
              why="활성 담당자가 없고, 담당 없는 진행 중 업무도 없습니다."
              action={{ label: "업무 보기", href: "/v3/tasks" }}
            />
          </Card>
        ) : (
          <div className={`v3-team${layout.scroll ? " scroll" : ""}`}
               style={{ gridTemplateColumns: layout.scroll
                 ? `repeat(${layout.cols}, minmax(${layout.min}px, 1fr))`
                 : `repeat(${layout.cols}, minmax(0, 1fr))` }}>
            {cols.map((c) => {
              const key = String(c.id ?? "none");
              const { shown, more } = foldRows(c.rows, openCols.has(key) ? c.rows.length : COL_MAX);
              return (
                <section className="v3-col" key={key}>
                  <header className="v3-col-h">
                    <span className={`v3-acct-av v3-col-av${c.id === null ? " none" : ""}`}>
                      {c.id === null ? "—" : c.name.slice(0, 1)}
                    </span>
                    <span className="v3-col-nm">
                      <b>{c.name}</b>
                      {/* 배지는 039 그대로 — 새로 만들지 않는다. */}
                      {c.role !== null && (
                        <span className="v3-col-bg">
                          <em>{roleLabel(c.role)}</em>
                          {showsAdminGrantBadge({ role: c.role, adminGrant: c.adminGrant })
                            && <em className="grant">관리자 권한</em>}
                        </span>
                      )}
                    </span>
                    <span className="v3-col-n">{c.total}</span>
                  </header>
                  <p className={`v3-col-sub${c.late > 0 ? " late" : ""}`}>{headLine(c)}</p>
                  {/* 「담당 없음」에 **비활성 계정 담당**이 섞여 있으면 그 사실을 적는다.
                      담당이 없는 것과 담당이 떠난 것은 다르다 — 안 적으면 사라진다. */}
                  {c.inactive > 0 && (
                    <p className="v3-col-sub warn">비활성 계정 담당 {c.inactive}건 포함</p>
                  )}

                  {c.rows.length === 0 ? (
                    <p className="v3-col-empty">진행 중인 업무가 없습니다.</p>
                  ) : (<>
                    {shown.map((t) => {
                      const tone = dueTone(t.dueDate, today);
                      const clip = countLinks(t.description);
                      return (
                        <div className={`v3-cardrow${tone === "late" ? " late" : ""}`} key={t.id}>
                          <Checkbox state={stateOf(t.status)} />
                          <span className="v3-cardrow-m">
                            <Link className="v3-row-t" href={taskHref(t.id)}>{t.title}</Link>
                            <span className="v3-cardrow-b">
                              <span className={`v3-due t-${tone}`}>
                                {shortDue(t.dueDate) ?? "기한 없음"}
                              </span>
                              {clip > 0 && <span className="v3-clip">📎 {clip}</span>}
                            </span>
                          </span>
                        </div>
                      );
                    })}
                    {more > 0 && (
                      <button type="button" className="v3-col-more"
                              onClick={() => setOpenCols((p) => new Set(p).add(key))}>
                        ＋{more}건 더 보기
                      </button>
                    )}
                  </>)}
                </section>
              );
            })}
          </div>
        )}
    </>
  );
}
