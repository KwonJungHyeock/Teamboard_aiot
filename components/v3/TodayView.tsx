"use client";

// v3 「오늘」 (MD-P-2026-043 §C-1).
//
// ── 무엇을 먹는가 ────────────────────────────────────────────────
//
// **기존 엔드포인트 둘뿐이다.** 새로 만든 API 는 없다.
//   · `/api/tasks`         — 업무 전량(내가 볼 수 있는 것). 숫자 셋과 목록 둘이 여기서 나온다
//   · `/api/notifications` — 받은함
//
// 세는 규칙은 `lib/v3/today.ts` 에 있다. 화면 안에 두면 검사기가 같은 함수를
// 못 불러서 「화면이 자기가 그린 것을 그렸다」밖에 확인 못 한다.
//
// ── 빈 목록은 이유와 다음 행동을 적는다 (SYSTEMFLOW 8-4) ────────
//
// 「없습니다」만 적으면 고장인지 비어 있는 건지 모른다. 셋 다 다른 말을 한다.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, StatTile, ListRow, Empty, Tag, Avatar } from "./parts";
import type { CbState } from "./parts";
import {
  countToday, splitToday, childLine, shortDue, inboxItems, weekEnd, shortDate,
  staleLine, STALE_DAYS,
  type TodayTask, type InboxItem,
} from "@/lib/v3/today";
import { areaOf, type AreaView } from "@/lib/v3/category";
/*
 * 066 §D — 대시보드의 숫자는 **새로 계산하지 않는다.**
 *   · 세 숫자와 「내 업무」는 목록 화면과 **같은 함수**를 지난다(§C-2 · §D-35)
 *   · 목표 진척은 서버가 `lib/progress.ts` 로 센 값을 그대로 그린다(§D-32)
 */
import {
  selectRows, serializeListQuery, EMPTY_LIST_QUERY, type ListQuery,
} from "@/lib/v3/list-query";
import { V3_BASE, taskHref } from "@/lib/v3/routes";
import { notYetHref } from "@/lib/v3/not-yet";
// 가오픈 카드가 쓰는 것 — **계산은 저기 한 곳에 있다** (051 §A-3).
import { weeksAndDays, longDateKst } from "@/lib/countdown";
// 오늘 화면에도 **썸네일이 아니라 개수만** (051 §C-3).
import { countLinks } from "@/lib/v3/links";
// 070 — 줄에서 바로 끝내기 · 토스트 · 키보드 · 찾기. **공용 부품이다**(§G-49).
import { Live, useLive, LiveCheck, StatusChip, QuickActions, ShortcutBar, CountUp } from "./Live";

/** 알림이 가리키는 곳. 종류마다 갈 데가 다르다. */
function inboxHref(i: InboxItem): string {
  if (i.refType === "task" && i.refId) return taskHref(i.refId);
  /*
   * 067 §A-2 — **v3 안에서 옛 화면이 열리는 자리 0개.**
   * 시그널·인계·활동은 가오픈 뒤다(§0-2). 알림을 눌러 옛 화면으로 나가면
   * 새 화면을 쓰다가 갑자기 옛 화면이 열린다 — 막음 화면으로 보낸다.
   */
  if (i.refType === "signal") return notYetHref("signals");
  if (i.refType === "handover") return notYetHref("handover");
  return notYetHref("activity");
}
/** 마친 시각 `HH:mm` (KST). 날짜가 오늘인 것만 이 목록에 오므로 시각만 적는다. */
function doneTime(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms));
}

const INBOX_LABEL: Record<string, string> = {
  approval: "승인", mention: "멘션", reply: "답글", handover: "인계",
};

