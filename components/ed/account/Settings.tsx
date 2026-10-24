"use client";

// 설정(팀장 · 관리자) — 가오픈 날짜 · 진척 편집자 · Notion 연결. 칸마다 따로 저장한다.
// 기능은 옛 화면 그대로(/api/settings/platform · /api/notion/resource · /api/settings/notion-scope).
import { useEffect, useState } from "react";

interface Person { id: number; name: string }
interface Platform { open: { openAt: string }; editor: { id: number; name: string } | null; people: Person[] }
interface NotionInfo { configured: boolean; parentPageId: string | null; lastCheckedAt: string | null }
interface Scope { dataSourceId: string | null; label: string }

const seoulDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
const seoulTime = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ").replace("-", ".") : "—");

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
  return { ok: !!r?.ok, data: r ? await r.json().catch(() => null) : null };
}

export default function Settings() {
  const [p, setP] = useState<Platform | null>(null);
  const [n, setN] = useState<NotionInfo | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [openDay, setOpenDay] = useState("");
  const [editor, setEditor] = useState("");
  const [parent, setParent] = useState("");
  const [ds, setDs] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<Record<string, { ok: boolean; t: string }>>({});
  const [test, setTest] = useState<{ ok: boolean; message: string; botName: string | null; workspaceName: string | null } | null>(null);
  const say = (k: string, ok: boolean, t: string) => setNote((m) => ({ ...m, [k]: { ok, t } }));

  const load = async () => {
    const [a, b, c] = await Promise.all([send("/api/settings/platform", "GET"), send("/api/notion/resource", "GET"), send("/api/settings/notion-scope", "GET")]);
    if (a.ok) { setP(a.data); setOpenDay(seoulDay(a.data.open.openAt)); setEditor(a.data.editor ? String(a.data.editor.id) : ""); }
    if (b.ok) { setN(b.data); setParent(b.data.parentPageId ?? ""); }
    if (c.ok) { setScope(c.data.scope); setDs(c.data.scope.dataSourceId ?? ""); setLabel(c.data.scope.label ?? ""); }
  };
  useEffect(() => { void load(); }, []);

  const saveOpen = async () => {
    const r = await send("/api/settings/platform", "PUT", { openAt: `${openDay}T00:00:00+09:00` });
    say("open", r.ok, r.ok ? "저장됨 ✓" : r.data?.error ?? "저장하지 못했습니다"); if (r.ok) void load();
  };
  const saveEditor = async () => {
    const r = await send("/api/settings/platform", "PUT", { progressEditorId: editor ? Number(editor) : null });
    say("editor", r.ok, r.ok ? "저장됨 ✓" : r.data?.error ?? "저장하지 못했습니다"); if (r.ok) void load();
  };
  const runTest = async () => {
    const r = await send("/api/notion/resource", "PUT");
    setTest(r.ok ? r.data : null);
    if (!r.ok) say("notion", false, r.data?.error ?? "확인하지 못했습니다");
    void load();
  };
  const saveParent = async () => {
    const r = await send("/api/notion/resource", "PATCH", { parentPageId: parent });
    say("parent", r.ok, r.ok ? "저장됨 ✓" : r.data?.error ?? "저장하지 못했습니다");
    if (r.ok) setParent(r.data.parentPageId ?? "");
  };
  const saveScope = async () => {
    const r = await send("/api/settings/notion-scope", "PUT", { dataSourceId: ds, label });
    say("scope", r.ok, r.ok ? "저장됨 ✓" : r.data?.error ?? "저장하지 못했습니다");
  };
  const Note = ({ k }: { k: string }) => note[k] ? <div className={note[k].ok ? "ed-ok" : "ed-err"} role="status">{note[k].t}</div> : null;

  return (
    <div className="ed-page">
      <div className="ed-head"><h1 className="ed-h1">설정</h1></div>
      {!p ? <div className="ed-empty">불러오는 중</div> : (
        <>
          <section className="ed-sec q">
            <h2>가오픈 날짜</h2>
            <div className="me-pw">
              <input type="date" className="ed-input" aria-label="가오픈 날짜" value={openDay} onChange={(e) => setOpenDay(e.target.value)} />
              <button type="button" className="ed-btn pri" disabled={!openDay || openDay === seoulDay(p.open.openAt)} onClick={() => void saveOpen()}>저장</button>
            </div>
            <Note k="open" />
          </section>
          <section className="ed-sec q q1">
            <h2>진척 편집자</h2>
            <div className="me-pw">
              <select className="ed-input" aria-label="진척 편집자" value={editor} onChange={(e) => setEditor(e.target.value)}>
                <option value="">지정 안 함</option>
                {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
              <button type="button" className="ed-btn pri" disabled={editor === (p.editor ? String(p.editor.id) : "")} onClick={() => void saveEditor()}>저장</button>
            </div>
            <Note k="editor" />
          </section>
          <section className="ed-sec q q2">
            <h2>Notion</h2>
            <div className="ed-row"><span className="k">토큰</span>{n?.configured ? <span className="ed-ok">있음</span> : <span className="me-faint">없음</span>}
              <span className="ed-sp" /><span className="me-faint">확인 {seoulTime(n?.lastCheckedAt ?? null)}</span>
              <button type="button" className="ed-btn sm" onClick={() => void runTest()}>연결 확인</button></div>
            {test && <div className={test.ok ? "ed-ok" : "ed-err"} role="status">{test.message}{test.ok && test.workspaceName ? ` · ${test.workspaceName}` : ""}</div>}
            <Note k="notion" />
            <div className="ed-label">상위 페이지</div>
            <div className="me-pw">
              <input className="ed-input" value={parent} placeholder="페이지 주소 또는 ID" onChange={(e) => setParent(e.target.value)} />
              <button type="button" className="ed-btn" onClick={() => void saveParent()}>저장</button>
            </div>
            <Note k="parent" />
            <div className="ed-label">타임라인 범위</div>
            <div className="me-pw">
              <input className="ed-input" value={ds} placeholder="data source id" onChange={(e) => setDs(e.target.value)} />
              <input className="ed-input" aria-label="이름" value={label} placeholder="이름" onChange={(e) => setLabel(e.target.value)} />
              <button type="button" className="ed-btn" disabled={!ds.trim() || (ds === (scope?.dataSourceId ?? "") && label === (scope?.label ?? ""))} onClick={() => void saveScope()}>저장</button>
            </div>
            <Note k="scope" />
          </section>
        </>
      )}
    </div>
  );
}
