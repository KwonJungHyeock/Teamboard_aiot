"use client";

// v3 「목표」 (MD-P-2026-067 §B).
//
// ── 윗선이 보는 화면이다 ────────────────────────────────────────
//
// 묻는 것이 「업무가 굴러가나」가 아니라 **「목표 대비 어디까지 왔나」**다.
// 그래서 한 줄에 진척 막대가 있고, 누르면 그 목표에 달린 업무로 간다.
//
// ── 무엇을 먹는가 ──────────────────────────────────────────────
//
// `/api/goals` 하나뿐이다. **새 API 는 없다.** 진척은 그 응답의 값을 그대로
// 그린다 — 여기서 다시 계산하지 않는다(§B-7). 집계 화면도 같은 값을 본다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, Chip, Menu, MenuItem, Empty, Avatar } from "./parts";
import {
  flatten, selectGoals, quarters, periodLabel, goalChips, isEmptyGoalQuery, pctText,
  type GoalRow, type GoalQuery, type GoalState,
} from "@/lib/v3/goal-list";
import { V3_BASE } from "@/lib/v3/routes";

const STATE_TABS = [
  { v: "all", label: "전체" },
  { v: "open", label: "진행중" },
  { v: "ended", label: "끝난 것" },
] as const;

export default function GoalsView({ me }: { me: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [rows, setRows] = useState<GoalRow[] | null>(null);
  const [err, setErr] = useState("");

  /** 조건은 **전부 주소에 담긴다** — 링크를 보낸 사람과 받은 사람이 같은 것을 본다. */
  const query: GoalQuery = useMemo(() => ({
    mine: sp.get("mine") === "1",
    state: (["open", "ended"] as string[]).includes(sp.get("state") ?? "")
      ? (sp.get("state") as GoalState) : "all",
    quarter: sp.get("q") ?? "",
  }), [sp]);

  const setQuery = useCallback((next: Partial<GoalQuery>) => {
    const p = new URLSearchParams(sp.toString());
    const put = (k: string, v: string) => { if (v === "") p.delete(k); else p.set(k, v); };
    if (next.mine !== undefined) put("mine", next.mine ? "1" : "");
    if (next.state !== undefined) put("state", next.state === "all" ? "" : next.state);
    if (next.quarter !== undefined) put("q", next.quarter);
    router.replace(p.toString() ? `?${p}` : "?", { scroll: false });
  }, [router, sp]);

  useEffect(() => {
    fetch("/api/goals")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("목표를 불러오지 못했습니다."))))
      .then((d) => setRows(flatten(d.tree)))
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  const all = rows ?? [];
  const picked = useMemo(() => selectGoals(all, query, me), [all, query, me]);
  const qs = useMemo(() => quarters(all), [all]);
  const chips = goalChips(query);
  const nothing = isEmptyGoalQuery(query);

  return (
    <>
      <h1 className="v3-h1">목표</h1>
      {/* 066 §D 에서 배운 것 — **두 숫자는 같은 모집단에서** 센다 */}
      <p className="v3-lede">
        {rows === null ? "불러오는 중…"
          : `${picked.length}건${nothing ? "" : ` · 전체 ${all.length}건 중`}`}
      </p>

      {err && <Card><p className="v3-err">{err}</p></Card>}

      {/* 거르개 셋 — 업무 목록의 차례와 **같은 결**이다(066 §C-15).
          [◉내 항목] | [전체][진행중][끝난 것] | [분기▾] */}
      <div className="v3-fbar" role="group" aria-label="거르개">
        <Chip on={query.mine} onClick={() => setQuery({ mine: !query.mine })}>◉ 내 항목</Chip>
        <span className="v3-fbar-div" aria-hidden="true" />
        <div className="v3-tabs" role="group" aria-label="상태">
          {STATE_TABS.map((t) => (
            <button key={t.v} type="button" className={`v3-tab${query.state === t.v ? " on" : ""}`}
                    aria-pressed={query.state === t.v}
                    onClick={() => setQuery({ state: t.v })}>
              {t.label}
            </button>
          ))}
        </div>
        <span className="v3-fbar-div" aria-hidden="true" />
        <Menu label="분기" value={query.quarter || null}>
          <MenuItem on={query.quarter === ""} onClick={() => setQuery({ quarter: "" })}>전체</MenuItem>
          {qs.map((q) => (
            <MenuItem key={q} on={query.quarter === q} onClick={() => setQuery({ quarter: q })}>{q}</MenuItem>
          ))}
        </Menu>
      </div>

      {rows === null ? <Card><p className="v3-loading">불러오는 중…</p></Card>
        : picked.length === 0 ? (
          <Card>
            {/* 빈 화면 **두 갈래**(§B-10) — 걸러서 0 과 원래 0 은 다른 문장이다 */}
            <Empty
              title={nothing ? "목표가 없어요" : "조건에 맞는 목표가 없어요"}
              why={nothing
                ? "아직 등록된 목표가 없습니다. 목표는 분기와 달로 나눠서 세웁니다."
                : `걸린 조건 — ${chips.join(" · ")}. 전체 ${all.length}건 중 0건입니다.`}
              action={nothing ? undefined : { label: "조건 지우기", href: `${V3_BASE}/goals` }}
            />
          </Card>
        ) : (
          <Card>
            {picked.map((g) => (
              <Link className="v3-row v3-goal" key={g.id} href={`${V3_BASE}/goals/${g.id}`}>
                <span className="v3-row-main">
                  <span className="v3-row-t">{g.title}</span>
                  <span className="v3-row-sub">{periodLabel(g)} · 업무 {g.countedTasks}건</span>
                </span>
                {/* 진척 — **서버가 센 값 그대로.** 못 센 것은 「—」다(0% 가 아니다) */}
                <span className="v3-goal-bar">
                  <span className="v3-bar" role="img" aria-label={`진척 ${pctText(g.progress)}`}>
                    <span style={{ width: `${g.progress ?? 0}%` }} />
                  </span>
                  <b className="v3-goal-pct">{pctText(g.progress)}</b>
                </span>
                <span className="v3-row-r">
                  <Avatar name={g.ownerName} />
                </span>
              </Link>
            ))}
          </Card>
        )}
    </>
  );
}
