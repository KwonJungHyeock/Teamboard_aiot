"use client";

// 설정 — 팀 전체에 걸리는 값 셋. 팀장 · 관리자만 이 화면에 온다(`app/v3/settings/page.tsx`).
//   ① 가오픈 날짜 — 관제 · 대시보드의 D-day, 가오픈 기준 집계가 이 값을 본다
//   ② 진척 편집자 — 업무 진행률을 손으로 바꿀 수 있는 사람(비우면 담당자 · 팀장 규칙대로)
//   ③ Notion 연결 — 연결 확인 · 문서를 만들 상위 페이지 · 타임라인 범위
// 저장은 칸마다 따로 한다. 한 번에 다 저장하면 하나가 틀렸을 때 나머지도 안 들어간다.
import { useEffect, useState } from "react";
import { Button, Card } from "./parts";

interface Person { id: number; name: string }
interface Platform { open: { openAt: string }; editor: { id: number; name: string } | null; people: Person[] }
interface NotionInfo { configured: boolean; parentPageId: string | null; lastCheckedAt: string | null }
interface Scope { dataSourceId: string | null; label: string }

const seoulDay = (iso: string) => new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 10);
const seoulTime = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") : "아직 안 함");

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    .catch(() => null);
  return { ok: !!r?.ok, data: r ? await r.json().catch(() => null) : null };
}

