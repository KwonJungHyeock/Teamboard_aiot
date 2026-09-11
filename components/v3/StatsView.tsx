"use client";

// v3 「집계」 (MD-P-2026-052 §B).
//
// ── 무엇을 먹는가 ────────────────────────────────────────────────
//
// 기존 엔드포인트 둘뿐이다. 새 API 는 없다.
//   · `/api/tasks`          — 표 두 장
//   · `/api/tasks/open-due` — 기한 세 갈래. **가져다 쓴다, 다시 안 센다**
//
// ── 표까지만이다 ────────────────────────────────────────────────
//
// 보고서 형태로 뽑는 것은 다음에 정한다(지시 §B). 숫자가 맞는지 확인도 안 된
// 채로 양식부터 굳으면, 나중에 숫자가 틀렸을 때 양식까지 같이 고쳐야 한다.
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, Button, Empty } from "./parts";
import { type TodayTask } from "@/lib/v3/today";
import {
  STAT_COLUMNS, crossTab, outside, reconcile, inMonth, monthLabel, shiftMonth,
  cellHref, rangesFor, ringOf, distribution, distTally, type StatTable,
} from "@/lib/v3/stats";
import { ChartToggle } from "./StatsCharts";
// 「마지막 갱신」 시각은 **서버가 준 것**을 쓴다 (§G 048) — 047 과 같은 방식.
import { stampFrom, clockKst } from "@/lib/v3/detail";
import { type AreaView } from "@/lib/v3/category";

interface Person { id: number; name: string }
interface Tally { before: number; after: number; none: number; excludedDone: number }

