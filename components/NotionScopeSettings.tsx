"use client";

// Notion 연동 범위 (팀장 전용). 다중 DB 선택은 2차 — UI만 배치, 비활성 (PRD 5장)
import { useEffect, useState } from "react";

interface DriftItem {
  property: string;
  added: string[];
  removed: string[];
}

/** Notion 스키마 캐시 상태 + 새로고침 (Phase 9 구조 개선) */
function NotionSchemaCard() {
  const [source, setSource] = useState<string>("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [drift, setDrift] = useState<DriftItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  function apply(d: { source?: string; updatedAt?: string | null; drift?: DriftItem[] }) {
    setSource(d.source ?? "");
    setUpdatedAt(d.updatedAt ?? null);
    setDrift(d.drift ?? []);
    setLoaded(true);
  }

  useEffect(() => {
    fetch("/api/notion/schema").then((r) => r.json()).then(apply).catch(() => setLoaded(true));
  }, []);

  async function refresh() {
    setBusy(true);
    const res = await fetch("/api/settings/notion-schema-refresh", { method: "POST" });
    const data = await res.json();
    setBusy(false);
    if (res.ok) apply(data);
  }

  const sourceLabel: Record<string, string> = {
    notion: "Notion 실시간",
    cache: "캐시",
    fallback: "코드 폴백",
  };

  return (
    <div className="card">
      <h2>Notion 속성 스키마</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        승인 시 드롭다운 선택지는 Notion에서 조회해 24시간 캐시합니다. 팀장이 Notion 속성값을
        바꾸면 여기서 새로고침하세요. 조회 실패 시 캐시·코드 폴백으로 안전하게 동작합니다.
      </p>
      {loaded && (
        <p className="muted" style={{ fontSize: 12.5 }}>
          현재 출처: <strong>{sourceLabel[source] ?? source ?? "-"}</strong>
          {updatedAt ? ` · 갱신 ${new Date(updatedAt).toLocaleString("ko-KR")}` : ""}
        </p>
      )}
      {drift.length > 0 && (
        <div
          style={{
            marginTop: 10,
            padding: "9px 12px",
            background: "rgba(245,165,36,.12)",
            border: "1px solid rgba(245,165,36,.3)",
            borderRadius: 8,
            fontSize: 12.5,
            color: "#F5A524",
          }}
        >
          <strong>Notion 속성이 코드 기본값과 다릅니다:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
            {drift.map((d) => (
              <li key={d.property}>
                {d.property}
                {d.added.length ? ` · 추가됨: ${d.added.join(", ")}` : ""}
                {d.removed.length ? ` · 없어짐: ${d.removed.join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
        <button className="btn" onClick={refresh} disabled={busy}>
          {busy ? "새로고침 중..." : "Notion 스키마 새로고침"}
        </button>
      </div>
    </div>
  );
}

export default function NotionScopeSettings() {
  const [dataSourceId, setDataSourceId] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/settings/notion-scope")
      .then((r) => r.json())
      .then((data) => {
        if (data.scope) {
          setDataSourceId(data.scope.dataSourceId ?? "");
          setLabel(data.scope.label ?? "");
        }
      });
  }, []);

  async function save() {
    setBusy(true);
    setMessage("");
    setError("");
    const res = await fetch("/api/settings/notion-scope", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataSourceId, label }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(data.error ?? "저장 실패");
    } else {
      setMessage("연동 범위를 저장했습니다.");
    }
  }

  return (
    <div className="grid cols-2">
      <NotionSchemaCard />
      <div className="card">
        <h2>Notion 연동 범위 (팀장 전용)</h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          팀보드는 이 data source 하나만 읽고 씁니다. 통합 토큰 자체도 이 DB에만 연결하세요
          (바깥 울타리는 Notion 관리자 설정).
        </p>
        <div className="field">
          <label>연동 DB 이름</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <div className="field">
          <label>data_source_id</label>
          <input
            value={dataSourceId}
            onChange={(e) => setDataSourceId(e.target.value)}
            style={{ fontFamily: "var(--mono)", fontSize: 13 }}
          />
        </div>
        {error && <p className="error-text">{error}</p>}
        {message && (
          <p className="muted" style={{ color: "var(--green)" }}>
            {message}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="card" style={{ opacity: 0.55 }}>
        <h2>
          다중 DB 선택 <span className="badge">2차 예정</span>
        </h2>
        <p className="muted" style={{ marginBottom: 14 }}>
          여러 Notion DB를 동시에 연동하는 기능은 2차 범위입니다.
        </p>
        <div className="field">
          <label>추가 DB</label>
          <select disabled>
            <option>준비 중</option>
          </select>
        </div>
        <button className="btn" disabled>
          DB 추가
        </button>
      </div>
    </div>
  );
}
