"use client";

// 에이전트 흔적 집계 — **읽기 전용. 삭제 버튼은 없다** (MD-P-2026-038 §B-1).
//
// 철거 전에 **무엇이 몇 건 있는지** 먼저 본다. 모르는 채로 지우는 것은 되돌릴 수
// 없는 판단이다.
//
// 숫자 옆에 **그게 무엇인지 한 줄**을 함께 그린다 — 숫자만 있으면 그 숫자가
// 지워도 되는 것인지 판단할 수 없다.
import { useEffect, useState } from "react";

interface Payload {
  what: Record<string, string>;
  counts: {
    agentActors: number; agentConfig: number; agentJob: number;
    drafts: number; monthlyDrafts: number; originAgent: number; proposed: number;
  };
  agentTasks: { id: number; title: string; assignee: string | null; createdAt: string; status: string; isActive: boolean }[];
  drafts: { id: number; title: string | null; owner: string | null; createdAt: string; status: string }[];
}

const ROWS: { key: keyof Payload["counts"]; label: string }[] = [
  { key: "agentActors", label: "에이전트 actor" },
  { key: "agentConfig", label: "agent_config" },
  { key: "agentJob", label: "agent_job" },
  { key: "drafts", label: "에이전트 초안 (drafts)" },
  { key: "monthlyDrafts", label: "└ 그중 월간 보고" },
  { key: "originAgent", label: "에이전트가 만든 업무" },
  { key: "proposed", label: "제안 상태 업무" },
];

export default function AgentUsage() {
  const [d, setD] = useState<Payload | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/admin/agent-usage")
      .then(async (r) => (r.ok ? r.json() : Promise.reject(new Error((await r.json()).error ?? "불러오지 못했습니다."))))
      .then(setD)
      .catch((e) => setErr(String(e.message ?? e)));
  }, []);

  if (err) return <section className="tile"><p className="ps-warn">{err}</p></section>;
  if (!d) return <section className="tile"><p className="prop-none">불러오는 중…</p></section>;

  return (
    <section className="tile au" aria-label="에이전트 흔적">
      <h2 className="tile-t">에이전트 흔적</h2>
      <p className="ps-help au-top">
        철거 전에 세어 두는 값입니다. <b>이 화면은 읽기만 합니다</b> — 지우는 버튼은 없습니다.
      </p>

      <table className="au-t">
        <thead>
          <tr><th>항목</th><th className="au-n">건수</th><th>무엇인가</th></tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.key}>
              <td>{r.label}</td>
              <td className="au-n num">{d.counts[r.key]}</td>
              <td className="au-w">{d.what[r.key] ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 건수만으로는 정할 수 없는 둘 — **내용을 봐야 지울지 남길지 정한다.** */}
      <h3 className="au-h">에이전트가 만든 업무 {d.agentTasks.length}건</h3>
      {d.agentTasks.length === 0
        ? <p className="prop-none">없습니다.</p>
        : (
          <table className="au-t">
            <thead><tr><th>제목</th><th>담당</th><th>만든 날</th><th>상태</th></tr></thead>
            <tbody>
              {d.agentTasks.map((t) => (
                <tr key={t.id}>
                  <td>{t.title}{!t.isActive && <em className="au-off"> (보관됨)</em>}</td>
                  <td>{t.assignee ?? "—"}</td>
                  <td className="num">{t.createdAt}</td>
                  <td>{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h3 className="au-h">에이전트 초안 {d.drafts.length}건 <em className="au-off">(월간 보고 제외)</em></h3>
      {d.drafts.length === 0
        ? <p className="prop-none">없습니다.</p>
        : (
          <table className="au-t">
            <thead><tr><th>제목</th><th>만든 사람</th><th>만든 날</th><th>상태</th></tr></thead>
            <tbody>
              {d.drafts.map((x) => (
                <tr key={x.id}>
                  <td>{x.title ?? <em className="au-off">(제목 없음)</em>}</td>
                  <td>{x.owner ?? "—"}</td>
                  <td className="num">{x.createdAt}</td>
                  <td>{x.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
    </section>
  );
}
