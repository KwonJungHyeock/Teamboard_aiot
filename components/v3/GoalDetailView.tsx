"use client";

// v3 「목표 상세」 — **그 목표에 달린 업무 목록** (MD-P-2026-067 §B-8).
//
// ── 업무를 따로 고르지 않는다 ───────────────────────────────────
//
// 지시서 §B-8: 「§C-2 의 그 함수를 지난다(066 에서 만든 `lib/v3/list-query.ts`).
// 목표 상세가 업무를 따로 고르지 않는다.」
//
// 그래서 여기서 하는 일은 **하나**다 — 「이 목표에 달렸는가」로 추린 뒤
// `selectRows()` 에 넣는다. 권한 거르기도 그 안에 있다. 조건을 여기서 새로
// 적기 시작하면 업무 목록과 갈리고, 그러면 같은 업무가 두 화면에서 다르게 보인다.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, ListRow, Empty } from "./parts";
import type { CbState } from "./parts";
import { childLine, shortDue, type TodayTask } from "@/lib/v3/today";
import { dueTone } from "@/lib/v3/tasks";
import { selectRows, EMPTY_LIST_QUERY } from "@/lib/v3/list-query";
import { periodLabel, pctText, flatten, type GoalRow } from "@/lib/v3/goal-list";
import { taskHref, V3_BASE } from "@/lib/v3/routes";
import { countLinks } from "@/lib/v3/links";

const stateOf = (s: string): CbState =>
  s === "done" ? "done" : s === "doing" ? "doing" : s === "review" ? "review" : "todo";

export default function GoalDetailView({
  id, me, today,
}: { id: number; me: number; today: string }) {
  const [goal, setGoal] = useState<GoalRow | null>(null);
  const [tasks, setTasks] = useState<TodayTask[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    void (async () => {
      const [g, t] = await Promise.all([
        fetch("/api/goals").then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/tasks").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!g || !t) { setErr("목표를 불러오지 못했습니다."); return; }
      setGoal(flatten(g.tree).find((x) => x.id === id) ?? null);
      setTasks(t.tasks ?? []);
    })();
  }, [id]);

  /**
   * 이 목표에 달린 업무. **거르는 일은 `selectRows()` 가 한다** — 여기서는
   * 「이 목표에 달렸는가」만 묻는다(§B-8).
   */
  const rows = useMemo(() => {
    const linked = (tasks ?? []).filter((t) => (t.goalIds ?? []).includes(id));
    return selectRows(linked, EMPTY_LIST_QUERY, me, today);
  }, [tasks, id, me, today]);

  if (err) {
    return (
      <Card>
        <Empty title="이 목표를 열 수 없어요" why={err}
               action={{ label: "목표 목록으로", href: `${V3_BASE}/goals` }} />
      </Card>
    );
  }
  if (tasks === null) return <Card><p className="v3-loading">불러오는 중…</p></Card>;
  if (!goal) {
    return (
      <Card>
        {/* **이름을 지어내지 않는다.** 없는 목표 번호로 들어온 자리다 */}
        <Empty title="그 목표가 목록에 없어요"
               why="지워졌거나, 볼 수 없는 목표입니다."
               action={{ label: "목표 목록으로", href: `${V3_BASE}/goals` }} />
      </Card>
    );
  }

  return (
    <>
      <p className="v3-crumb">
        <Link href={`${V3_BASE}/goals`}>목표</Link>
        <span aria-hidden="true"> / </span>
        <span>{periodLabel(goal)}</span>
      </p>
      <h1 className="v3-h1">{goal.title}</h1>
      <p className="v3-lede">
        {periodLabel(goal)} · 업무 {goal.countedTasks}건
        {goal.ownerName && ` · 담당 ${goal.ownerName}`}
      </p>

      {/* 진척 — **서버가 센 값 그대로**(§B-7). 여기서 다시 계산하지 않는다 */}
      <Card title="진척" sub={pctText(goal.progress)}>
        <div className="v3-bar" role="img" aria-label={`진척 ${pctText(goal.progress)}`}>
          <span style={{ width: `${goal.progress ?? 0}%` }} />
        </div>
        <p className="v3-why">
          집계 화면과 **같은 값**입니다. 이 화면에서 다시 세지 않습니다.
          {goal.progress === null && " 지금은 셀 근거가 없어 「—」로 둡니다 — 0% 가 아닙니다."}
        </p>
      </Card>

      <Card title="달린 업무" sub={`${rows.length}건`}>
        {rows.length === 0 ? (
          <Empty title="달린 업무가 없어요"
                 why="이 목표에 연결된 업무가 아직 없습니다. 업무 상세의 「목표」에서 연결합니다."
                 action={{ label: "업무 목록으로", href: `${V3_BASE}/tasks` }} />
        ) : rows.map((t) => {
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
    </>
  );
}
