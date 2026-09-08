"use client";

// 플랫폼 설정 — 가오픈 시각 · 진척 편집자 (MD-P-2026-033). 팀장 전용.
//
// ── 왜 화면에 두는가 ─────────────────────────────────────────────
//
// 가오픈일은 **이미 한 번 밀렸다**(10.01 → 11.02). 코드 상수로 두면 다음에 또
// 밀릴 때 배포가 필요하고, 급해서 못 미룰 때가 정확히 배포하기 싫은 때다.
//
// 진척 편집자도 같다. 지시는 「한 사람만」이고 그 규칙은 코드에 있다.
// **누구인지는 데이터다** — 사람이 바뀔 때 배포하지 않는다.
import { useEffect, useState } from "react";

interface Editor { id: number; name: string; isActive: boolean }
interface Payload {
  open: { openAt: string; source: "config" | "default" };
  editor: Editor | null;
  people: { id: number; name: string }[];
}

/** `datetime-local` 이 먹는 모양(`YYYY-MM-DDTHH:mm`)으로 — **KST 기준**. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d).reduce<Record<string, string>>((a, x) => (a[x.type] = x.value, a), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

export default function PlatformSettings() {
  const [d, setD] = useState<Payload | null>(null);
  const [at, setAt] = useState("");
  const [editorId, setEditorId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = async () => {
    const res = await fetch("/api/settings/platform");
    if (!res.ok) { setErr("설정을 불러오지 못했습니다."); return; }
    const data: Payload = await res.json();
    setD(data);
    setAt(toLocalInput(data.open.openAt));
    setEditorId(data.editor ? String(data.editor.id) : "");
  };
  useEffect(() => { void load(); }, []);

  async function save(body: Record<string, unknown>) {
    setBusy(true); setErr(""); setMsg("");
    const res = await fetch("/api/settings/platform", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!res.ok) { setErr((await res.json()).error ?? "저장하지 못했습니다."); return; }
    setMsg("저장했습니다.");
    await load();
  }

  if (!d) return <section className="tile"><p className="prop-none">불러오는 중…</p></section>;

  return (
    <section className="tile ps" aria-label="플랫폼 설정">
      <h2 className="tile-t">플랫폼</h2>

      <div className="ps-row">
        <label className="ps-l" htmlFor="ps-open">가오픈</label>
        <div className="ps-v">
          <input id="ps-open" type="datetime-local" value={at}
            onChange={(e) => setAt(e.target.value)} />
          <button className="btn-ghost" disabled={busy || !at}
            onClick={() => save({ openAt: `${at}:00+09:00` })}>저장</button>
          {/* 기본값으로 그리는 중이라는 것을 **말한다.** 안 적으면 팀장은 자기가
              지정한 값인 줄 안다. */}
          {d.open.source === "default" && (
            <span className="ps-note">아직 지정 안 됨 — 자료 기준값(2026-11-02)으로 보이는 중</span>
          )}
        </div>
      </div>
      <p className="ps-help">대문 카운트다운이 이 시각을 셉니다. KST 기준입니다.</p>

      <div className="ps-row">
        <label className="ps-l" htmlFor="ps-editor">진척 편집</label>
        <div className="ps-v">
          <select id="ps-editor" value={editorId} onChange={(e) => setEditorId(e.target.value)}>
            <option value="">지정 안 함 (아무도 못 바꿈)</option>
            {d.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn-ghost" disabled={busy}
            onClick={() => save({ progressEditorId: editorId === "" ? null : Number(editorId) })}>
            저장
          </button>
          {/* 지정된 사람이 비활성이면 **아무도 못 바꾸는데 아무도 모른다.** 그 자리를 짚는다. */}
          {d.editor && !d.editor.isActive && (
            <span className="ps-warn">
              {d.editor.name} 은(는) 지금 쓸 수 없는 계정입니다 — 진척을 아무도 바꿀 수 없습니다
            </span>
          )}
        </div>
      </div>
      <p className="ps-help">
        업무 진척을 손으로 바꿀 수 있는 사람 <b>한 명</b>입니다. 팀장 역할과 무관합니다 —
        관리자가 여럿이어도 진척은 여기 지정된 한 명만 바꿉니다.
        하위 업무가 있는 업무는 하위 완료 개수로 계산되므로 누구도 손으로 바꾸지 못합니다.
      </p>

      {msg && <p className="ps-ok">{msg}</p>}
      {err && <p className="ps-warn">{err}</p>}
    </section>
  );
}
