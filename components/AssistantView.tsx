"use client";

// 화면 A — 내 부사수 (PRD 6장)
import { useCallback, useEffect, useState } from "react";
import ApproveModal from "./ApproveModal";
import { NOTION_WORK_AREAS, TASK_TYPES } from "@/lib/types";
import type { ActivityEntry, AssistantSettings, Draft, SessionUser, TaskType } from "@/lib/types";

type DraftRow = Draft & { user_name?: string; assistant_name?: string };

// 카운트 배지 — 0이면 렌더하지 않음(숨김). warn=true 는 조치 필요(승인 대기 등) → 경고색.
// 브랜드 레드는 카운트에 쓰지 않는다 (D-016 확장 · globals.css .count 규칙).
function CountBadge({ n, warn }: { n: number; warn?: boolean }) {
  if (n <= 0) return null;
  return <span className={`count${warn ? " warn" : ""}`}>{n}</span>;
}

// 빈 상태 일러스트 슬롯 — 이미지는 기본 숨김(display:none)이며 로드 성공 시에만 노출한다.
// 파일이 없으면(404) onLoad가 오지 않아 숨김 그대로 → 깨진 이미지 아이콘도, 빈 여백도 없이
// 텍스트만 남는다. /assets/illust/*.png 파일이 도착하면 자동으로 나타난다 (P1-3).
function EmptyState({ img, children }: { img: string; children: React.ReactNode }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="empty-state">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/assets/illust/${img}`}
        alt=""
        style={{ display: loaded ? "block" : "none" }}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
      <p className="muted">{children}</p>
    </div>
  );
}

// 활동 로그 시각 — 오늘이면 HH:MM:SS, 그 외 날짜는 MM-DD HH:MM (JetBrains Mono·자리수 정렬).
function fmtLogTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay
    ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
    : `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AssistantView({ user }: { user: SessionUser }) {
  const [assistant, setAssistant] = useState<AssistantSettings | null>(null);
  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [teamDrafts, setTeamDrafts] = useState<DraftRow[]>([]); // lead 전용 — 팀원 초안 (scope=all)
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [taskType, setTaskType] = useState<TaskType>("자료조사");
  const [instruction, setInstruction] = useState("");
  const [delegating, setDelegating] = useState(false);
  const [notice, setNotice] = useState("");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [approving, setApproving] = useState<DraftRow | null>(null);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const refresh = useCallback(async () => {
    const [draftsRes, activityRes] = await Promise.all([
      fetch("/api/drafts").then((r) => r.json()),
      fetch("/api/activity").then((r) => r.json()),
    ]);
    if (draftsRes.drafts) setDrafts(draftsRes.drafts);
    if (activityRes.entries) setActivity(activityRes.entries);
    // lead — 팀원 초안 승인 경로 (구 /control 승인 처리 흡수). 본인 것은 위의 개인 섹션에서 처리
    if (user.role === "lead") {
      const teamRes = await fetch("/api/drafts?scope=all&status=pending").then((r) => r.json());
      if (teamRes.drafts) {
        setTeamDrafts(
          teamRes.drafts.filter(
            (d: DraftRow) => d.user_id !== user.id && d.task_type !== "monthly_report"
          )
        );
      }
    }
  }, [user.role, user.id]);

  useEffect(() => {
    fetch("/api/assistant/settings")
      .then((r) => r.json())
      .then((data) => data.assistant && setAssistant(data.assistant));
    refresh();
    const timer = setInterval(refresh, 8000);
    return () => clearInterval(timer);
  }, [refresh]);

  // 월간 보고 초안(monthly_report)은 /reports에서 승인한다. 부사수 화면에는 부수 업무 초안만.
  const working = drafts.filter((d) => d.status === "working" && d.task_type !== "monthly_report");
  const pending = drafts.filter((d) => d.status === "pending" && d.task_type !== "monthly_report");
  const rejected = drafts.filter((d) => d.status === "rejected" && d.task_type !== "monthly_report");
  const decided = drafts.filter((d) => d.status === "approved").slice(0, 5);

  const assistantStatus =
    working.length > 0 ? "작동중" : pending.length > 0 ? "보고대기" : "대기";
  const statusColor =
    assistantStatus === "작동중" ? "blue" : assistantStatus === "보고대기" ? "yellow" : "";

  async function delegate(rework?: DraftRow) {
    if (!rework && !instruction.trim()) return;
    setDelegating(true);
    setNotice("");
    try {
      const res = await fetch("/api/assistant/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          rework
            ? { taskType: rework.task_type, instruction: rework.instruction, reworkOf: rework.id }
            : { taskType, instruction }
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setNotice(`오류: ${data.error ?? "초안 생성 실패"}`);
      } else {
        setNotice(`초안 완성: "${data.draft?.title}" — 보고 대기에 올라왔습니다.`);
        if (!rework) setInstruction("");
      }
    } catch {
      setNotice("오류: 서버에 연결할 수 없습니다.");
    } finally {
      setDelegating(false);
      refresh();
    }
  }

  async function reject(id: number) {
    const res = await fetch(`/api/drafts/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feedback }),
    });
    if (res.ok) {
      setNotice("반려 처리했습니다. 재작업을 지시할 수 있습니다.");
    }
    setRejectingId(null);
    setFeedback("");
    refresh();
  }

  return (
    <div>
      {/* 부사수 헤더 */}
      <div className="card" style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            background: "var(--accent-soft)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
          }}
        >
          🤖
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: 17 }}>
            {assistant?.name ?? "부사수"}{" "}
            <span className={`badge ${statusColor}`}>{assistantStatus}</span>
          </div>
          <div className="muted">
            {user.name}의 AI 부사수 · 초안만 작성하며, 승인 없이는 Notion에 기록하지 않습니다.
          </div>
        </div>
        <button className="btn small" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? "설정 닫기" : "내 부사수 설정"}
        </button>
      </div>

      {showSettings && assistant && (
        <SettingsCard assistant={assistant} onSaved={(a) => setAssistant(a)} />
      )}

      {notice && (
        <p className="muted section-gap" style={{ color: "var(--green)" }}>
          {notice}
        </p>
      )}

      <div className="grid cols-2 section-gap">
        {/* 부수 업무 맡기기 */}
        <div className="card">
          <h2>부수 업무 맡기기</h2>
          <div className="chips" style={{ marginBottom: 12 }}>
            {TASK_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                className={`chip ${taskType === t ? "on" : ""}`}
                onClick={() => setTaskType(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <textarea
            rows={4}
            placeholder={`부사수에게 맡길 ${taskType} 내용을 입력하세요.\n예: "아두이노 교육 키트 시장 동향 조사"`}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
          <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
            <button
              className="btn"
              disabled={delegating || !instruction.trim()}
              onClick={() => delegate()}
            >
              {delegating ? "부사수 작성 중..." : "위임하기"}
            </button>
          </div>

          {/* 진행 중 업무 */}
          <h2 style={{ marginTop: 20 }}>
            진행 중 업무 <CountBadge n={working.length} />
          </h2>
          {working.length === 0 && (
            <EmptyState img="empty-tasks.png">지금 처리 중인 위임 업무가 없습니다.</EmptyState>
          )}
          {working.map((d) => (
            <div className="item" key={d.id}>
              <div className="title">
                [{d.task_type}] {d.instruction.slice(0, 60)}
              </div>
              <div className="progress-track" style={{ marginTop: 8 }}>
                <div className="progress-fill" style={{ width: "60%", opacity: 0.8 }} />
              </div>
              <div className="meta" style={{ marginTop: 6 }}>
                초안 작성 중...
              </div>
            </div>
          ))}
        </div>

        {/* 실시간 활동 로그 — 내용 높이만 차지(왼쪽 카드에 늘어나지 않도록 align-self: start) */}
        <div className="card" style={{ alignSelf: "start" }}>
          <h2>실시간 활동 로그</h2>
          <div className="log">
            {activity.length === 0 && (
              <EmptyState img="empty-log.png">아직 활동이 없습니다.</EmptyState>
            )}
            {activity.map((entry) => (
              <div className="row" key={entry.id}>
                <span className="time">{fmtLogTime(entry.created_at)}</span>
                <span className={`lv-${entry.level}`}>{entry.message}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 내 초안 · 승인 대기 (내 부사수가 올린 초안) */}
      <div className="card section-gap">
        <h2>
          내 초안 · 승인 대기 <CountBadge n={pending.length} warn />
        </h2>
        <p className="muted" style={{ marginBottom: 10 }}>
          내 부사수가 올린 초안입니다. 승인해야 Notion에 기록됩니다.
        </p>
        {pending.length === 0 && (
          <EmptyState img="empty-drafts.png">
            승인 대기 중인 초안이 없습니다. 승인된 것만 Notion에 기록됩니다.
          </EmptyState>
        )}
        {pending.map((d) => (
          <div className="item" key={d.id}>
            <div className="title">
              <span className="badge red" style={{ marginRight: 8 }}>
                {d.task_type}
              </span>
              {d.title}
            </div>
            <div className="meta">
              위임 내용: {d.instruction.slice(0, 80)} ·{" "}
              {new Date(d.created_at).toLocaleString("ko-KR")}
            </div>
            {expandedId === d.id && <div className="draft-body">{d.body}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button
                className="btn small"
                onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
              >
                {expandedId === d.id ? "본문 접기" : "본문 보기"}
              </button>
              <button className="btn small primary" onClick={() => setApproving(d)}>
                승인
              </button>
              <button
                className="btn small"
                onClick={() => {
                  setRejectingId(rejectingId === d.id ? null : d.id);
                  setFeedback("");
                }}
              >
                반려·재작업
              </button>
            </div>
            {rejectingId === d.id && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  rows={2}
                  placeholder="반려 사유 / 재작업 지시사항"
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                  <button className="btn small ghost" onClick={() => setRejectingId(null)}>
                    취소
                  </button>
                  <button className="btn small primary" onClick={() => reject(d.id)}>
                    반려 확정
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 팀 초안 — lead 전용. 팀원 부사수 초안 승인/반려 (구 /control 승인 처리 흡수) */}
      {user.role === "lead" && (
        <div className="card section-gap">
          <h2>
            팀원 초안 · 승인 대기 (팀장) <CountBadge n={teamDrafts.length} warn />
          </h2>
          <p className="muted" style={{ marginBottom: 10 }}>
            팀원 부사수가 올린 초안입니다. 승인해야 Notion에 기록됩니다.
          </p>
          {teamDrafts.length === 0 && (
            <EmptyState img="empty-drafts.png">승인 대기 중인 팀원 초안이 없습니다.</EmptyState>
          )}
          {teamDrafts.map((d) => (
            <div className="item" key={d.id}>
              <div className="title">
                <span className="badge red" style={{ marginRight: 8 }}>
                  {d.task_type}
                </span>
                {d.title}
                <span className="muted" style={{ marginLeft: 8, fontWeight: 400 }}>
                  · {d.user_name ?? "팀원"} 담당
                </span>
              </div>
              <div className="meta">
                위임 내용: {d.instruction.slice(0, 80)} ·{" "}
                {new Date(d.created_at).toLocaleString("ko-KR")}
              </div>
              {expandedId === d.id && <div className="draft-body">{d.body}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  className="btn small"
                  onClick={() => setExpandedId(expandedId === d.id ? null : d.id)}
                >
                  {expandedId === d.id ? "본문 접기" : "본문 보기"}
                </button>
                <button className="btn small primary" onClick={() => setApproving(d)}>
                  승인
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    setRejectingId(rejectingId === d.id ? null : d.id);
                    setFeedback("");
                  }}
                >
                  반려·재작업
                </button>
              </div>
              {rejectingId === d.id && (
                <div style={{ marginTop: 10 }}>
                  <textarea
                    rows={2}
                    placeholder="반려 사유 / 재작업 지시사항"
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8, justifyContent: "flex-end" }}>
                    <button className="btn small ghost" onClick={() => setRejectingId(null)}>
                      취소
                    </button>
                    <button className="btn small primary" onClick={() => reject(d.id)}>
                      반려 확정
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 반려됨 → 재작업 */}
      {rejected.length > 0 && (
        <div className="card section-gap">
          <h2>
            반려됨 · 재작업 대기 <CountBadge n={rejected.length} warn />
          </h2>
          {rejected.map((d) => (
            <div className="item" key={d.id}>
              <div className="title">{d.title}</div>
              <div className="meta">반려 사유: {d.feedback || "(사유 없음)"}</div>
              <div style={{ marginTop: 8 }}>
                <button className="btn small" disabled={delegating} onClick={() => delegate(d)}>
                  재작업 지시
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 최근 승인 기록 */}
      {decided.length > 0 && (
        <div className="card section-gap">
          <h2>최근 승인 → Notion 기록</h2>
          {decided.map((d) => (
            <div className="item" key={d.id}>
              <div className="title">{d.title}</div>
              <div className="meta">
                <span className="badge green">승인됨</span>
                {d.decided_at && new Date(d.decided_at).toLocaleString("ko-KR")}
                {d.notion_page_id && (
                  <span style={{ fontFamily: "var(--mono)" }}>notion: {d.notion_page_id.slice(0, 8)}…</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {approving && (
        <ApproveModal
          draft={approving}
          onClose={() => setApproving(null)}
          onDone={(message) => {
            setApproving(null);
            setNotice(message);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function SettingsCard({
  assistant,
  onSaved,
}: {
  assistant: AssistantSettings;
  onSaved: (a: AssistantSettings) => void;
}) {
  const [name, setName] = useState(assistant.name);
  const [reportStyle, setReportStyle] = useState(assistant.report_style);
  const [workAreas, setWorkAreas] = useState<string[]>(assistant.work_areas ?? []);
  const [autoScope, setAutoScope] = useState(assistant.auto_scope);
  const [extra, setExtra] = useState(assistant.system_prompt_extra);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  function toggleArea(area: string) {
    setWorkAreas((prev) =>
      prev.includes(area) ? prev.filter((a) => a !== area) : [...prev, area]
    );
  }

  async function save() {
    setBusy(true);
    setSaved(false);
    const res = await fetch("/api/assistant/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        reportStyle,
        workAreas,
        autoScope,
        systemPromptExtra: extra,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (res.ok && data.assistant) {
      onSaved(data.assistant);
      setSaved(true);
    }
  }

  return (
    <div className="card section-gap">
      <h2>내 부사수 설정</h2>
      <div className="grid cols-2">
        <div className="field">
          <label>이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
        </div>
        <div className="field">
          <label>보고 스타일</label>
          <select
            value={reportStyle}
            onChange={(e) => setReportStyle(e.target.value as "brief" | "detailed")}
          >
            <option value="brief">요점 위주</option>
            <option value="detailed">상세</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>담당 업무 영역</label>
        <div className="chips">
          {NOTION_WORK_AREAS.map((area) => (
            <button
              key={area}
              type="button"
              className={`chip ${workAreas.includes(area) ? "on" : ""}`}
              onClick={() => toggleArea(area)}
            >
              {area}
            </button>
          ))}
        </div>
      </div>
      <div className="grid cols-2">
        <div className="field">
          <label>자동 조회 범위</label>
          <select value={autoScope} onChange={(e) => setAutoScope(e.target.value)}>
            <option value="own">내 업무만</option>
            <option value="team">팀 전체 타임라인</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>커스텀 지침 (시스템 프롬프트 추가분)</label>
        <textarea
          rows={3}
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="예: 표 형식을 선호함, 숫자에는 근거 출처를 병기할 것"
        />
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "flex-end" }}>
        {saved && <span className="muted" style={{ color: "var(--green)" }}>저장됨</span>}
        <button className="btn primary" onClick={save} disabled={busy}>
          {busy ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
