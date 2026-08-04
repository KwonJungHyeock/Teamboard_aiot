"use client";

// Notion 연결 상태 (MD-P-2026-012 §B) — 관리 화면 카드.
// 토큰 값 자체는 서버에서만 쓰이고 여기로 내려오지 않는다. 연결 여부·봇 이름만 확인한다.
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/lib/quick";

interface Status {
  configured: boolean;
  ok?: boolean;
  botName?: string | null;
  workspaceName?: string | null;
  message?: string;
  parentPageId: string | null;
  lastCheckedAt?: string | null;
  checkedAt?: string;
}

function fmt(iso: string | null | undefined): string {
  if (!iso) return "확인 이력 없음";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "확인 이력 없음";
  return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });
}

export default function NotionConnection() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [parent, setParent] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/notion/resource").catch(() => null);
    if (res && res.ok) {
      const d = await res.json();
      setSt(d);
      setParent(d.parentPageId ?? "");
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test() {
    setBusy(true);
    const res = await fetch("/api/notion/resource", { method: "PUT" }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { toast(d?.error ?? "확인에 실패했어요", "err"); return; }
    setSt((cur) => ({ ...(cur ?? { configured: false, parentPageId: null }), ...d, lastCheckedAt: d.checkedAt }));
    toast(d.ok ? `연결됨 — ${d.workspaceName ?? d.botName ?? "Notion"}` : d.message, d.ok ? "ok" : "err");
  }

  async function saveParent() {
    setBusy(true);
    const res = await fetch("/api/notion/resource", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentPageId: parent }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { toast(d?.error ?? "저장에 실패했어요", "err"); return; }
    setSt((cur) => (cur ? { ...cur, parentPageId: d.parentPageId } : cur));
    toast(d.parentPageId ? "상위 페이지를 지정했어요" : "상위 페이지 지정을 해제했어요");
  }

  if (!st) return <section className="card"><p className="gempty">불러오는 중...</p></section>;

  const connected = st.configured && st.ok !== false;

  return (
    <section className="card ncon">
      <div className="ncon-h">
        <span className={`ncon-led ${st.configured ? (st.ok === false ? "bad" : "ok") : "off"}`} aria-hidden="true" />
        <b>Notion 연동</b>
        <span className={`ncon-st ${connected ? "on" : "off"}`}>
          {!st.configured ? "미연결" : st.ok === false ? "확인 실패" : "연결됨"}
        </span>
        <span className="gsp" style={{ flex: 1 }} />
        <span className="ncon-when num">마지막 확인 {fmt(st.checkedAt ?? st.lastCheckedAt)}</span>
        <button className="btn small" onClick={test} disabled={busy}>연결 테스트</button>
      </div>

      {st.configured && st.ok && (st.botName || st.workspaceName) && (
        <p className="ncon-info">
          연동 <b>{st.botName ?? "이름 없음"}</b>
          {st.workspaceName ? ` · 워크스페이스 ${st.workspaceName}` : ""}
        </p>
      )}

      {!st.configured && (
        <div className="ncon-guide">
          <p><b>연구소 Notion 계정에서 Integration을 생성하고, 공유할 페이지에 초대한 뒤 토큰을 등록하세요.</b></p>
          <ol>
            <li>Notion → 설정 → 연결 → <b>Integration 생성</b> (Internal)</li>
            <li>발급된 <b>Internal Integration Secret</b>을 서버 환경변수 <code>NOTION_TOKEN</code>에 등록</li>
            <li>연동할 상위 페이지에서 <b>⋯ → 연결 → 방금 만든 Integration 초대</b></li>
            <li>아래에 그 상위 페이지 URL을 넣고 저장</li>
          </ol>
          <p className="ncon-warn">토큰은 서버에만 둡니다. 클라이언트로 내려보내지 않습니다.</p>
        </div>
      )}
      {st.configured && st.ok === false && <p className="ncon-err">{st.message}</p>}

      <div className="ncon-parent">
        <label>
          <span>문서 생성 상위 페이지</span>
          <input value={parent} placeholder="https://www.notion.so/... 또는 32자리 ID"
            onChange={(e) => setParent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveParent(); }} />
        </label>
        <button className="btn small" onClick={saveParent} disabled={busy}>저장</button>
      </div>
      <p className="ncon-note">
        [Notion 문서 만들기]는 이 페이지 아래에 문서를 만듭니다. 지정 전에는 버튼이 비활성입니다.
        해당 페이지에 Integration이 초대돼 있어야 합니다.
      </p>
      <p className="rlk-boundary">
        상태·일정·우선순위는 <b>Mission Deck</b>에서 관리합니다. Notion은 리소스와 상세 기록용입니다.
      </p>
    </section>
  );
}
