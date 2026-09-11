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
import { V3_BASE, taskHref } from "@/lib/v3/routes";
// 가오픈 카드가 쓰는 것 — **계산은 저기 한 곳에 있다** (051 §A-3).
import { weeksAndDays, longDateKst } from "@/lib/countdown";
// 오늘 화면에도 **썸네일이 아니라 개수만** (051 §C-3).
import { countLinks } from "@/lib/v3/links";

/** 알림이 가리키는 곳. 종류마다 갈 데가 다르다. */
function inboxHref(i: InboxItem): string {
  if (i.refType === "task" && i.refId) return taskHref(i.refId);
  if (i.refType === "signal" && i.refId) return `/signals?panel=signal:${i.refId}`;
  if (i.refType === "handover") return "/handover";
  return "/activity";
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

export default function TodayView({
  name, today, openAtMs, dday, areas,
}: {
  name: string;
  /** KST 오늘(YYYY-MM-DD). **서버가 정해서 넘긴다** — 브라우저 시계를 안 믿는다. */
  today: string;
  openAtMs: number;
  /** 가오픈까지 남은 날. 대문 카운트다운과 **같은 곳에서 센 값**이다. */
  dday: number;
  areas: AreaView[];
}) {
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [inbox, setInbox] = useState<InboxItem[] | null>(null);
  const [err, setErr] = useState("");
  // 오래 밀린 일은 **접혀서** 시작한다. 펼치는 것은 사람이 정한다.
  const [openStale, setOpenStale] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/tasks").then((r) => (r.ok ? r.json() : Promise.reject(new Error("업무를 불러오지 못했습니다.")))),
      fetch("/api/notifications").then((r) => (r.ok ? r.json() : { items: [] })),
    ])
      .then(([t, n]) => { setTasks(t.tasks ?? []); setInbox(inboxItems(n.items ?? [])); })
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const view = useMemo(() => {
    if (!tasks) return null;
    return { counts: countToday(tasks, today), ...splitToday(tasks, today) };
  }, [tasks, today]);

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
        <StatTile n={view?.counts.doing ?? 0} label="진행 중" />
        <StatTile n={view?.counts.thisWeek ?? 0} label={`이번 주 마감 (~${shortDate(weekEnd(today))})`} />
        <StatTile n={view?.counts.noDue ?? 0} label="기한 없음" warn />
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
                ? { label: "기한 없는 업무 보기", href: "/open-due" }
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
              action={{ label: "활동 전체 보기", href: "/activity" }}
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
