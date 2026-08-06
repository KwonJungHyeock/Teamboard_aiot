"use client";

// 승인 인박스 (신규) — 사람/에이전트 공간의 유일한 통로.
// 에이전트 산출물 두 종류를 한곳에 모은다: (1) 승인 대기 초안(drafts.pending),
// (2) 에이전트 제안 업무(task.status='proposed'). 승인해야 사람 공간에 들어온다.
import { useCallback, useEffect, useState } from "react";
import PageShell from "./PageShell";
import { useRouter } from "next/navigation";
import type { SessionUser, Draft } from "@/lib/types";
import { toast } from "@/lib/quick";
import ApproveModal, { type DraftSummary } from "./ApproveModal";
import EmptyState from "./EmptyState";

type DraftRow = Draft & { user_name?: string; assistant_name?: string; cost_tokens?: number | null };

const WON_PER_1K = 6;
function costLabel(tokens: number): string {
  const won = Math.max(1, Math.round((tokens / 1000) * WON_PER_1K));
  return `${tokens.toLocaleString()} 토큰 · ₩${won.toLocaleString()}`;
}
const DRAFT_TYPE_LABEL: Record<string, string> = {
  research: "자료조사", organize: "업무정리", monthly_report: "월간보고",
};
function relTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

interface ProposedTask {
  id: number;
  title: string;
  description: string;
  projectName: string | null;
  assigneeName: string | null;
  createdByName: string | null;
  createdAt?: string;
}

export default function InboxView({ user }: { user: SessionUser }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [proposed, setProposed] = useState<ProposedTask[]>([]);
  const [demo, setDemo] = useState(false);
  const [approving, setApproving] = useState<DraftSummary | null>(null);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (k: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });

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
      setDemo(!!dData.demo);
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
    toast("초안을 반려했어요");
    load();
    router.refresh(); // 사이드바 승인 대기 수·FAB 배지 갱신
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
    toast(approve ? "제안 업무를 승인했어요" : "제안 업무를 기각했어요");
    load();
    router.refresh(); // 사이드바 승인 대기 수·FAB 배지 갱신
  }

  const total = drafts.length + proposed.length;
  const excerpt = (s: string) => (s || "").replace(/[#*>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

  return (
    <PageShell
      crumb={["워크스페이스", "승인 대기"]}
      title="승인 대기"
      subtitle={<>에이전트는 제안만 합니다. 사람이 여기서 확정해야 홈·업무·논의·결정에 반영됩니다.</>}
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        {error && <p className="gerr">{error}</p>}

        {/* 데모 모드 — LLM 키 미연결 시 명시 (비용은 예시값) */}
        {demo && (
          <div className="inbox-demo" role="note">
            <b>데모 모드</b> · LLM 키(ANTHROPIC/OPENAI) 미연결 — 초안은 흐름 검증용 샘플이고 비용은 예시값입니다.
          </div>
        )}

        {/* 상단 요약 = 미니 스트립 (대기/초안/제안, tabular) */}
        {total > 0 && (
          <div className="inbox-strip" aria-label="대기 요약">
            <div className="is"><span className="v num">{total}</span><span className="l">대기 항목</span></div>
            <div className="is"><span className="v num">{drafts.length}</span><span className="l">확인 요청 초안</span></div>
            <div className="is"><span className="v num">{proposed.length}</span><span className="l">제안 업무</span></div>
          </div>
        )}

        {total === 0 && !error && (
          <section className="inbox-empty" aria-label="승인 대기 없음">
            <EmptyState
              title="대기 중 제안이 없어요"
              hint="에이전트가 만든 초안·제안 업무가 여기로 모입니다. 승인해야 홈·업무·논의·결정에 반영됩니다."
            />
          </section>
        )}

        {/* 확인 요청 초안 (에이전트 산출 → 사람 확인) */}
        {drafts.length > 0 && (
          <section className="inbox-sec" aria-label="확인 요청 초안">
            <div className="inbox-sh"><h2>확인 요청 초안</h2><span className="sub num">{drafts.length}건</span></div>
            <div className="pcards">
              {drafts.map((d) => (
                <article className="pcard" key={d.id}>
                  <div className="pcard-top">
                    <span className="led s-review" aria-hidden="true" />
                    <span className="pty pty-review">확인요청</span>
                    <span className="pcard-src">{[DRAFT_TYPE_LABEL[d.task_type] ?? d.task_type, d.assistant_name, d.user_name && `${d.user_name} 담당`].filter(Boolean).join(" · ")}</span>
                    <span className="pcard-id num">#{d.id}</span>
                  </div>
                  <b className="pcard-title">{d.title || "(제목 없음)"}</b>
                  {(d.body || "").trim() && (
                    <>
                      <p className={`pcard-body${expanded.has(`d${d.id}`) ? " open" : ""}`}>
                        {expanded.has(`d${d.id}`) ? d.body : excerpt(d.body)}
                      </p>
                      <button className="pcard-more" onClick={() => toggle(`d${d.id}`)}>
                        {expanded.has(`d${d.id}`) ? "접기" : "자세히"}
                      </button>
                    </>
                  )}
                  <div className="pcard-foot">
                    {d.created_at && <span className="pcard-time num">{relTime(d.created_at)}</span>}
                    {typeof d.cost_tokens === "number" && (
                      <span className="pcard-cost num">{costLabel(d.cost_tokens)}</span>
                    )}
                  </div>
                  <div className="pcard-acts">
                    <button className="btn-brand" onClick={() => setApproving({ id: d.id, title: d.title, body: d.body, task_type: d.task_type, user_name: d.user_name })}>승인</button>
                    <button className="btn-outline" onClick={() => rejectDraft(d.id)}>반려</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* 에이전트 제안 업무 */}
        {proposed.length > 0 && (
          <section className="inbox-sec" aria-label="에이전트 제안 업무">
            <div className="inbox-sh"><h2>에이전트 제안 업무</h2><span className="sub num">{proposed.length}건 · 승인 시 업무로 전환</span></div>
            <div className="pcards">
              {proposed.map((t) => (
                <article className="pcard" key={t.id}>
                  <div className="pcard-top">
                    <span className="led s-todo" aria-hidden="true" />
                    <span className="pty pty-propose">제안</span>
                    <span className="pcard-src">{[t.createdByName, t.projectName, t.assigneeName && `${t.assigneeName} 담당`].filter(Boolean).join(" · ")}</span>
                    <span className="pcard-id num">#{t.id}</span>
                  </div>
                  <b className="pcard-title">{t.title}</b>
                  {(t.description || "").trim() && (
                    <>
                      <p className={`pcard-body${expanded.has(`t${t.id}`) ? " open" : ""}`}>
                        {expanded.has(`t${t.id}`) ? t.description : excerpt(t.description)}
                      </p>
                      <button className="pcard-more" onClick={() => toggle(`t${t.id}`)}>
                        {expanded.has(`t${t.id}`) ? "접기" : "자세히"}
                      </button>
                    </>
                  )}
                  {t.createdAt && (
                    <div className="pcard-foot"><span className="pcard-time num">{relTime(t.createdAt)}</span></div>
                  )}
                  <div className="pcard-acts">
                    <button className="btn-brand" onClick={() => judgeTask(t.id, true)}>승인</button>
                    <button className="btn-outline" onClick={() => judgeTask(t.id, false)}>기각</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}
      </div>

      {approving && (
        <ApproveModal
          draft={approving}
          onClose={() => setApproving(null)}
          onDone={(message) => {
            setApproving(null);
            toast(message);
            load();
            router.refresh();
          }}
        />
      )}
    </div>
    </PageShell>
  );
}
