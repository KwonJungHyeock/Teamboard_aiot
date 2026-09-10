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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Chip, ListRow, Empty, Button } from "./parts";
import type { CbState } from "./parts";
import { childLine, shortDue, type TodayTask } from "@/lib/v3/today";
import {
  countByArea, areaLeak, filterByArea, groupTasks, dueTone,
  type SortKey,
} from "@/lib/v3/tasks";
import { chipRow, type AreaView } from "@/lib/v3/category";
import { taskHref } from "@/lib/v3/routes";

const SORT_LABEL: Record<SortKey, string> = { due: "기한순", recent: "최신순" };

export default function TasksView({ today, areas }: { today: string; areas: AreaView[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [err, setErr] = useState("");
  // 건수 0인 카테고리는 접혀 있다. **접혔다는 사실은 보인다** — `＋n`.
  const [openHidden, setOpenHidden] = useState(false);

  /*
   * 고른 카테고리와 정렬은 **주소에 담긴다** — 그대로 공유된다(지시 §B 정렬).
   * 상태를 컴포넌트에만 두면 링크를 보낸 사람과 받은 사람이 다른 것을 본다.
   */
  const picked = useMemo(() => {
    const raw = sp.get("cat") ?? "";
    return new Set(raw.split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0));
  }, [sp]);
  const sort: SortKey = sp.get("sort") === "recent" ? "recent" : "due";

  const setQuery = useCallback((next: { cat?: Set<number>; sort?: SortKey }) => {
    const q = new URLSearchParams(sp.toString());
    if (next.cat !== undefined) {
      if (next.cat.size === 0) q.delete("cat");
      else q.set("cat", Array.from(next.cat).sort((a, b) => a - b).join(","));
    }
    if (next.sort !== undefined) {
      if (next.sort === "due") q.delete("sort");   // 기본값은 주소에 안 적는다
      else q.set("sort", next.sort);
    }
    router.replace(q.toString() ? `?${q}` : "?", { scroll: false });
  }, [router, sp]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("업무를 불러오지 못했습니다."))))
      .then((d) => setTasks(d.tasks ?? []))
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const counts = useMemo(() => countByArea(tasks ?? []), [tasks]);
  const { shown, hidden } = useMemo(() => chipRow(areas, counts), [areas, counts]);
  const leak = useMemo(() => areaLeak(tasks ?? [], areas), [tasks, areas]);
  const groups = useMemo(
    () => groupTasks(filterByArea(tasks ?? [], picked), sort),
    [tasks, picked, sort]);

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
        {tasks === null ? "불러오는 중…" : `${total}건${picked.size ? ` · 카테고리 ${picked.size}개로 거름` : ""}`}
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
        <Button className="v3-sortbtn"
                onClick={() => setQuery({ sort: sort === "due" ? "recent" : "due" })}>
          정렬 · {SORT_LABEL[sort]}
        </Button>
      </div>

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
            <Empty
              title={picked.size ? "고른 카테고리에 업무가 없어요" : "업무가 없어요"}
              why={picked.size
                ? "다른 카테고리를 고르거나 「전체」로 돌아가면 나머지가 보입니다."
                : "아직 등록된 업무가 없습니다. 「새 업무」에서 만들 수 있습니다."}
              action={picked.size ? undefined : { label: "새 업무 만들기", href: "/v3/new" }}
            />
          </Card>
        ) : groups.map((g) => (
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
                />
              );
            })}
          </Card>
        ))}
    </>
  );
}
