"use client";

// 연결된 리소스 (MD-P-2026-012 §C·E·F) — Notion·Figma·GitHub를 한 자리에.
//
// 이 섹션의 역할은 "링크를 붙여두는 곳"이지 상태를 두는 곳이 아니다.
// 그래서 하단에 경계 문구를 상시 노출한다(§F) — 진실의 원천이 둘로 갈리는 걸 UI가 먼저 막는다.
import { useCallback, useEffect, useState } from "react";
import HoverActions from "./HoverActions";
import { toast } from "@/lib/quick";

type EntityType = "task" | "project" | "goal" | "decision";
type Provider = "notion" | "figma" | "github" | "other";

interface Link {
  id: number;
  provider: Provider;
  url: string;
  title: string | null;
  iconUrl: string | null;
  meta: Record<string, unknown>;
  lastSyncedAt: string | null;
  createdByName: string | null;
  error?: string | null;
}

const PROVIDER: Record<Provider, { label: string; tone: string; mark: string }> = {
  notion: { label: "Notion", tone: "--ink", mark: "N" },
  figma: { label: "Figma", tone: "--purple", mark: "F" },
  github: { label: "GitHub", tone: "--slate", mark: "G" },
  other: { label: "링크", tone: "--slate", mark: "↗" },
};

/** Notion의 last_edited_time → 화면 표기 (mono) */
function editedLabel(meta: Record<string, unknown>): string | null {
  const t = meta?.lastEditedTime;
  if (typeof t !== "string") return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" })
    .replace(/\.$/, "");
}

export default function ResourceLinks({
  entityType, entityId, canCreateDoc = false, onChanged,
}: {
  entityType: EntityType;
  entityId: number;
  /** 업무·프로젝트만 Notion 문서 생성 가능 (§D) */
  canCreateDoc?: boolean;
  onChanged?: () => void;
}) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [notion, setNotion] = useState<{ configured: boolean; parentPageId: string | null }>({
    configured: false, parentPageId: null,
  });

  const load = useCallback(async () => {
    // 외부 API 실패가 렌더를 막지 않게 — 실패해도 저장된 링크는 그대로 보인다
    const res = await fetch(`/api/links?entityType=${entityType}&entityId=${entityId}`).catch(() => null);
    if (res && res.ok) setLinks((await res.json()).links ?? []);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/notion/resource").then((r) => r.json())
      .then((d) => setNotion({ configured: !!d.configured, parentPageId: d.parentPageId ?? null }))
      .catch(() => {});
  }, []);

  async function add() {
    const v = url.trim();
    if (!v || busy) return;
    setBusy(true);
    const res = await fetch("/api/links", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId, url: v }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { toast(d?.error ?? "연결에 실패했어요", "err"); return; }
    setUrl("");
    setAdding(false);
    await load();
    onChanged?.();
    toast(d.link?.error ? "연결했어요 — 메타는 불러오지 못했습니다" : "리소스를 연결했어요");
  }

  async function unlink(id: number) {
    const res = await fetch(`/api/links?id=${id}&entityType=${entityType}&entityId=${entityId}`, {
      method: "DELETE",
    }).catch(() => null);
    if (!res || !res.ok) { toast("해제에 실패했어요", "err"); return; }
    await load();
    onChanged?.();
    toast("연결을 끊었어요 — 원본 문서는 그대로입니다");
  }

  async function createDoc() {
    if (busy) return;
    setBusy(true);
    const res = await fetch("/api/notion/resource", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, entityId }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res || !res.ok) { toast(d?.error ?? "문서를 만들지 못했어요", "err"); return; }
    await load();
    onChanged?.();
    toast("Notion 문서를 만들고 연결했어요");
  }

  const docDisabled = !notion.configured || !notion.parentPageId;

  return (
    <div className="rlk">
      <div className="tdp-sec-h">
        연결된 리소스 <em>({links.length})</em>
        <span className="gsp" style={{ flex: 1 }} />
        {canCreateDoc && (
          <button className="lk" onClick={createDoc} disabled={busy || docDisabled}
            title={docDisabled
              ? (notion.configured ? "설정에서 상위 페이지를 먼저 지정하세요" : "설정에서 Notion을 먼저 연결하세요")
              : "Notion에 문서를 만들고 이 항목에 연결합니다"}>
            Notion 문서 만들기
          </button>
        )}
        <button className="lk" onClick={() => setAdding((v) => !v)}>＋ 링크</button>
      </div>

      {adding && (
        <div className="rlk-add">
          <input value={url} autoFocus placeholder="Notion·Figma·GitHub URL 붙여넣기"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); if (e.key === "Escape") setAdding(false); }} />
          <button className="btn small primary" onClick={add} disabled={busy || !url.trim()}>연결</button>
        </div>
      )}

      {loading ? (
        <p className="tdp-muted">불러오는 중…</p>
      ) : links.length === 0 ? (
        <p className="tdp-muted">
          연결된 리소스가 없습니다. Notion 문서·Figma 파일 URL을 붙여넣어 연결하세요.
        </p>
      ) : (
        links.map((l) => {
          const p = PROVIDER[l.provider] ?? PROVIDER.other;
          const edited = editedLabel(l.meta);
          const emoji = l.iconUrl?.startsWith("emoji:") ? l.iconUrl.slice(6) : null;
          return (
            <div className="rlk-row ha-host" key={l.id}>
              <a className="rlk-a" href={l.url} target="_blank" rel="noreferrer">
                <span className="rlk-ic" style={{ color: `var(${p.tone})` }}>
                  {emoji ?? p.mark}
                </span>
                <span className="rlk-b">
                  <span className="rlk-t">{l.title ?? l.url}</span>
                  <span className="rlk-m">
                    <span className="rlk-p">{p.label}</span>
                    {edited && <span className="num">최종 수정 {edited}</span>}
                    {l.error && <span className="rlk-err">{l.error}</span>}
                  </span>
                </span>
              </a>
              <HoverActions more={[{
                label: "연결 해제", danger: true, onClick: () => unlink(l.id),
              }]} />
            </div>
          );
        })
      )}

      {/* §F — 경계 안내. 상시 노출한다. */}
      <p className="rlk-boundary">
        상태·일정·우선순위는 <b>Mission Deck</b>에서 관리합니다. Notion은 리소스와 상세 기록용입니다.
      </p>
      {links.length > 0 && (
        <p className="rlk-note">연결 해제는 링크만 끊습니다 — 원본 문서는 삭제되지 않습니다.</p>
      )}
    </div>
  );
}