type Goal = { id: number; title: string; progress: number | null };
type Props = {
  name: string;
  /** 보는 사람의 `actor.id`. 「내 업무」와 권한 거르기가 쓴다 (066 §D-31). */
  me: number;
  /** KST 오늘(YYYY-MM-DD). **서버가 정해서 넘긴다** — 브라우저 시계를 안 믿는다. */
  today: string;
  openAtMs: number;
  /** 가오픈까지 남은 날. 대문 카운트다운과 **같은 곳에서 센 값**이다. */
  dday: number;
  areas: AreaView[];
};

/**
 * 데이터를 들고 **`<Live>` 한 줄로 켠다**(070 §G-50). 업무 목록도 다음 회차에
 * 같은 한 줄이면 붙는다. 줄의 상태를 바꾸는 것은 `Live` 가 `setTasks` 로 한다 —
 * 화면이 따로 들고 있는 사본이 없어서, 바꾼 값이 숫자·목록·「오늘 마친 것」에
 * 한꺼번에 선다.
 */
export default function TodayView(props: Props) {
  const { today } = props;
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
  /** 분기 목표 — `/api/goals` 가 주는 나무를 펴서 쓴다. **새 API 는 없다.** */
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then((r) => (r.ok ? r.json() : Promise.reject(new Error("업무를 불러오지 못했습니다.")))),
      fetch("/api/notifications").then((r) => (r.ok ? r.json() : { items: [] })),
    ])
      .then(([t, n]) => { setTasks(t.tasks ?? []); setInbox(inboxItems(n.items ?? [])); })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  /*
   * 분기 목표 (§D-32). **진척을 여기서 다시 계산하지 않는다** — 서버가
   * `lib/progress.ts` 로 센 `progress` 를 그대로 그린다. 못 받으면 빈 목록이고,
   * 그때는 카드에 이유가 선다(0%로 그리지 않는다 — 없는 값과 0은 다르다).
   */
  useEffect(() => {
    void (async () => {
      const r = await fetch("/api/goals").catch(() => null);
      if (!r || !r.ok) { setGoals([]); return; }
      const d = await r.json().catch(() => ({}));
      interface Node { id: number; title: string; progress: number | null;
        periodType: string; periodStart: string; periodEnd: string; children?: Node[] }
      const flat: Node[] = [];
      const walk = (ns: Node[] | undefined) => {
        for (const g of ns ?? []) { flat.push(g); walk(g.children); }
      };
      walk(d.tree as Node[] | undefined);
      setGoals(flat
        .filter((g) => g.periodType === "quarter" && g.periodStart <= today && g.periodEnd >= today)
        .map((g) => ({ id: g.id, title: g.title, progress: g.progress })));
    })();
  }, [today]);

  return (
    <Live tasks={tasks} setTasks={setTasks} goals={goals}>
      <TodayBody {...props} tasks={tasks} inbox={inbox} goals={goals} err={err} />
    </Live>
  );
}