const YM = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 한 장을 그린다. 두 표가 **같은 모양**이라야 읽는 사람이 두 번 배우지 않는다. */
function Table({
  title, table, axis, ym, empty,
}: {
  title: string; table: StatTable; axis: "cat" | "who"; ym: string; empty: string;
}) {
  return (
    <Card title={title} sub={`${table.total}건`}>
      {table.total === 0 && table.rows.every((r) => r.total === 0) ? (
        <p className="v3-why">{empty}</p>
      ) : (
        <div className="v3-tw">
          <table className="v3-tbl">
            <thead>
              <tr>
                <th scope="col">{axis === "cat" ? "카테고리" : "담당자"}</th>
                {STAT_COLUMNS.map((c) => <th key={c.key} scope="col" className="n">{c.label}</th>)}
                <th scope="col" className="n sum">합계</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={String(r.id ?? "none")} className={r.total === 0 ? "zero" : ""}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((n, i) => (
                    <td key={STAT_COLUMNS[i].key} className="n">
                      {/* 0은 **안 누르게** 둔다. 눌러서 빈 목록이 나오면 고장으로 읽힌다. */}
                      {n === 0 ? <span className="z">0</span> : (
                        <Link href={cellHref(axis, r.id, STAT_COLUMNS[i].status, ym)}>{n}</Link>
                      )}
                    </td>
                  ))}
                  <td className="n sum">
                    {r.total === 0 ? <span className="z">0</span> : (
                      <Link href={cellHref(axis, r.id, null, ym)}>{r.total}</Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">합계</th>
                {table.colTotals.map((n, i) => (
                  <td key={STAT_COLUMNS[i].key} className="n">
                    {n === 0 ? <span className="z">0</span> : (
                      <Link href={cellHref(axis, null, STAT_COLUMNS[i].status, ym)}>{n}</Link>
                    )}
                  </td>
                ))}
                <td className="n sum">{table.total}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function StatsView({
  today, areas, people,
}: { today: string; areas: AreaView[]; people: Person[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [err, setErr] = useState("");
  const [tally, setTally] = useState<Tally | null>(null);
  const [openAt, setOpenAt] = useState<string>("");
  const [tallyWhy, setTallyWhy] = useState("");
  /**
   * 언제 가져온 숫자인가 (§B-3).
   *
   * **브라우저 시계로 안 찍는다** — 증거로 내놓는 값은 그 값을 만든 쪽에서
   * 가져온다(§G 048). 응답의 `Date` 머리글이라 API 를 안 고치고 받을 수 있다.
   * **자동 새로고침은 없다.** 스스로 도는 화면은 언제 돈 건지 더 헷갈린다.
   */
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);

  // 보고 있는 달은 **주소에 담긴다**. 기본은 이번 달 — 기본값은 주소에 안 적는다.
  const raw = sp.get("m");
  const ym = raw !== null && YM.test(raw) ? raw : today.slice(0, 7);

  const goMonth = useCallback((next: string) => {
    const p = new URLSearchParams(sp.toString());
    if (next === today.slice(0, 7)) p.delete("m"); else p.set("m", next);
    router.replace(p.toString() ? `?${p}` : "?", { scroll: false });
  }, [router, sp, today]);

  useEffect(() => {
    fetch("/api/tasks")
      .then((r) => {
        if (!r.ok) throw new Error("업무를 불러오지 못했습니다.");
        setFetchedAt(stampFrom(r.headers.get("date")));
        return r.json();
      })
      .then((d) => setTasks(d.tasks ?? []))
      .catch((e) => setErr(String(e.message ?? e)));
    fetch("/api/tasks/open-due")
      .then(async (r) => (r.ok
        ? r.json()
        : Promise.reject(new Error((await r.json().catch(() => ({}))).error ?? `숫자를 못 불러왔습니다 (${r.status})`))))
      .then((d) => { setTally(d.tally); setOpenAt(String(d.openAt ?? "").slice(0, 10)); })
      .catch((e) => setTallyWhy(String(e.message ?? e)));
  }, []);

  const all = tasks ?? [];
  const period = useMemo(() => all.filter((t) => inMonth(t, ym)), [all, ym]);
  const noDue = useMemo(() => all.filter((t) => t.dueDate === null).length, [all]);
  const out = useMemo(() => outside(period), [period]);

  const byArea = useMemo(
    () => crossTab(period, areas.map((a) => ({ id: a.id, label: a.name })),
                   (t) => t.areaId, "카테고리 없음"),
    [period, areas]);
  const byWho = useMemo(
    () => crossTab(period, people.map((p) => ({ id: p.id, label: p.name })),
                   (t) => t.assigneeId, "담당 없음"),
    [period, people]);

  // 고리 셋 — **같은 함수를 세 번**. 기간만 다르다.
  const rings = useMemo(
    () => rangesFor(ym).map((r) => ringOf(all, r, today)), [all, ym, today]);
  const monthRange = useMemo(() => rangesFor(ym)[2], [ym]);
  const dist = useMemo(() => distribution(all, monthRange), [all, monthRange]);
  const barOk = distTally(dist.segments, period.length, out.n);

  const recArea = reconcile(byArea, period.length, out.n);
  const recWho = reconcile(byWho, period.length, out.n);
  const bothOk = recArea.ok && recWho.ok;

  return (
    <>
      <h1 className="v3-h1">집계</h1>
      <p className="v3-lede">
        {tasks === null ? "불러오는 중…"
          : `기한이 ${monthLabel(ym)}인 업무 ${period.length}건`}
        {tasks !== null && noDue > 0 && (
          <>
            {" — "}기한 없는 <b>{noDue}건</b>은 <b>어느 달에도 안 들어갑니다</b>{" "}
            (<Link className="v3-lk" href="/open-due">가오픈 기한 화면</Link>).
          </>
        )}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      <div className="v3-calbar">
        <Button className="v3-sortbtn" onClick={() => goMonth(shiftMonth(ym, -1))}>◂ 지난달</Button>
        <b className="v3-calm">{monthLabel(ym)}</b>
        {ym !== today.slice(0, 7) && (
          <Button className="v3-sortbtn" onClick={() => goMonth(today.slice(0, 7))}>이번 달</Button>
        )}
        <Button className="v3-sortbtn" onClick={() => goMonth(shiftMonth(ym, 1))}>다음달 ▸</Button>
      </div>

      {/*
        ── 합이 맞는지 화면에서 보인다 (지시 §B) ────────────────────
        행 합 · 열 합 · 전체를 **나란히** 적는다. 하나만 적으면 「맞다」밖에 못
        말하고, 어긋났을 때 어느 쪽이 새는지가 안 보인다.
      */}
      {tasks !== null && (
        <p className={`v3-recon${bothOk ? "" : " bad"}`}>
          {/* 별표를 쓰지 않는다 — 여기는 마크다운이 아니라 글자 그대로 찍힌다. */}
          {bothOk ? "합이 맞습니다 — " : "합이 안 맞습니다 — "}
          기한이 {monthLabel(ym)}인 {period.length}건
          {out.n > 0 && <> · 네 상태 밖 {out.n}건 뺌({out.statuses.join(", ")})</>}
          {" = "}
          카테고리표 행 합 <b>{recArea.rowSum}</b> · 열 합 <b>{recArea.colSum}</b>
          {" / "}
          담당자표 행 합 <b>{recWho.rowSum}</b> · 열 합 <b>{recWho.colSum}</b>
          {!bothOk && " — 세다가 빠뜨린 것이 있습니다."}
        </p>
      )}

      {/*
        ── 원그래프 (056 §B) ────────────────────────────────────────
        연간 · 분기 · 이번 달. **셋이 같은 함수에서** 나온다(`ringOf`) —
        각자 세면 합이 안 맞는다. 달을 옮기면 셋이 다 따라간다.

        기한 없는 업무는 **어느 기간에도 안 든다**(037). 그 건수는 위 안내줄에
        이미 적혀 있다 — 안 세는 것이 보여야 한다(지시 §B-1).
      */}
      {tasks !== null && (
        <Card title="완료율" sub={`${monthLabel(ym)} 기준 · 기간 셋`}>
          <ChartToggle rings={rings} segments={dist.segments} total={dist.total} />
          {/* 클래스가 `.v3-recon` 이 아니다. 위의 표 합 줄과 **다른 말을 하는 줄**이라
              이름을 나눈다 — 한 이름이 두 문장을 가리키면 가리키는 쪽이 어느 것을
              말하는지 알 수 없다(§G 047). 실제로 052 검사기가 여기서 걸렸다. */}
          <p className={`v3-recon-bar${barOk.ok ? "" : " bad"}`}>
            {barOk.ok ? "막대 합이 맞습니다 — " : "막대 합이 안 맞습니다 — "}
            네 상태 <b>{barOk.sum}</b>건
            {out.n > 0 && <> · 네 상태 밖 {out.n}건 뺌({out.statuses.join(", ")})</>}
            {" / 기한이 "}{monthLabel(ym)}{"인 "}<b>{period.length}</b>건
            {!barOk.ok && " — 세다가 빠뜨린 것이 있습니다."}
          </p>
          <p className="v3-why">
            {/* 색을 값에 따라 안 바꾸는 이유를 적는다 — 안 적으면 「왜 다 파랑이지」가 된다. */}
            고리 색은 셋 다 같습니다. 「몇 %부터 좋음」의 기준이 아직 없어서
            색으로 말하지 않습니다.
            {fetchedAt !== null && <> · 마지막 갱신 {clockKst(fetchedAt)}</>}
          </p>
        </Card>
      )}

      {tasks !== null && period.length === 0 ? (
        <Card>
          <Empty
            title={`${monthLabel(ym)}에 기한인 업무가 없어요`}
            why={noDue > 0
              ? `이 달에 걸린 기한이 없습니다. 기한 없는 ${noDue}건은 어느 달에도 안 들어가므로 여기서는 안 보입니다.`
              : "이 달에 걸린 기한이 없습니다. 다른 달로 넘기거나 「업무」에서 전체를 봅니다."}
            action={{ label: "업무 보기", href: "/v3/tasks" }}
          />
        </Card>
      ) : (<>
        <Table title="카테고리 × 상태" table={byArea} axis="cat" ym={ym}
               empty="이 달에 걸린 기한이 없습니다." />
        <Table title="담당자 × 상태" table={byWho} axis="who" ym={ym}
               empty="이 달에 걸린 기한이 없습니다." />
      </>)}

      {/*
        ── 기한 세 갈래 — **가져다 쓴다** ───────────────────────────
        `/api/tasks/open-due` 가 세는 그대로다. 여기서 다시 세면 같은 숫자를 두
        곳에서 세게 되고, 갈라지면 어느 쪽이 맞는지 아무도 모른다.
        이 집계는 **달과 무관하다** — 활성 업무 전부를 가오픈 기준으로 센다.
      */}
      <Card title="가오픈 기준 기한" sub={openAt ? `가오픈 ${openAt} 기준 · 달과 무관` : undefined}>
        {tally ? (<>
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
          <p className="v3-why">
            041 의 가오픈 기한 집계를 그대로 가져온 숫자입니다. 여기서 다시 세지 않습니다 —
            두 곳에서 세면 언젠가 갈라집니다.
          </p>
        </>) : (
          <p className="v3-leak">가오픈 기준 집계를 못 봤습니다 — {tallyWhy || "불러오는 중…"}</p>
        )}
      </Card>

      <p className="v3-why v3-callegend">
        칸을 누르면 그 조건이 걸린 업무 목록이 열립니다 — 달 조건도 함께 갑니다.
        0은 누를 수 없습니다.
      </p>
    </>
  );
}
