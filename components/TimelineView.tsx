"use client";

// 화면 B — 팀 타임라인 (공유, 읽기 중심). 기록은 승인 게이트를 통해서만.
import { useEffect, useMemo, useState } from "react";
import type { TimelineItem } from "@/lib/types";

export default function TimelineView() {
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("전체");
  const [assigneeFilter, setAssigneeFilter] = useState("전체");
  const [areaFilter, setAreaFilter] = useState("전체");

  useEffect(() => {
    fetch("/api/notion/timeline")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? "타임라인 조회 실패");
        setItems(data.items ?? []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const assignees = useMemo(
    () => Array.from(new Set(items.flatMap((i) => i.assignees.map((a) => a.name)))).sort(),
    [items]
  );
  const areas = useMemo(
    () => Array.from(new Set(items.map((i) => i.workArea).filter((a): a is string => !!a))).sort(),
    [items]
  );

  const filtered = items.filter((item) => {
    if (statusFilter !== "전체" && item.status !== statusFilter) return false;
    if (assigneeFilter !== "전체" && !item.assignees.some((a) => a.name === assigneeFilter))
      return false;
    if (areaFilter !== "전체" && item.workArea !== areaFilter) return false;
    return true;
  });

  const statusBadge = (status: string | null) =>
    status === "완료" ? "green" : status === "진행" ? "blue" : "yellow";
  const priorityBadge = (priority: string | null) =>
    priority === "High" ? "red" : priority === "Mid" ? "yellow" : "";

  return (
    <div className="card">
      <p
        style={{
          fontSize: 12.5,
          color: "var(--text-dim, #9aa)",
          background: "rgba(255,255,255,.04)",
          border: "1px solid var(--line, #23252c)",
          borderLeft: "2px solid var(--accent, #4b8df8)",
          borderRadius: 6,
          padding: "9px 12px",
          marginBottom: 14,
        }}
      >
        Notion 원본 조회용 보조 화면입니다. 팀 업무 현황은 홈과 캘린더를 이용하세요.
      </p>
      <h2>
        팀 업무 타임라인 <span className="count">{filtered.length}</span>
      </h2>
      <p className="muted" style={{ marginBottom: 14 }}>
        정본은 팀 Notion &quot;팀 업무 타임라인&quot; DB입니다. 여기서의 직접 편집은 지원하지 않으며,
        기록은 에이전트 초안 → 승인 게이트를 통해서만 추가됩니다.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 140 }}>
          <option>전체</option>
          <option>대기</option>
          <option>진행</option>
          <option>완료</option>
        </select>
        <select value={assigneeFilter} onChange={(e) => setAssigneeFilter(e.target.value)} style={{ width: 160 }}>
          <option>전체</option>
          {assignees.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)} style={{ width: 170 }}>
          <option>전체</option>
          {areas.map((area) => (
            <option key={area}>{area}</option>
          ))}
        </select>
      </div>

      {loading && <p className="muted">Notion에서 불러오는 중...</p>}
      {error && <p className="error-text">{error}</p>}

      {!loading && !error && (
        <div style={{ overflowX: "auto" }}>
          <table className="tl">
            <thead>
              <tr>
                <th>업무명</th>
                <th>담당자</th>
                <th>상태</th>
                <th>우선순위</th>
                <th>업무 구분</th>
                <th>기간</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.pageId}>
                  <td>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>
                        {item.title}
                      </a>
                    ) : (
                      <span style={{ fontWeight: 600 }}>{item.title}</span>
                    )}
                    {item.workType && (
                      <span className="badge" style={{ marginLeft: 8 }}>
                        {item.workType}
                      </span>
                    )}
                  </td>
                  <td>{item.assignees.map((a) => a.name).join(", ") || "—"}</td>
                  <td>
                    <span className={`badge ${statusBadge(item.status)}`}>{item.status ?? "—"}</span>
                  </td>
                  <td>
                    <span className={`badge ${priorityBadge(item.priority)}`}>
                      {item.priority ?? "—"}
                    </span>
                  </td>
                  <td>{item.workArea || "—"}</td>
                  <td style={{ fontFamily: "var(--mono)", fontSize: 12 }}>
                    {item.startDate ?? "?"} ~ {item.endDate ?? "?"}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    조건에 맞는 업무가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