function TodayBody({
  name, today, openAtMs, dday, areas, me, tasks, inbox, goals, err,
}: Props & { tasks: TodayTask[] | null; inbox: InboxItem[] | null; goals: Goal[] | null; err: string }) {
  // 오래 밀린 일은 **접혀서** 시작한다. 펼치는 것은 사람이 정한다.
  const [openStale, setOpenStale] = useState(false);
  /*
   * ── 070 §B-12 — 체크한 줄이 **목록에서 빠지지 않는다** ─────────────
   * 목록에 넣을지는 **처음 건드렸을 때의 상태**로 정하고(`listedStatus`),
   * 줄에 그리는 것은 지금 상태다. 숫자(타일)는 지금 상태로 센다 — 끝낸 일이
   * 여전히 「기한 지남」으로 세어지면 숫자가 거짓말을 한다.
   */
  const live = useLive();
  const listed = useMemo(() => (tasks && live
    ? tasks.map((t) => ({ ...t, status: live.listedStatus(t) })) : tasks), [tasks, live]);
  const byId = useMemo(() => new Map((tasks ?? []).map((t) => [t.id, t])), [tasks]);
  const now = (t: TodayTask) => byId.get(t.id) ?? t;

  /*
   * ── 세 숫자와 「내 업무」 (§D-30 · §D-31 · §D-35) ─────────────────
   *
   * **목록 화면과 같은 함수로 센다.** 대시보드가 따로 세면 언젠가 갈린다 —
   * 그래서 조건을 `ListQuery` 로 적고 `selectRows()` 에 넣는다. 칸을 누르면
   * **그 조건 그대로의 목록**으로 가므로, 숫자와 목록이 구조적으로 같다.
   *
   * 완료를 뺀 세 상태를 조건에 적는다. 안 적으면 「기한 지남」에 **완료된 지난
   * 업무**가 섞여서, 손댈 일이 아닌 것이 손댈 일로 세어진다.
   */
  const OPEN_ST = useMemo(() => new Set(["todo", "doing", "review"]), []);
  const countOf = (due: "late" | "soon"): { n: number; href: string } => {
    const q: ListQuery = { ...EMPTY_LIST_QUERY, status: OPEN_ST, due };
    const n = selectRows(tasks ?? [], q, me, today).length;
    return { n, href: `${V3_BASE}/tasks?${serializeListQuery(q)}` };
  };
  const late = countOf("late");
  const week = countOf("soon");
  /** 내가 담당인, 아직 안 끝난 것 — **다섯 줄만.** 나머지는 「내 업무」에서 본다 */
  const mineQ: ListQuery = useMemo(
    () => ({ ...EMPTY_LIST_QUERY, status: OPEN_ST, mine: true }), [OPEN_ST]);
  const mineRows = useMemo(
    () => selectRows(listed ?? [], mineQ, me, today).map(now), [listed, mineQ, me, today, byId]);
  /** §B-4 — 「내 업무」는 업무 목록에 `?mine=1` 을 붙인 자리다. 새 화면이 아니다. */
  const mineHref = `${V3_BASE}/tasks?${serializeListQuery(mineQ)}`;

  const view = useMemo(() => {
    if (!tasks || !listed) return null;
    const real = splitToday(tasks, today);
    const kept = splitToday(listed, today);
    return {
      counts: countToday(tasks, today),
      // 줄 목록은 처음 상태로 모으고 지금 상태로 그린다 · 「오늘 마친 것」은 지금 상태 그대로
      // `late`(기한으로 정해진다)는 처음 줄의 것을 그대로 쓴다 — 상태를 바꿔도 기한은 그대로다
      todo: kept.todo.map((t) => ({ ...t, ...now(t), late: t.late })),
      stale: kept.stale.map((t) => ({ ...t, ...now(t) })), done: real.done,
      /** 타일의 숫자는 **지금 상태**로 센다 */
      todoNow: real.todo,
    };
  }, [tasks, listed, today, byId]);

  const stateOf = (s: string): CbState =>
    s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

  // 「7주 3일 남음」 — **`dday` 하나에서 파생**시킨다. 따로 세지 않는다.
  const left = weeksAndDays(dday);

  const greeting = `${name}님, 안녕하세요`;
  const dateLine = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long",
  }).format(new Date(`${today}T03:00:00Z`));

  return (
    <>
      <h1 className="v3-h1">{greeting}</h1>
      <p className="v3-lede">
        {dateLine}
        {" · "}
        {/* 가오픈은 **같은 숫자**여야 한다 — 대문 카운트다운과 한 곳에서 센다 */}
        <b className="v3-dday">
          {dday > 0 ? `가오픈 D-${dday}` : dday === 0 ? "가오픈 당일" : `가오픈 +${-dday}일`}
        </b>
      </p>
      {/* 070 §C-28 — 적혀 있지 않은 단축키는 없는 것과 같다 */}
      <ShortcutBar />

      {err && <Card><p className="v3-err">{err}</p></Card>}

      <div className="v3-stats">
        {/*
          ── 가오픈 카드 (051 §A-3) ──────────────────────────────────
          통계 타일과 **같은 줄, 맨 왼쪽**. 파란 채움.

          **진행 막대는 없다.** 지시자의 목업에 있었지만 `config` 에 시작일이
          없다 — 시작이 없으면 「얼마나 왔는가」는 근거 없는 비율이다.
          없는 근거로 그린 막대는 있는 것보다 나쁘다.

          D 와 날짜와 「n주 n일」은 **전부 `lib/countdown.ts` 에서** 온다.
          여기서 다시 세면 같은 카드 안에서 D-52 와 「7주 4일」이 같이 뜬다.
        */}
        <div className="v3-open">
          <span className="v3-open-l">플랫폼 가오픈</span>
          <span className="v3-open-d">
            {dday > 0 ? `D-${dday}` : dday === 0 ? "당일" : `+${-dday}일`}
          </span>
          <span className="v3-open-when">{longDateKst(openAtMs)}</span>
          {left && <span className="v3-open-left">{left.text}</span>}
        </div>
        {/*
          ── 위 칸 셋 (066 §D-30) ────────────────────────────────────
          오늘 할 일 · 기한 지남 · 이번 주 마감.
          **기한 지남만 색을 준다.** 나머지는 무채색이다.

          숫자를 여기서 새로 세지 않는다 — 뒤의 둘은 목록 화면과 **같은 함수**를
          지나고(`selectRows`), 누르면 그 조건 그대로의 목록으로 간다(§D-35).

          「오늘 할 일」은 목록의 기한 축에 딱 맞는 값이 없다(축에 「오늘」이
          없다 — 축을 늘리는 것은 새 규칙이라 손대지 않았다). 그래서 이 숫자는
          **바로 아래 「오늘 할 일」 카드와 같은 함수**(`splitToday`)에서 온다.
        */}
        {/* 070 §E-43 — 「오늘 할 일」은 목록의 축에 맞는 조건이 없어 **누르는 것을 안 만든다** */}
        <StatTile n={view?.todoNow.length ?? 0} label="오늘 할 일"
                  shown={view ? <CountUp n={view.todoNow.length} /> : 0}
                  sub={view ? `진행 ${view.todoNow.filter((t) => t.status === "doing").length}` +
                              ` · 검토 ${view.todoNow.filter((t) => t.status === "review").length}` : undefined} />
        <StatTile n={late.n} label="기한 지남" late href={late.href} go
                  shown={view ? <CountUp n={late.n} /> : 0}
                  sub={view ? `${STALE_DAYS}일 넘게 밀린 것 ${view.stale.length}` : undefined} />
        <StatTile n={week.n} label={`이번 주 마감 (~${shortDate(weekEnd(today))})`} href={week.href} go
                  shown={view ? <CountUp n={week.n} /> : 0}
                  sub={view ? `기한 없음 ${view.counts.noDue}` : undefined} />
      </div>

      {/*
        ── 아래 두 칸 (066 §D-31 · §D-32) ────────────────────────────
        왼쪽 「내 업무」 다섯 줄 · 오른쪽 「분기 목표」 진척.

        「내 업무」는 **업무 목록에 `?mine=1` 을 붙인 자리**다(§B-4) — 새 화면이
        아니다. 그래서 더 보기는 그 주소로 간다.
      */}
      <div className="v3-two">
        <Card title="내 업무" sub={view ? `${mineRows.length}건 중 ${Math.min(5, mineRows.length)}줄` : undefined}>
          {!view ? <p className="v3-loading">불러오는 중…</p>
            : mineRows.length === 0 ? (
              <Empty title="내가 담당인 일이 없어요"
                     why="아직 안 끝난 업무 중 담당이 나인 것이 없습니다."
                     action={{ label: "업무 보기", href: `${V3_BASE}/tasks` }} />
            ) : (<>
              {mineRows.slice(0, 5).map((t) => {
                const a = areaOf(areas, t.areaId);
                return (
                  <div className={`v3-row${t.status === "done" ? " done" : ""}`} key={t.id}
                       data-live-row={t.id}>
                    {/* 070 §B-1 — 체크하면 그 자리에서 완료 · 해제하면 미착수 */}
                    <LiveCheck task={t} />
                    <span className="v3-row-main">
                      <Link className="v3-row-t" href={taskHref(t.id)}>{t.title}</Link>
                    </span>
                    <span className="v3-row-r">
                      {/* 영역 이름표 · 상태 — 지시서가 적은 셋이다(제목 · 이름표 · 상태) */}
                      {a && <Tag area={a} />}
                      {/* 070 §B-2 — 상태가 **눌리는 칩**이 됐다. 낱말은 칩과 고르개가 한 표에서 */}
                      <StatusChip task={t} />
                    </span>
                    <QuickActions task={t} />
                  </div>
                );
              })}
              {mineRows.length > 5 && (
                <p className="v3-why"><Link href={mineHref}>내 업무 {mineRows.length}건 전부 보기</Link></p>
              )}
            </>)}
        </Card>

        <Card title="분기 목표" sub={goals ? `${goals.length}개` : undefined}>
          {goals === null ? <p className="v3-loading">불러오는 중…</p>
            : goals.length === 0 ? (
              <Empty title="이번 분기 목표가 없어요"
                     why="기간이 오늘을 포함하는 분기 목표가 없습니다. 목표는 「목표」 화면에서 만듭니다."
                     action={{ label: "목표 화면으로", href: `${V3_BASE}/goals` }} />
            ) : goals.map((g) => (
              <div className="v3-goalrow" key={g.id}>
                <span className="v3-goalrow-h">
                  <span className="v3-goalrow-t">{g.title}</span>
                  {/* 못 센 진척은 **「—」다. 0% 가 아니다** — 없는 값과 0은 다른 말이다 */}
                  <span className="v3-goalrow-n">{g.progress === null ? "—" : `${g.progress}%`}</span>
                </span>
                <span className="v3-bar" role="img"
                      aria-label={`${g.title} 진척 ${g.progress === null ? "산출 불가" : `${g.progress}%`}`}>
                  <span style={{ width: `${g.progress ?? 0}%` }} />
                </span>
              </div>
            ))}
        </Card>
      </div>

      <Card title="오늘 할 일" sub={view ? `${view.todo.length}건 · 오늘 마감이거나 ${STALE_DAYS}일 이내로 지난 것` : undefined}>
        {!view ? <p className="v3-loading">불러오는 중…</p>
          : view.todo.length === 0 ? (
            <Empty
              title="오늘 할 일이 없어요"
              why={view.counts.noDue > 0
                ? `기한이 오늘이거나 지난 업무가 없습니다. 다만 기한 없는 업무 ${view.counts.noDue}건은 아무 날에도 안 걸려 여기 안 뜹니다.`
                : "기한이 오늘이거나 지난 업무가 없습니다. 진행 중인 업무는 「업무」에서 봅니다."}
              action={view.counts.noDue > 0
                ? { label: "기한 없는 업무 보기", href: notYetHref("open-due") }
                : { label: "업무 보기", href: `${V3_BASE}/tasks` }}
            />
          ) : view.todo.map((t) => (
            <ListRow
              key={t.id}
              href={taskHref(t.id)}
              title={t.title}
              sub={childLine(t, tasks ?? [])}
              state={stateOf(t.status)}
              assignee={t.assigneeName}
              due={shortDue(t.dueDate)}
              late={t.late}
              clip={countLinks(t.description)}
              check={<LiveCheck task={t} />}
              chip={<StatusChip task={t} />}
              tail={<QuickActions task={t} />}
              rowAttrs={{ "data-live-row": String(t.id) }}
            />
          ))}

        {/*
          ── 오래 밀린 일 ──────────────────────────────────────────
          두 달 밀린 업무는 **오늘 할 일이 아니라 기한을 다시 정할 일**이다
          (044 §A). 위 목록과 섞으면 코랄이 거의 모든 행에 붙고, 강조가 전부에
          걸리면 강조가 아니라 배경이 된다.

          접되 **접혔다는 사실과 건수는 보인다.** 조용히 빼면 합이 안 맞는데
          아무도 모른다. 행동 버튼은 「완료」가 아니라 「기한 다시 정하기」다 —
          여기 있는 것들에 필요한 것은 체크가 아니라 새 날짜다.
        */}
        {view && view.stale.length > 0 && (
          <div className="v3-stale">
            <button type="button" className="v3-stale-h" aria-expanded={openStale}
                    onClick={() => setOpenStale((v) => !v)}>
              <span className="v3-stale-cv" aria-hidden="true">{openStale ? "▾" : "▸"}</span>
              {staleLine(view.stale)}
            </button>
            {openStale && view.stale.map((t) => (
              <div className="v3-row v3-stale-r" key={t.id}>
                <span className="v3-row-main">
                  <Link className="v3-row-t" href={taskHref(t.id)}>{t.title}</Link>
                  {/* 하위가 있을 때만 한 줄. 기한은 오른쪽에 이미 있다 —
                      한 행에서 같은 말을 두 번 하지 않는다. */}
                  {childLine(t, tasks ?? []) && (
                    <span className="v3-row-sub">{childLine(t, tasks ?? [])}</span>
                  )}
                </span>
                <span className="v3-row-r">
                  <Avatar name={t.assigneeName} />
                  <span className="v3-due">{shortDue(t.dueDate)}</span>
                  <Link className="v3-btn v3-btn-s" href={taskHref(t.id)}>기한 다시 정하기</Link>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="받은함" sub={inbox ? `${inbox.length}건` : undefined}>
        {!inbox ? <p className="v3-loading">불러오는 중…</p>
          : inbox.length === 0 ? (
            <Empty
              title="받은 것이 없어요"
              why="승인 요청 · 멘션 · 답글 · 인계가 여기로 모입니다. 지금은 처리할 것이 없습니다."
              action={{ label: "활동 전체 보기", href: notYetHref("activity") }}
            />
          ) : inbox.map((i) => (
            <div className="v3-row v3-inbox" key={i.id}>
              <span className="v3-tag etc">{INBOX_LABEL[i.type] ?? i.type}</span>
              <span className="v3-row-main">
                <Link className="v3-row-t" href={inboxHref(i)}>{i.snippet}</Link>
                {i.actorName && <span className="v3-row-sub">{i.actorName}</span>}
              </span>
              {!i.read && <span className="v3-unread" title="안 읽음" aria-label="안 읽음" />}
            </div>
          ))}
      </Card>

      <Card title="오늘 마친 것" sub={view ? `${view.done.length}건` : undefined}>
        {!view ? <p className="v3-loading">불러오는 중…</p>
          : view.done.length === 0 ? (
            <Empty
              title="오늘 마친 것이 아직 없어요"
              why="완료로 바꾼 업무가 여기 쌓입니다. 어제 마친 것은 오늘의 성과가 아니라서 안 뜹니다."
            />
          ) : view.done.map((t) => {
            const a = areaOf(areas, t.areaId);
            return (
              <div className="v3-row done" key={t.id}>
                <span className="v3-row-main">
                  <Link className="v3-row-t" href={taskHref(t.id)}>{t.title}</Link>
                </span>
                <span className="v3-row-r">
                  {a && <Tag area={a} />}
                  {/* 마친 시각도 **KST 로** 그린다. UTC 를 잘라 쓰면 9시간이 어긋난다. */}
                  <span className="v3-due">{doneTime(t.completedAt)}</span>
                </span>
              </div>
            );
          })}
      </Card>
    </>
  );
}
