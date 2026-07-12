"use client";

// Notion 연동 범위 (팀장 전용). 다중 DB 선택은 2차 — UI만 배치, 비활성 (PRD 5장)
import { useEffect, useState } from "react";

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
