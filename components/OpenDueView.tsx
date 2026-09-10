"use client";

// 가오픈 기준 기한 — **읽기 전용 집계 화면** (MD-P-2026-041 §C).
//
// 세 갈래 집계가 037 에서 만들어졌지만 검사기 안에서만 돌았다. 지시자가 볼 수
// 있어야 판단이 된다. 여기서는 **보여 주기만** 한다 — 기한을 옮기는 것은
// 사람이 업무 화면에서 한다(037 의 판단 그대로: 날짜를 일괄로 밀지 않는다).
//
// 총합을 함께 그린다. 세 갈래 + 완료 제외 = 전체가 **화면에서** 맞아야 한다 —
// 안 맞는 총합은 다시 세게 만들고, 다시 세면 또 다른 숫자가 나온다.
import { useEffect, useState } from "react";
import Link from "next/link";
import PageShell from "./PageShell";
import Skeleton from "./Skeleton";
import ErrorNote from "./ErrorNote";
import EmptyState from "./EmptyState";

interface Row {
  id: number; title: string; status: string; dueDate: string | null;
  assignee: string | null; area: string | null; project: string | null;
  daysAfterOpen: number | null; label: string | null;
}
interface Payload {
  openAt: string;
  tally: { before: number; after: number; none: number; excludedDone: number };
  totalActive: number;
  after: Row[];
  none: Row[];
}

const STATUS_LABEL: Record<string, string> = {
  proposed: "제안", todo: "할 일", doing: "진행", review: "검토", done: "완료", dropped: "중단",
};

function Table({ rows, showAfter }: { rows: Row[]; showAfter: boolean }) {
  return (
    <table className="od-t">
      <thead>
        <tr>
          <th>업무</th><th>담당</th><th>기한</th><th>영역</th><th>상태</th>
          {showAfter && <th className="od-n">가오픈보다</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            {/*
              각 행에서 그 업무로 간다 — 보고 나서 고칠 데가 없으면 보나 마나다.
              주소는 `?panel=task:id` 다. 처음엔 `?task=id` 로 썼는데 그건 레거시
              파라미터라 **목록으로만 가고 상세가 안 열렸다.** 검사기가 「그 업무가
              화면에 안 떴다」로 잡았다 — 주소가 맞는지가 아니라 도착한 화면이
              그 업무인지를 물어야 이런 것이 걸린다.
            */}
            <td><Link className="lk" href={`/tasks?panel=task:${r.id}`}>{r.title}</Link></td>
            <td>{r.assignee ?? "—"}</td>
            <td className="num">{r.dueDate ?? "—"}</td>
            <td>{r.area ?? r.project ?? "—"}</td>
            <td>{STATUS_LABEL[r.status] ?? r.status}</td>
            {showAfter && <td className="od-n num">{r.daysAfterOpen === null ? "—" : `+${r.daysAfterOpen}일`}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function OpenDueView() {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/tasks/open-due")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? "불러오지 못했습니다."))))
      .then(setD)
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  if (err) return <PageShell crumb={["관리", "가오픈 기한"]} title="가오픈 기준 기한"><div className="wrap"><ErrorNote message={err} /></div></PageShell>;
  if (!d) return <PageShell crumb={["관리", "가오픈 기한"]} title="가오픈 기준 기한"><div className="wrap"><Skeleton variant="list" /></div></PageShell>;

  const { tally } = d;
  const sum = tally.before + tally.after + tally.none + tally.excludedDone;
  const openDay = d.openAt.slice(0, 10);

  return (
    <PageShell
      crumb={["관리", "가오픈 기한"]}
      title="가오픈 기준 기한"
      subtitle={<>가오픈 {openDay} 기준으로 등록된 기한이 어디 서 있는지 봅니다. <b>이 화면은 읽기만 합니다</b> — 기한은 업무에서 고칩니다.</>}
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        <div className="od-strip" aria-label="세 갈래 집계">
          <div className="is"><span className="v num">{tally.before}</span><span className="l">가오픈 이전</span></div>
          <div className="is"><span className="v num">{tally.after}</span><span className="l">가오픈 이후</span></div>
          <div className="is"><span className="v num">{tally.none}</span><span className="l">기한 없음</span></div>
          <div className="is mu"><span className="v num">{tally.excludedDone}</span><span className="l">완료 (세 갈래에서 뺌)</span></div>
        </div>

        {/* 총합을 **화면에서** 맞춰 본다. 빼고 나서 몇을 뺐는지 적어도, 더해서
            전체가 되는지 보여 주지 않으면 읽는 사람이 계산기를 켜야 한다. */}
        <p className={`od-sum${sum === d.totalActive ? "" : " bad"}`}>
          {tally.before} + {tally.after} + {tally.none} + {tally.excludedDone} = <b>{sum}</b>
          {sum === d.totalActive
            ? <> · 활성 업무 {d.totalActive}건과 맞습니다</>
            : <> · <b>활성 업무 {d.totalActive}건과 안 맞습니다 — 세다가 빠뜨린 것이 있습니다</b></>}
        </p>

        <section className="inbox-sec" aria-label="가오픈 이후 기한">
          <div className="inbox-sh">
            <h2>가오픈 이후에 걸린 기한</h2>
            <span className="sub num">{d.after.length}건 · 완료 제외</span>
          </div>
          {d.after.length === 0
            ? <EmptyState icon="inbox" title="가오픈 뒤로 넘어간 기한이 없어요" hint={`등록된 기한이 모두 ${openDay} 이전입니다.`} />
            : <Table rows={d.after} showAfter />}
        </section>

        <section className="inbox-sec" aria-label="기한 없음">
          <div className="inbox-sh">
            <h2>기한이 없는 업무</h2>
            <span className="sub num">{d.none.length}건 · 완료 제외</span>
          </div>
          {/* 기한 없음은 「먼 미래」가 아니라 별개 갈래다 — 아무 날에도 안 걸려서
              마지막까지 안 보인다. 그래서 목록으로 낸다. */}
          {d.none.length === 0
            ? <EmptyState icon="inbox" title="기한 없는 업무가 없어요" hint="활성 업무에 모두 기한이 있습니다." />
            : <Table rows={d.none} showAfter={false} />}
        </section>

      </div>
    </div>
    </PageShell>
  );
}
