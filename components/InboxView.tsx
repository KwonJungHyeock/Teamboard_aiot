"use client";

// 승인 인박스 (신규) — 사람/에이전트 공간의 유일한 통로.
// 에이전트 산출물 두 종류를 한곳에 모은다: (1) 승인 대기 초안(drafts.pending),
// (2) 에이전트 제안 업무(task.status='proposed'). 승인해야 사람 공간에 들어온다.
import { useCallback, useEffect, useState } from "react";
import type { SessionUser, Draft } from "@/lib/types";
import ApproveModal, { type DraftSummary } from "./ApproveModal";
import EmptyState from "./EmptyState";

type DraftRow = Draft & { user_name?: string; assistant_name?: string };

interface ProposedTask {
  id: number;
  title: string;
  description: string;
  projectName: string | null;
  assigneeName: string | null;
  createdByName: string | null;
}

export default function InboxView({ user }: { user: SessionUser }) {
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [proposed, setProposed] = useState<ProposedTask[]>([]);
  const [approving, setApproving] = useState<DraftSummary | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const scope = user.role === "lead" ? "&scope=all" : "";
      const [dRes, tRes] = await Promise.all([
        fetch(`/api/drafts?status=pending${scope}`),
        fetch("/api/tasks"),
      ]);
      const dData = await dRes.json();
      const tData = await tRes.json();
      setDrafts(dData.drafts ?? []);
      setProposed(tData.inbox ?? []);
      setError("");
    } catch {
      setError("인박스를 불러오지 못했습니다.");
    }
  }, [user.role]);

  useEffect(() => {
    load();
  }, [load]);

  async function rejectDraft(id: number) {
    const feedback = window.prompt("반려 사유(에이전트 재작성에 전달)");
    if (feedback === null) return;
    const res = await fetch(`/api/drafts/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "반려 실패");
      return;
    }
    setNotice("초안을 반려했습니다.");
    load();
  }

  async function judgeTask(id: number, approve: boolean) {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: approve ? "todo" : "dropped", dropReason: approve ? undefined : "인박스 기각" }),
    });
    if (!res.ok) {
      setError((await res.json()).error ?? "처리 실패");
      return;
    }
    setNotice(approve ? "제안 업무를 승인했습니다." : "제안 업무를 기각했습니다.");
    load();
  }

  const total = drafts.length + proposed.length;

  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          워크스페이스 / <b>승인 대기</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">INBOX</div>
            <h1>승인 대기</h1>
            <p>에이전트 산출물은 여기서 승인해야 사람 공간(홈·업무·논의·결정)에 반영됩니다.</p>
          </div>
        </div>

        {error && <p className="gerr">{error}</p>}
        {notice && <p className="rp-notice">{notice}</p>}

        {total === 0 && !error && (
          <section className="card" aria-label="승인 대기 없음">
            <EmptyState
              title="대기 중인 승인 항목이 없어요"
              hint="에이전트가 만든 초안·제안 업무가 여기로 모입니다. 승인해야 홈·업무·논의·결정에 반영됩니다."
            />
          </section>
        )}

        {/* 승인 대기 초안 */}
        {drafts.length > 0 && (
          <section className="card section-gap" aria-label="승인 대기 초안">
            <div className="ch">
              <h2>승인 대기 초안</h2>
              <span className="sub">{drafts.length}건</span>
            </div>
            {drafts.map((d) => (
              <div className="tinbox-row" key={d.id}>
                <span className="st prop">{d.task_type}</span>
                <div className="tinbox-b">
                  <b>{d.title || "(제목 없음)"}</b>
                  <em>
                    {[d.assistant_name, d.user_name && `${d.user_name} 담당`].filter(Boolean).join(" · ")}
                  </em>
                </div>
                <span className="gsp" />
                <button
                  className="btn-brand"
                  onClick={() => setApproving({ id: d.id, title: d.title, body: d.body, task_type: d.task_type, user_name: d.user_name })}
                >
                  승인
                </button>
                <button className="btn-outline" onClick={() => rejectDraft(d.id)}>
                  반려
                </button>
              </div>
            ))}
          </section>
        )}

        {/* 에이전트 제안 업무 */}
        {proposed.length > 0 && (
          <section className="card section-gap" aria-label="에이전트 제안 업무">
            <div className="ch">
              <h2>에이전트 제안 업무</h2>
              <span className="sub">{proposed.length}건 — 승인 시 업무로 전환</span>
            </div>
            {proposed.map((t) => (
              <div className="tinbox-row" key={t.id}>
                <span className="st prop">제안</span>
                <div className="tinbox-b">
                  <b>{t.title}</b>
                  <em>
                    {[t.createdByName, t.projectName, t.assigneeName && `${t.assigneeName} 담당`].filter(Boolean).join(" · ")}
                  </em>
                </div>
                <span className="gsp" />
                <button className="btn-brand" onClick={() => judgeTask(t.id, true)}>
                  승인
                </button>
                <button className="btn-outline" onClick={() => judgeTask(t.id, false)}>
                  기각
                </button>
              </div>
            ))}
          </section>
        )}
      </div>

      {approving && (
        <ApproveModal
          draft={approving}
          onClose={() => setApproving(null)}
          onDone={(message) => {
            setApproving(null);
            setNotice(message);
            load();
          }}
        />
      )}
    </div>
  );
}