export default function SettingsView() {
  const [p, setP] = useState<Platform | null>(null);
  const [n, setN] = useState<NotionInfo | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [openDay, setOpenDay] = useState("");
  const [editor, setEditor] = useState<string>("");
  const [parent, setParent] = useState("");
  const [ds, setDs] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState<Record<string, string>>({});
  const [test, setTest] = useState<{ ok: boolean; message: string; botName: string | null; workspaceName: string | null } | null>(null);
  const say = (k: string, v: string) => setNote((m) => ({ ...m, [k]: v }));

  const load = async () => {
    const [a, b, c] = await Promise.all([send("/api/settings/platform", "GET"), send("/api/notion/resource", "GET"), send("/api/settings/notion-scope", "GET")]);
    if (a.ok) { setP(a.data); setOpenDay(seoulDay(a.data.open.openAt)); setEditor(a.data.editor ? String(a.data.editor.id) : ""); }
    if (b.ok) { setN(b.data); setParent(b.data.parentPageId ?? ""); }
    if (c.ok) { setScope(c.data.scope); setDs(c.data.scope.dataSourceId ?? ""); setLabel(c.data.scope.label ?? ""); }
  };
  useEffect(() => { load(); }, []);

  const saveOpen = async () => {
    const r = await send("/api/settings/platform", "PUT", { openAt: `${openDay}T00:00:00+09:00` });
    say("open", r.ok ? `가오픈을 ${openDay} 로 바꿨습니다 — 관제의 D-day 가 따라 바뀝니다` : r.data?.error ?? "저장하지 못했습니다.");
    if (r.ok) load();
  };
  const saveEditor = async () => {
    const r = await send("/api/settings/platform", "PUT", { progressEditorId: editor ? Number(editor) : null });
    say("editor", r.ok ? (editor ? "진척 편집자를 정했습니다" : "진척 편집자를 비웠습니다") : r.data?.error ?? "저장하지 못했습니다.");
    if (r.ok) load();
  };
  const runTest = async () => {
    say("notion", "확인하는 중…");
    const r = await send("/api/notion/resource", "PUT");
    setTest(r.ok ? r.data : null);
    say("notion", r.ok ? "" : r.data?.error ?? "확인하지 못했습니다.");
    load();
  };
  const saveParent = async () => {
    const r = await send("/api/notion/resource", "PATCH", { parentPageId: parent });
    say("parent", r.ok ? (r.data.parentPageId ? "상위 페이지를 정했습니다" : "상위 페이지를 비웠습니다") : r.data?.error ?? "저장하지 못했습니다.");
    if (r.ok) setParent(r.data.parentPageId ?? "");
  };
  const saveScope = async () => {
    const r = await send("/api/settings/notion-scope", "PUT", { dataSourceId: ds, label });
    say("scope", r.ok ? "타임라인 범위를 바꿨습니다" : r.data?.error ?? "저장하지 못했습니다.");
  };

  if (!p) return (<><h1 className="v3-h1">설정</h1><p className="v3-lede">불러오는 중…</p></>);

  return (
    <>
      <h1 className="v3-h1">설정</h1>
      <p className="v3-lede">팀 전체에 걸리는 값입니다. 팀장 · 관리자만 봅니다. 바꾸면 활동 기록에 남습니다.</p>

      <Card title="가오픈 날짜" sub="관제 · 대시보드의 D-day">
        <div className="v3-set-row">
          <input type="date" className="v3-cc-in v3-set-date" aria-label="가오픈 날짜" value={openDay} onChange={(e) => setOpenDay(e.target.value)} />
          <Button primary disabled={!openDay || openDay === seoulDay(p.open.openAt)} onClick={() => void saveOpen()}>저장</Button>
          <span className="v3-why">지금 {seoulDay(p.open.openAt)}</span>
        </div>
        {note.open && <p className="v3-why" role="status">{note.open}</p>}
      </Card>

      <Card title="진척 편집자" sub="업무 진행률을 손으로 고칠 수 있는 사람">
        <div className="v3-set-row">
          <select className="v3-cc-in v3-set-sel" aria-label="진척 편집자" value={editor} onChange={(e) => setEditor(e.target.value)}>
            <option value="">지정 안 함</option>
            {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
          <Button primary disabled={editor === (p.editor ? String(p.editor.id) : "")} onClick={() => void saveEditor()}>저장</Button>
          <span className="v3-why">지금 {p.editor?.name ?? "지정 안 함"}</span>
        </div>
        {note.editor && <p className="v3-why" role="status">{note.editor}</p>}
      </Card>

      <Card title="Notion 연결" sub={n?.configured ? "토큰 있음" : "토큰 없음"}>
        <div className="v3-set-row">
          <Button onClick={() => void runTest()}>연결 확인</Button>
          <span className="v3-why">마지막 확인 {seoulTime(n?.lastCheckedAt ?? null)}</span>
        </div>
        {test && (
          <p className={test.ok ? "v3-pn-ok" : "v3-why"} role="status">
            {test.message}{test.ok && test.workspaceName ? ` · ${test.workspaceName}${test.botName ? ` (${test.botName})` : ""}` : ""}
          </p>
        )}
        {note.notion && <p className="v3-why" role="status">{note.notion}</p>}

        <label className="v3-cc-k" htmlFor="v3-set-parent">문서를 만들 상위 페이지</label>
        <div className="v3-set-row">
          <input id="v3-set-parent" className="v3-cc-in" value={parent} placeholder="Notion 페이지 주소나 32자리 ID — 비우면 해제"
                 onChange={(e) => setParent(e.target.value)} />
          <Button onClick={() => void saveParent()}>저장</Button>
        </div>
        {note.parent && <p className="v3-why" role="status">{note.parent}</p>}

        <label className="v3-cc-k" htmlFor="v3-set-ds">타임라인 범위(data source)</label>
        <div className="v3-set-row">
          <input id="v3-set-ds" className="v3-cc-in" value={ds} placeholder="data source id" onChange={(e) => setDs(e.target.value)} />
          <input className="v3-cc-in v3-set-label" aria-label="이름" value={label} placeholder="이름" onChange={(e) => setLabel(e.target.value)} />
          <Button disabled={!ds.trim() || (ds === (scope?.dataSourceId ?? "") && label === (scope?.label ?? ""))} onClick={() => void saveScope()}>저장</Button>
        </div>
        {note.scope && <p className="v3-why" role="status">{note.scope}</p>}
      </Card>
    </>
  );
}
