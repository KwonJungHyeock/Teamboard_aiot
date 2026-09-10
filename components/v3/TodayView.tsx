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
import { Card, StatTile, ListRow, Empty, Tag } from "./parts";
import type { CbState } from "./parts";
import {
  countToday, splitToday, childLine, shortDue, inboxItems, weekEnd, kstDate,
  type TodayTask, type InboxItem,
} from "@/lib/v3/today";
import { areaOf, type AreaView } from "@/lib/v3/category";
import { V3_BASE } from "@/lib/v3/routes";

/** 알림이 가리키는 곳. 종류마다 갈 데가 다르다. */
function inboxHref(i: InboxItem): string {
  if (i.refType === "task" && i.refId) return `${V3_BASE}/tasks/${i.refId}`;
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
        <StatTile n={view?.counts.doing ?? 0} label="진행 중" />
        <StatTile n={view?.counts.thisWeek ?? 0} label={`이번 주 마감 (~${weekEnd(today).slice(5)})`} />
        <StatTile n={view?.counts.noDue ?? 0} label="기한 없음" warn />
      </div>

      <Card title="오늘 할 일" sub={view ? `${view.todo.length}건 · 기한이 지났거나 오늘 마감` : undefined}>
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
              href={`${V3_BASE}/tasks/${t.id}`}
              title={t.title}
              sub={childLine(t, tasks ?? [])}
              state={stateOf(t.status)}
              assignee={t.assigneeName}
              due={shortDue(t.dueDate)}
              late={t.late}
            />
          ))}
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
                  <Link className="v3-row-t" href={`${V3_BASE}/tasks/${t.id}`}>{t.title}</Link>
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
