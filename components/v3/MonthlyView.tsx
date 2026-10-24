"use client";

// 월간 보고(개인 · 0042). 내 기록 · 끝낸 업무로 AI 가 초안 → 고치고 → 팀장에게 낸다.
//
//   · 쓰는 중에는 나만 본다. 낸 뒤에는 팀장 · 관리자도 본다. 되돌리면 다시 나만
//   · 낸 보고는 못 고친다 — 고치려면 되돌린다(팀장이 읽던 것이 몰래 바뀌지 않게)
//   · 팀장 탭: 그 달에 낸 보고 · 확인 · 한 줄 코멘트(쓴 사람 알림함에 간다)
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card } from "./parts";

interface Report {
  id: number; actorId: number; name: string; month: string; body: string; status: "draft" | "submitted";
  aiAt: string | null; submittedAt: string | null; leadReadAt: string | null; leadReadBy: string | null;
  leadComment: string | null; updatedAt: string;
}

function shift(m: string, d: number): string {
  const t = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + d, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
const seoul = (s: string | null) => {
  const t = s ? Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z")) : NaN;
  return Number.isNaN(t) ? "" : new Date(t + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
};

/** 마크다운 조금(# · ## · ### · -)만 그린다 */
function Md({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (k: number) => { if (list.length) { out.push(<ul key={`u${k}`}>{list.map((l, i) => <li key={i}>{l}</li>)}</ul>); list = []; } };
  text.split("\n").forEach((raw, k) => {
    const l = raw.trim();
    if (!l) { flush(k); return; }
    const h = /^(#{1,3})\s+(.*)$/.exec(l);
    if (h) { flush(k); out.push(h[1].length === 1 ? <h2 key={k}>{h[2]}</h2> : h[1].length === 2 ? <h3 key={k}>{h[2]}</h3> : <h4 key={k}>{h[2]}</h4>); }
    else if (/^[-*·]\s/.test(l)) list.push(l.replace(/^[-*·]\s+/, "").replace(/\*\*/g, ""));
    else { flush(k); out.push(<p key={k}>{l.replace(/\*\*/g, "")}</p>); }
  });
  flush(99999);
  return <div className="v3-mr-md">{out}</div>;
}

export default function MonthlyView({ me, lead, month, tab, today }: {
  me: { id: number; name: string }; lead: boolean; month: string; tab: "mine" | "team"; today: string;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<Report | null>(null);
  const [team, setTeam] = useState<Report[] | null>(null);
  const [body, setBody] = useState("");
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [comments, setComments] = useState<Record<number, string>>({});

  const go = (m: string, t = tab) => router.push(`/v3/report?m=${m}${t === "team" ? "&tab=team" : ""}`);
  const load = useCallback(async () => {
    const r = await fetch(`/api/monthly?m=${month}`, { cache: "no-store" }).catch(() => null);
    if (!r?.ok) { setNote("불러오지 못했습니다."); return; }
    const d = await r.json();
    setMine(d.mine); setBody(d.mine?.body ?? ""); setDirty(false); setTeam(d.team);
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const call = async (method: string, payload: unknown, what: string): Promise<Report | null> => {
    setBusy(what); setNote("");
    const r = await fetch("/api/monthly", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }).catch(() => null);
    setBusy("");
    const d = r ? await r.json().catch(() => null) : null;
    if (!r?.ok) { setNote(d?.error ?? "하지 못했습니다."); return null; }
    setMine(d.mine); setBody(d.mine.body); setDirty(false);
    return d.mine;
  };
  const save = () => call("PUT", { month, body }, "save").then((m) => m && setNote("저장했습니다"));
  const ai = async () => {
    if (body.trim() && !window.confirm("지금 쓴 글을 AI 초안으로 바꿀까요? 지금 글은 사라집니다.")) return;
    const m = await call("POST", { month, action: "ai" }, "ai");
    if (m) setNote("초안을 만들었습니다 — 읽고 고친 뒤 내세요");
  };
  const submit = async () => {
    if (dirty && !(await call("PUT", { month, body }, "save"))) return;
    if (!window.confirm("팀장에게 낼까요? 낸 뒤에는 되돌리기 전까지 고칠 수 없습니다.")) return;
    const m = await call("POST", { month, action: "submit" }, "submit");
    if (m) setNote("팀장에게 냈습니다");
  };
  const back = async () => { const m = await call("POST", { month, action: "withdraw" }, "withdraw"); if (m) setNote("되돌렸습니다 — 다시 고칠 수 있습니다"); };
  const review = async (r: Report) => {
    const res = await fetch(`/api/monthly/${r.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment: comments[r.id] ?? r.leadComment ?? "" }) }).catch(() => null);
    if (res?.ok) { setNote(`${r.name} 보고를 확인했습니다`); load(); } else setNote("확인하지 못했습니다.");
  };

  const sent = mine?.status === "submitted";
  return (
    <div className="v3-log v3-mr">
      <h1 className="v3-h1">월간 보고</h1>
      <p className="v3-lede">내 기록 · 끝낸 업무로 한 달을 정리해 팀장에게 냅니다. 내기 전까지는 나만 봅니다.</p>

      <div className="v3-mr-bar">
        <Button onClick={() => go(shift(month, -1))}>◂ 지난달</Button>
        <b>{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</b>
        {month !== today.slice(0, 7) && <Button onClick={() => go(today.slice(0, 7))}>이번 달</Button>}
        <Button onClick={() => go(shift(month, 1))}>다음달 ▸</Button>
        {lead && (
          <span className="v3-mr-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "mine"} onClick={() => go(month, "mine")}>내 보고</button>
            <button type="button" role="tab" aria-selected={tab === "team"} onClick={() => go(month, "team")}>
              팀원 보고{team ? ` ${team.filter((t) => t.actorId !== me.id).length}` : ""}
            </button>
          </span>
        )}
      </div>

      {note && <p className="v3-why" role="status">{note}</p>}

      {tab === "mine" ? (
        <Card className="v3-mr-card">
          <div className="v3-mr-st">
            {sent ? <span className="v3-mr-pill sent">냄 · {seoul(mine!.submittedAt)}</span> : <span className="v3-mr-pill">쓰는 중{mine ? ` · 저장 ${seoul(mine.updatedAt)}` : ""}</span>}
            {mine?.leadReadAt && <span className="v3-mr-pill ok">{mine.leadReadBy} 확인 · {seoul(mine.leadReadAt)}</span>}
            <span className="v3-mr-sp" />
            {!sent && <Button onClick={() => void ai()} disabled={!!busy}>{busy === "ai" ? "만드는 중…(수십 초)" : "AI 초안 만들기"}</Button>}
            <Link className="v3-btn" href={`/v3/log`}>내 기록 보기</Link>
          </div>
          {mine?.leadComment && <p className="v3-mr-cm"><b>팀장 코멘트</b> {mine.leadComment}</p>}
          {sent ? <Md text={body} /> : (
            <textarea className="v3-log-in v3-mr-in" value={body} aria-label="월간 보고 본문"
                      placeholder={"「AI 초안 만들기」로 시작하거나 바로 쓰세요.\n## 한 일\n- …"}
                      onChange={(e) => { setBody(e.target.value); setDirty(true); }} />
          )}
          <div className="v3-mr-foot">
            {sent ? <Button onClick={() => void back()} disabled={!!busy}>되돌리기(다시 고치기)</Button> : (
              <>
                <Button onClick={() => void save()} disabled={!!busy || !dirty}>{busy === "save" ? "저장 중…" : "저장"}</Button>
                <Button primary onClick={() => void submit()} disabled={!!busy || !body.trim()}>팀장에게 내기</Button>
              </>
            )}
            <span className="v3-why">AI 초안은 이 달의 내 기록 · 내가 끝낸 업무 · 들어간 회의 이름만 AI 에 보냅니다(첨부 파일은 안 보냄).</span>
          </div>
        </Card>
      ) : (
        <>
          {team && team.filter((t) => t.actorId !== me.id).length === 0 && (
            <Card><p className="v3-why">{Number(month.slice(5))}월에 낸 팀원 보고가 아직 없습니다.</p></Card>
          )}
          {team?.filter((t) => t.actorId !== me.id).map((r) => (
            <Card key={r.id} className="v3-mr-card" title={r.name} sub={`낸 때 ${seoul(r.submittedAt)}`}>
              <Md text={r.body} />
              <div className="v3-mr-foot">
                <input className="v3-cc-in v3-mr-cin" aria-label={`${r.name} 보고 코멘트`} maxLength={500}
                       placeholder="한 줄 코멘트(없어도 됩니다)" value={comments[r.id] ?? r.leadComment ?? ""}
                       onChange={(e) => setComments((c) => ({ ...c, [r.id]: e.target.value }))} />
                <Button primary onClick={() => void review(r)}>{r.leadReadAt ? "코멘트 고치기" : "확인"}</Button>
                {r.leadReadAt && <span className="v3-mr-pill ok">{r.leadReadBy} 확인 · {seoul(r.leadReadAt)}</span>}
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
