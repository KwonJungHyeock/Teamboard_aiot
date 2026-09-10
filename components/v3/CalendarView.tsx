"use client";

// v3 「캘린더」 (MD-P-2026-046 §C).
//
// ── 무엇을 먹는가 ────────────────────────────────────────────────
//
// 기존 엔드포인트 둘뿐이다. **새 API 는 없다.**
//   · `/api/tasks`          — 격자에 세울 업무
//   · `/api/tasks/open-due` — 위쪽 네 숫자. **팀장까지만** 볼 수 있다
//     (`requireLiveLead`). 팀원이 열면 403 이 오고, 그때는 숫자 줄 대신
//     **왜 안 보이는지 한 줄**을 적는다 — 빈 줄은 고장으로 읽힌다.
//
// 격자를 펴는 규칙은 `lib/v3/calendar.ts` 에 있다.
//
// ── 달력이 말하지 않는 것 ───────────────────────────────────────
//
// **기한 없는 업무는 어느 칸에도 안 선다.** 그래서 격자만 보면 「이게 전부」로
// 읽힌다. 위에 건수를 따로 적어서 그 오해를 막는다 — 아무 날에도 안 걸리는
// 것들이 제일 늦게 발견된다(037).
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Button, Empty } from "./parts";
import type { TodayTask } from "@/lib/v3/today";
import { areaOf, type AreaView } from "@/lib/v3/category";
import {
  parseMonth, shiftMonth, monthLabel, monthGrid, inMonth, byDay, cellItems,
  noDueSplit, monthCount, openDay, WEEKDAYS, CELL_MAX,
} from "@/lib/v3/calendar";
import { taskHref } from "@/lib/v3/routes";

interface Tally { before: number; after: number; none: number; excludedDone: number }

