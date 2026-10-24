"use client";

// 내 정보 → Claude 연결 (0040). 키를 만들면 **한 번만** 보여 주고, 그 자리에서 Claude Code ·
// 데스크톱에 붙일 설정을 통째로 복사하게 한다 — 키만 주고 「알아서 붙이세요」는 안 붙인다.
import { useEffect, useState } from "react";
import { Button, Card } from "./parts";

interface TokenRow { id: number; name: string; prefix: string; createdAt: string; lastUsedAt: string | null }

const ts = (s: string | null) => (s ? Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z")) : NaN);
function when(s: string | null): string {
  const t = ts(s);
  if (Number.isNaN(t)) return "아직 안 씀";
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export default function ClaudeConnect() {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [name, setName] = useState("데스크톱");
  const [made, setMade] = useState<{ token: string; name: string } | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = async () => {
    const r = await fetch("/api/tokens", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setRows((await r.json()).tokens);
  };
  useEffect(() => { setOrigin(window.location.origin); load(); }, []);

  const create = async () => {
    setBusy(true); setMsg("");
    const r = await fetch("/api/tokens", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }) }).catch(() => null);
    setBusy(false);
    if (!r?.ok) { setMsg((r && (await r.json().catch(() => null))?.error) || "키를 만들지 못했습니다."); return; }
    setMade({ token: (await r.json()).token, name });
    load();
  };
  const revoke = async (t: TokenRow) => {
    if (!window.confirm(`「${t.name}」 키를 끊을까요? 그 키를 쓰는 Claude 는 바로 연결이 끊깁니다.`)) return;
    const r = await fetch(`/api/tokens/${t.id}`, { method: "DELETE" }).catch(() => null);
    setMsg(r?.ok ? `「${t.name}」 키를 끊었습니다` : "끊지 못했습니다.");
    load();
  };
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setMsg(`${what}을(를) 복사했습니다`); }
    catch { setMsg("복사하지 못했습니다 — 칸을 눌러 직접 고르세요"); }
  };

  const url = `${origin}/api/mcp`;
  const code = made ? `claude mcp add --transport http --scope user teamboard ${url} --header "Authorization: Bearer ${made.token}"` : "";
  const desktop = made ? JSON.stringify({ mcpServers: { teamboard: {
    command: "npx", args: ["-y", "mcp-remote", url, "--header", "Authorization:${TB_AUTH}"],
    env: { TB_AUTH: `Bearer ${made.token}` } } } }, null, 2) : "";

  return (
    <Card title="Claude 연결" sub="데스크톱 · Claude Code">
      <p className="v3-why">
        키를 만들어 내 Claude 에 붙이면, Claude 가 <b>내 이름으로</b> 내 기록 · 내 업무를 적고 읽고 고칩니다.
        지우기는 못 합니다. Claude 가 바꾼 업무는 활동 기록에 「(Claude)」로 남습니다.
      </p>

      {made ? (
        <div className="v3-cc-made">
          <p className="v3-cc-warn">이 키는 <b>지금 한 번만</b> 보입니다. 아래 설정을 복사해 붙이세요.</p>
          <label className="v3-cc-k">Claude Code — 터미널에 한 줄</label>
          <pre className="v3-cc-pre" onClick={() => copy(code, "Claude Code 명령")}>{code}</pre>
          <Button onClick={() => copy(code, "Claude Code 명령")}>Claude Code 명령 복사</Button>
          <label className="v3-cc-k">Claude 데스크톱 — 설정 → 개발자 → 설정 편집(claude_desktop_config.json)에 붙이고 다시 켜기</label>
          <pre className="v3-cc-pre" onClick={() => copy(desktop, "데스크톱 설정")}>{desktop}</pre>
          <Button onClick={() => copy(desktop, "데스크톱 설정")}>데스크톱 설정 복사</Button>
          <p className="v3-why">데스크톱은 컴퓨터에 Node.js 가 있어야 합니다(npx 로 연결 도구를 띄웁니다).
            이미 다른 mcpServers 가 있으면 그 안에 teamboard 칸만 더하세요.</p>
          <Button primary onClick={() => setMade(null)}>다 붙였습니다</Button>
        </div>
      ) : (
        <div className="v3-cc-new">
          <input className="v3-cc-in" value={name} maxLength={60} aria-label="키 이름"
                 placeholder="키 이름 — 예: 데스크톱, 노트북 Claude Code" onChange={(e) => setName(e.target.value)} />
          <Button primary disabled={busy || !name.trim()} onClick={() => void create()}>{busy ? "만드는 중…" : "연결 키 만들기"}</Button>
        </div>
      )}

      {rows && rows.length > 0 && (
        <ul className="v3-cc-list">
          {rows.map((t) => (
            <li key={t.id}>
              <b>{t.name}</b>
              <code>{t.prefix}…</code>
              <span>만든 때 {when(t.createdAt)} · 마지막 사용 {when(t.lastUsedAt)}</span>
              <button type="button" className="v3-cc-x" onClick={() => void revoke(t)}>끊기</button>
            </li>
          ))}
        </ul>
      )}
      {rows && rows.length === 0 && !made && <p className="v3-why">아직 연결한 Claude 가 없습니다.</p>}
      {msg && <p className="v3-why" role="status">{msg}</p>}
    </Card>
  );
}
