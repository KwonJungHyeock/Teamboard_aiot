"use client";

// 에이전트 — 상단 막대의 버튼 → 오른쪽 패널에서 말로 업무를 찾고 · 등록하고 · 고친다.
// 서버(/api/ed/agent)가 Claude 와 도구를 돌리고, 쓰기는 「나 · 개인 업무」로만 들어간다(lib/claude-guard.ts).
// 서버에 Claude 키가 없으면(2026-10 운영 기본) 채팅 대신 「각자 쓰는 Claude 앱에 연결해서 쓰기」 안내를 띄운다.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isEnter } from "@/lib/ed/core";
import { V3_BASE } from "@/lib/v3/routes";
import { Drawer, emitChanged } from "./ui";

interface Msg { role: "user" | "assistant"; text: string; steps?: string[]; error?: boolean }
const QUICK = ["오늘 마감인 내 업무", "기한 지난 팀 업무", "이번 주 끝낸 내 업무"];
const SAY = ["팀보드에서 내 업무 중 정리할 거 찾아줘", "이거 금요일까지 팀보드 내 업무로 추가해줘", "오늘 한 일 팀보드 업무일지에 남겨줘", "기한 지난 팀 업무 알려줘"];

/** 서버 키 없음 — Claude 데스크톱 · Claude Code 에 연결해서 쓰는 길 */
function UseClaudeApp({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState("");
  const copy = async (t: string) => { try { await navigator.clipboard.writeText(t); setCopied(t); setTimeout(() => setCopied(""), 1600); } catch { /* 복사 못 하면 직접 친다 */ } };
  return (
    <div className="db ag-guide">
      <b className="ag-gt">쓰고 있는 Claude 앱에서 바로 씁니다</b>
      <p>Claude 데스크톱이나 Claude Code에 팀보드를 한 번 연결하면, 어느 대화에서든 업무를 찾고 등록합니다. 등록은 항상 <b>내 개인 업무</b>로 들어갑니다.</p>
      <ol>
        <li><b>연결 키 만들기</b> — 내 정보 › Claude 연결</li>
        <li><b>Claude 데스크톱</b> — 설정 → 개발자 → 구성 편집에 붙여 넣고, 파일 → 종료 후 다시 켜기</li>
        <li><b>Claude Code</b> — 명령을 복사해 터미널에서 한 번 실행</li>
      </ol>
      <Link href={`${V3_BASE}/me#claude`} className="ed-btn pri" onClick={onClose}>연결 키 만들기</Link>
      <div className="ed-label">이렇게 말해 보세요 · 눌러서 복사</div>
      <div className="ag-say">{SAY.map((t) => (
        <button key={t} type="button" className="ed-chip" onClick={() => void copy(t)}>{copied === t ? "복사됨 ✓" : t}</button>
      ))}</div>
    </div>
  );
}

export default function Agent() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<boolean | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs]);
  useEffect(() => { if (open && ready) setTimeout(() => input.current?.focus(), 50); }, [open, ready]);
  useEffect(() => {
    if (!open || ready !== null) return;
    void fetch("/api/ed/agent", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setReady(!!d?.ready)).catch(() => setReady(false));
  }, [open, ready]);

  const send = async (q: string) => {
    const said = q.trim();
    if (!said || busy) return;
    const history: Msg[] = [...msgs, { role: "user", text: said }];
    setMsgs([...history, { role: "assistant", text: "", steps: [] }]);
    setText(""); setBusy(true);
    let wrote = false;
    const patch = (fn: (m: Msg) => Msg) => setMsgs((xs) => [...xs.slice(0, -1), fn(xs[xs.length - 1])]);
    try {
      const r = await fetch("/api/ed/agent", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turns: history.filter((m) => !m.error && m.text).map((m) => ({ role: m.role, text: m.text })) }) });
      if (!r.ok || !r.body) {
        const d = await r.json().catch(() => ({}));
        patch((m) => ({ ...m, text: d.error ?? "요청하지 못했습니다", error: true }));
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1);
          if (!line.trim()) continue;
          const ev = JSON.parse(line) as { t: string; d?: string; name?: string; label?: string };
          if (ev.t === "tool") {
            if (["create_task", "update_task", "add_worklog", "update_worklog", "set_today"].includes(ev.name ?? "")) wrote = true;
            patch((m) => ({ ...m, steps: [...(m.steps ?? []), ev.label ?? ""] }));
          } else if (ev.t === "text") patch((m) => ({ ...m, text: `${m.text}${ev.d ?? ""}` }));
          else if (ev.t === "error") patch((m) => ({ ...m, text: ev.d ?? "오류", error: true }));
        }
      }
    } catch {
      patch((m) => ({ ...m, text: "연결이 끊겼습니다", error: true }));
    } finally {
      setBusy(false);
      if (wrote) emitChanged();
    }
  };

  return (
    <>
      <button type="button" className={`ed-pill ag-pill${open ? " on" : ""}`} onClick={() => setOpen(true)} aria-label="에이전트">
        <i aria-hidden="true">✦</i>에이전트
      </button>
      {open && (
        <Drawer onClose={() => setOpen(false)} width={440} label="에이전트">
          <div className="dh" style={{ alignItems: "center" }}>
            <div className="ag-h"><i aria-hidden="true">✦</i>에이전트</div>
            {msgs.length > 0 && <button type="button" className="ed-btn sm gh" onClick={() => setMsgs([])} disabled={busy}>새 대화</button>}
            <button type="button" className="ed-x" onClick={() => setOpen(false)} aria-label="닫기">✕</button>
          </div>
          {ready === false ? <UseClaudeApp onClose={() => setOpen(false)} /> : ready === null ? <div className="db" /> : (<>
          <div className="db ag-list" ref={list}>
            {msgs.length === 0 ? (
              <div className="ag-quick">{QUICK.map((q) => <button key={q} type="button" className="ed-chip" onClick={() => void send(q)}>{q}</button>)}</div>
            ) : msgs.map((m, i) => (
              <div key={i} className={`ag-msg ${m.role}${m.error ? " err" : ""}`}>
                {m.steps && m.steps.length > 0 && <div className="ag-steps">{m.steps.map((s, j) => <span key={j}>{s}</span>)}</div>}
                {m.text ? <div className="ag-b">{m.text}</div> : busy && i === msgs.length - 1 ? <div className="ag-b ag-dots"><i /><i /><i /></div> : null}
              </div>
            ))}
          </div>
          <div className="df ag-in">
            <textarea ref={input} rows={1} value={text} placeholder="업무 찾기 · 등록 · 고치기" onChange={(e) => setText(e.target.value)}
                      onKeyDown={(e) => { if (isEnter(e) && !e.shiftKey) { e.preventDefault(); void send(text); } }} />
            <button type="button" className={`ed-btn pri${text.trim() && !busy ? "" : " off"}`} disabled={!text.trim() || busy} onClick={() => void send(text)}>보내기</button>
          </div>
          </>)}
        </Drawer>
      )}
    </>
  );
}