export default function CalendarView({
  today, openAtMs, areas,
}: { today: string; openAtMs: number; areas: AreaView[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [err, setErr] = useState("");
  const [tally, setTally] = useState<Tally | null>(null);
  /** 네 숫자를 못 본 이유. 팀원이면 403 이 온다 — 빈 자리로 두지 않는다. */
  const [tallyWhy, setTallyWhy] = useState("");
  /** 세 칸 넘게 있는 날 — 그 날만 펼친다. 달을 넘기면 다시 접힌다. */
  const [openCells, setOpenCells] = useState<Set<string>>(new Set());

  // 보고 있는 달은 **주소에 담긴다** — 그대로 공유된다(지시 §C).
  const ym = parseMonth(sp.get("m"), today);

  const goMonth = useCallback((next: string) => {
    const q = new URLSearchParams(sp.toString());
    // 이번 달은 주소에 안 적는다. 기본값을 적으면 「돌아온 자리」가 두 개가 된다.
    if (next === today.slice(0, 7)) q.delete("m"); else q.set("m", next);
    setOpenCells(new Set());
    router.replace(q.toString() ? `?${q}` : "?", { scroll: false });
  }, [router, sp, today]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("업무를 불러오지 못했습니다."))))
      .then((d) => setTasks(d.tasks ?? []))
      .catch((e) => setErr(String(e.message ?? e)));
    fetch("/api/tasks/open-due")
      .then(async (r) => (r.ok
        ? r.json()
        : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `숫자를 불러오지 못했습니다 (${r.status})`))))
      .then((d) => setTally(d.tally))
      .catch((e) => setTallyWhy(String(e.message ?? e)));
  }, []);

  const weeks = useMemo(() => monthGrid(ym), [ym]);
  const days = useMemo(() => byDay(tasks ?? []), [tasks]);
  const noDue = useMemo(() => noDueSplit(tasks ?? []), [tasks]);
  const thisMonth = useMemo(() => monthCount(tasks ?? [], ym), [tasks, ym]);
  const open = useMemo(() => openDay(openAtMs), [openAtMs]);

  return (
    <>
      <h1 className="v3-h1">캘린더</h1>
      {/*
        기한 없는 것을 **둘로 나눠 적는다.** 아래 네 숫자는 완료를 빼고 세므로
        「3건」과 「2」가 나란히 뜨면 고장으로 읽힌다. 차이를 감추지 않고
        화면에서 맞춰 보인다 — 그러면 아무도 계산기를 안 켠다.
      */}
      <p className="v3-lede">
        기한이 있는 업무만 달력에 섭니다.
        {tasks !== null && noDue.total > 0 && (
          <>
            {" "}기한 없는 <b>{noDue.total}건</b>은 <b>아무 날에도 안 걸립니다</b>
            {noDue.open !== noDue.total && <> (그중 아직 안 끝난 것 <b>{noDue.open}건</b>)</>}
            {" — "}
            <Link className="v3-lk" href="/open-due">가오픈 기한 화면</Link>에서 봅니다.
          </>
        )}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      {/*
        ── 네 숫자 (지시 §C) ────────────────────────────────────────
        `/api/tasks/open-due` 가 세는 그대로다. **여기서 다시 세지 않는다** —
        같은 숫자를 두 곳에서 세면 언젠가 갈라지고, 갈라지면 어느 쪽이 맞는지
        아무도 모른다. 세 번째(기한 없음)만 누를 수 있다: 손댈 것이 있고 그
        목록이 이미 있는 자리다.
      */}
      {tally && (
        <div className="v3-stats v3-odstrip">
          <div className="v3-stat"><span className="v3-stat-n">{tally.before}</span>
            <span className="v3-stat-l">가오픈 이전</span></div>
          <div className="v3-stat"><span className="v3-stat-n">{tally.after}</span>
            <span className="v3-stat-l">가오픈 이후</span></div>
          <Link className="v3-stat warn v3-stat-lk" href="/open-due">
            <span className="v3-stat-n">{tally.none}</span>
            <span className="v3-stat-l">기한 없음 · 목록 보기</span>
          </Link>
          <div className="v3-stat"><span className="v3-stat-n">{tally.excludedDone}</span>
            <span className="v3-stat-l">완료 (세 갈래에서 뺌)</span></div>
        </div>
      )}
      {!tally && tallyWhy && (
        <p className="v3-leak">가오픈 기준 집계를 못 봤습니다 — {tallyWhy}</p>
      )}

      <Card>
        <div className="v3-calbar">
          <Button className="v3-sortbtn" onClick={() => goMonth(shiftMonth(ym, -1))}>◂ 지난달</Button>
          <b className="v3-calm">{monthLabel(ym)}</b>
          <span className="v3-sub">
            {tasks === null ? "불러오는 중…" : `${thisMonth}건`}
          </span>
          <span className="v3-chips-sp" />
          {/* 오늘로 돌아오는 자리. 달을 몇 번 넘기면 돌아오는 길이 없다. */}
          {ym !== today.slice(0, 7) && (
            <Button className="v3-sortbtn" onClick={() => goMonth(today.slice(0, 7))}>이번 달</Button>
          )}
          <Button className="v3-sortbtn" onClick={() => goMonth(shiftMonth(ym, 1))}>다음달 ▸</Button>
        </div>

        <div className="v3-cal" role="grid" aria-label={monthLabel(ym)}>
          {WEEKDAYS.map((w) => (
            <div className="v3-cal-w" key={w} role="columnheader">{w}</div>
          ))}
          {weeks.map((week) => week.map((date) => {
            const rows = days.get(date) ?? [];
            const expanded = openCells.has(date);
            const { shown, more } = cellItems(rows, expanded ? rows.length : CELL_MAX);
            const cls = [
              "v3-cal-d",
              inMonth(date, ym) ? "" : "out",
              date === today ? "today" : "",
              date === open ? "open" : "",
            ].filter(Boolean).join(" ");
            return (
              <div className={cls} key={date} role="gridcell">
                <span className="v3-cal-n">
                  {/* 오늘은 **파란 동그라미**. 숫자 하나에만 붙는다 —
                      칸 전체를 칠하면 그 날의 알약 색이 안 읽힌다. */}
                  <b className="v3-cal-dn" aria-current={date === today ? "date" : undefined}>
                    {Number(date.slice(8))}
                  </b>
                  {/* 가오픈일은 **말로도** 적는다. 색 하나로는 배워야 알 수 있다. */}
                  {date === open && <em className="v3-cal-open">가오픈</em>}
                </span>
                {shown.map((t) => {
                  const a = areaOf(areas, t.areaId);
                  return (
                    <Link
                      key={t.id}
                      className={`v3-pill ${a?.tone ?? "etc"}${t.status === "done" ? " done" : ""}`}
                      href={taskHref(t.id)}
                      title={`${t.title}${a ? ` · ${a.name}` : ""}`}
                    >
                      {t.title}
                    </Link>
                  );
                })}
                {more > 0 && (
                  <button type="button" className="v3-pill more"
                          onClick={() => setOpenCells((p) => new Set(p).add(date))}>
                    ＋{more}
                  </button>
                )}
              </div>
            );
          }))}
        </div>
      </Card>

      {tasks !== null && thisMonth === 0 && (
        <Card>
          <Empty
            title={`${monthLabel(ym)}에 기한인 업무가 없어요`}
            why={noDue.total > 0
              ? `이 달에 걸린 기한이 없습니다. 기한 없는 업무 ${noDue.total}건은 어느 달에도 안 서므로 여기서는 안 보입니다.`
              : "이 달에 걸린 기한이 없습니다. 다른 달로 넘기거나 「업무」에서 전체를 봅니다."}
            action={{ label: "업무 보기", href: "/v3/tasks" }}
          />
        </Card>
      )}

      {/* 색이 무슨 뜻인지 — 알약 색은 **카테고리**다. 기한의 급함이 아니다.
          두 신호를 같은 색으로 쓰면 「무슨 영역인가」와 「급한가」가 섞인다. */}
      <p className="v3-why v3-callegend">
        알약 색은 카테고리입니다. 완료된 업무는 글자에 줄이 그어집니다.
      </p>
    </>
  );
}
