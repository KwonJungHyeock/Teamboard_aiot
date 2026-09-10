"use client";

// 승인 대기 — **남은 제안 업무를 정리하는 자리** (MD-P-2026-041 §B 배치 ②).
//
// ── 무엇이 없어졌고 무엇이 남았는가 ──────────────────────────────
//
// 전에는 두 가지가 모였다: (1) 에이전트가 만든 **승인 대기 초안**(`drafts`),
// (2) **제안 상태 업무**(`task.status='proposed'`). 에이전트를 철거하면서
// (1)을 지웠다 — 초안을 만들던 것도, 승인/반려하던 라우트도 없다.
//
// (2)는 **남긴다.** 이유는 두 가지다.
//   · `task.status='proposed'` 는 DB 데이터고, 이번 철거는 데이터를 안 건드린다.
//     화면만 없애면 그 업무들은 **영영 'proposed' 에 갇힌다** — 업무 목록은
//     제안 상태를 걸러 내므로 볼 수도, 승인할 수도, 기각할 수도 없게 된다.
//   · 홈 · 팀 활동 · 활동 인박스 세 곳이 이 화면을 가리킨다. 통째로 지우면
//     갈 곳 없는 링크가 셋 생긴다.
//
// **새 제안은 더 생기지 않는다.** 만들던 쪽이 없어졌기 때문이다. 그래서 이
// 화면은 늘어나지 않고 줄기만 하는 자리다 — 화면에도 그렇게 적는다.
import { useCallback, useEffect, useState } from "react";
import PageShell from "./PageShell";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/types";
import { toast } from "@/lib/quick";
import EmptyState from "./EmptyState";
import ErrorNote from "./ErrorNote";

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
  void user;                            // 범위는 서버가 정한다 (`/api/tasks` 의 inbox)
  const router = useRouter();
  const [proposed, setProposed] = useState<ProposedTask[]>([]);
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
      const res = await fetch("/api/tasks");
      const data = await res.json();
      setProposed(data.inbox ?? []);
      setError("");
    } catch {
      setError("인박스를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
    router.refresh(); // 사이드바 승인 대기 수 갱신
  }

  const excerpt = (s: string) => (s || "").replace(/[#*>`]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);

  return (
    <PageShell
      crumb={["워크스페이스", "승인 대기"]}
      title="승인 대기"
      subtitle={<>제안 상태로 남아 있는 업무입니다. 승인해야 업무 목록에 들어옵니다.</>}
    >
    <div className="hv pg-legacy">
      <div className="wrap">

        {error && <ErrorNote message={error} onRetry={load} />}

        {/* 이 화면이 왜 늘지 않는지 적는다. 안 적으면 「고장인가」로 읽힌다. */}
        {proposed.length > 0 && (
          <div className="inbox-demo" role="note">
            <b>남은 것만 정리하는 자리입니다</b> · 제안을 만들던 에이전트 기능이 없어져 새 제안은 더 생기지 않습니다.
          </div>
        )}

        {proposed.length === 0 && !error && (
          <section className="inbox-empty" aria-label="승인 대기 없음">
            <EmptyState
              icon="inbox"
              title="대기 중 제안이 없어요"
              hint="제안 상태로 남은 업무가 여기 모입니다. 제안을 만들던 에이전트 기능이 없어져 새로 생기지는 않습니다."
            />
          </section>
        )}

        {proposed.length > 0 && (
          <section className="inbox-sec" aria-label="제안 업무">
            <div className="inbox-sh"><h2>제안 업무</h2><span className="sub num">{proposed.length}건 · 승인 시 업무로 전환</span></div>
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
    </div>
    </PageShell>
  );
}
