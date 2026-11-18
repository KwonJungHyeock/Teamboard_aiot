"use client";

// 업무 요청 (2026-11-18, 0050) — 팀원끼리 일을 부탁한다.
//   받은 요청: 수락하면 내 업무가 된다 · 거절은 사유 한 줄(선택)
//   보낸 요청: 대기 중이면 취소 · 수락된 뒤엔 그 업무의 진행 상태가 보인다
//   `?to=ID` 로 열면 그 사람에게 쓰는 창이 바로 뜬다(팀원별 현황에서).
import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ago, dMinus, mdw, STATUS_LABEL, todayKst, type PriorityV, type Status } from "@/lib/ed/core";
import { useMeta } from "../data";
import { DateIn } from "../AddModal";
import { PriBadge, PriPick } from "../Pri";
import { api, emitChanged, Modal, Seg, useOnChanged, useToast } from "../ui";

interface Req {
  id: number; fromId: number; fromName: string; toId: number; toName: string; title: string; body: string;
  dueDate: string | null; priority: string; status: "pending" | "accepted" | "declined" | "canceled";
  reply: string | null; taskId: number | null; taskStatus: string | null; createdAt: string;
}
const iso = (pg: string) => pg.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00");

export default function Requests() {
  const meta = useMeta();
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [tab, setTab] = useState<"in" | "out">("in");
  const [data, setData] = useState<{ received: Req[]; sent: Req[] } | null>(null);
  const [compose, setCompose] = useState<number | "" | null>(null);
  const [toast, show] = useToast();

  const load = useCallback(async () => {
    try { setData(await api<{ received: Req[]; sent: Req[] }>("/api/ed/requests")); } catch { setData({ received: [], sent: [] }); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useOnChanged(() => { void load(); });
  // 팀원별 현황에서 「업무 요청」 → ?to=ID
  useEffect(() => {
    const to = Number(sp.get("to"));
    if (Number.isInteger(to) && to > 0) {
      setCompose(to); setTab("out");
      router.replace(path, { scroll: false });
    }
  }, [sp, path, router]);

  const pending = data?.received.filter((r) => r.status === "pending").length ?? 0;
  const list = tab === "in" ? data?.received : data?.sent;
  const open = (list ?? []).filter((r) => r.status === "pending");
  const past = (list ?? []).filter((r) => r.status !== "pending");

  const act = async (r: Req, body: Record<string, unknown>, msg: string) => {
    try {
      const d = await api<{ request: Req }>(`/api/ed/requests/${r.id}`, { method: "PATCH", body });
      await load(); emitChanged();
      const tid = d.request.taskId;
      if (body.action === "accept" && tid) show(msg, { label: "열기", run: () => router.push(`?task=${tid}`, { scroll: false }) });
      else show(msg);
    } catch (e) { show(e instanceof Error ? e.message : "처리하지 못했습니다"); }
  };

  return (
    <div className="ed-page rq">
      <div className="rq-head">
        <h1 className="ed-h1">업무 요청</h1>
        <Seg value={tab} onChange={setTab} options={[{ v: "in", label: "받은 요청", n: pending || undefined }, { v: "out", label: "보낸 요청" }]} />
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn pri" onClick={() => setCompose("")}>+ 업무 요청</button>
      </div>

      {!data ? <div className="ed-empty">불러오는 중</div> : (
        <>
          <section className="rq-sec">
            <h2>{tab === "in" ? "처리할 요청" : "답을 기다리는 요청"}<span className="tn">{open.length}</span></h2>
            {open.length === 0
              ? <div className="rq-empty">{tab === "in" ? "받은 요청이 없습니다" : "기다리는 요청이 없습니다"}</div>
              : open.map((r) => <Item key={r.id} r={r} side={tab} act={act} />)}
          </section>
          {past.length > 0 && (
            <section className="rq-sec past">
              <h2>지난 요청<span className="tn">{past.length}</span><small>최근 60일</small></h2>
              {past.map((r) => <Item key={r.id} r={r} side={tab} act={act} />)}
            </section>
          )}
        </>
      )}

      {compose !== null && meta && (
        <Compose me={meta.me.id} people={meta.people} to={compose} onClose={() => setCompose(null)}
                 onSent={async (name) => { setCompose(null); setTab("out"); await load(); emitChanged(); show(`${name} 님에게 요청했습니다`); }} />
      )}
      {toast}
    </div>
  );
}

function Item({ r, side, act }: { r: Req; side: "in" | "out"; act: (r: Req, body: Record<string, unknown>, msg: string) => Promise<void> }) {
  const router = useRouter();
  const today = todayKst();
  const [no, setNo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>, msg: string) => { setBusy(true); await act(r, body, msg); setBusy(false); };

  const who = side === "in" ? `${r.fromName} 님이 요청` : `${r.toName} 님에게`;
  const st = r.status === "pending" ? { cls: "wait", text: side === "in" ? "새 요청" : "대기" }
    : r.status === "declined" ? { cls: "no", text: "거절" }
    : r.status === "canceled" ? { cls: "off", text: "취소됨" }
    : r.taskStatus === "done" ? { cls: "done", text: "완료" }
    : !r.taskStatus || r.taskStatus === "dropped" ? { cls: "off", text: "수락 · 중단됨" }
    : { cls: "ok", text: `수락 · ${STATUS_LABEL[r.taskStatus as Status] ?? r.taskStatus}` };
  // 아직 살아 있는 요청만 D-day · 지남을 보인다(끝난 것 · 거절 · 취소는 날짜만)
  const live = r.status === "pending" || (r.status === "accepted" && !!r.taskStatus && r.taskStatus !== "done" && r.taskStatus !== "dropped");
  const late = live && !!r.dueDate && r.dueDate < today;

  return (
    <div className={`rq-it ${r.status}`}>
      <div className="r1">
        <b className="tt">{r.title}</b><PriBadge p={r.priority} />
        <span className={`st ${st.cls}`}>{st.text}</span>
      </div>
      <div className="mt">
        {who} · {ago(iso(r.createdAt))}
        {r.dueDate && <> · 기한 <span className={late ? "late" : undefined}>{mdw(r.dueDate)}{live ? ` ${dMinus(r.dueDate, today)}` : ""}</span></>}
      </div>
      {r.body && <p className="bd">{r.body}</p>}
      {r.reply && <p className="rp">거절 사유 · {r.reply}</p>}

      {no !== null ? (
        <div className="rq-no">
          <input className="ed-input" autoFocus value={no} maxLength={500} placeholder="거절 사유 (선택)" aria-label="거절 사유"
                 onChange={(e) => setNo(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) void run({ action: "decline", reply: no }, "거절했습니다"); if (e.key === "Escape") { e.preventDefault(); setNo(null); } }} />
          <button type="button" className="ed-btn sm" disabled={busy} onClick={() => void run({ action: "decline", reply: no }, "거절했습니다")}>거절하기</button>
          <button type="button" className="ed-btn sm gh" onClick={() => setNo(null)}>돌아가기</button>
        </div>
      ) : (
        <div className="ac">
          {side === "in" && r.status === "pending" && (<>
            <button type="button" className="ed-btn sm pri" disabled={busy} onClick={() => void run({ action: "accept" }, "내 업무에 넣었습니다")}>수락</button>
            <button type="button" className="ed-btn sm" disabled={busy} onClick={() => setNo("")}>거절</button>
          </>)}
          {side === "out" && r.status === "pending" && (
            <button type="button" className="ed-btn sm gh" disabled={busy}
                    onClick={() => { if (window.confirm("이 요청을 취소할까요?")) void run({ action: "cancel" }, "요청을 취소했습니다"); }}>요청 취소</button>
          )}
          {r.taskId && r.taskStatus && (
            <button type="button" className="ed-btn sm" onClick={() => router.push(`?task=${r.taskId}`, { scroll: false })}>업무 열기</button>
          )}
        </div>
      )}
    </div>
  );
}

function Compose({ me, people, to, onClose, onSent }: {
  me: number; people: { id: number; name: string }[]; to: number | ""; onClose: () => void; onSent: (name: string) => void;
}) {
  const others = people.filter((p) => p.id !== me);
  const [who, setWho] = useState<number | "">(others.some((p) => p.id === to) ? to : "");
  const [title, setTitle] = useState("");
  const [pri, setPri] = useState<PriorityV>("mid");
  const [due, setDue] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const ok = who !== "" && !!title.trim() && !busy;

  const send = async () => {
    if (!ok) return;
    setBusy(true); setErr("");
    try {
      await api("/api/ed/requests", { method: "POST", body: { toId: who, title: title.trim(), priority: pri, dueDate: due || null, body: body.trim() } });
      onSent(others.find((p) => p.id === who)?.name ?? "");
    } catch (e) { setErr(e instanceof Error ? e.message : "보내지 못했습니다"); setBusy(false); }
  };

  return (
    <Modal onClose={onClose} label="업무 요청" width={520}>
      <div className="am-h">
        <b className="rq-mt">업무 요청</b>
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-x" onClick={onClose} aria-label="닫기">✕</button>
      </div>
      <div className="am-b">
        <div className="am-f">
          <span>누구에게</span>
          <div className="am-radios" role="radiogroup" aria-label="받는 사람">
            {others.map((p) => (
              <label key={p.id} className={`am-radio${who === p.id ? " on" : ""}`}>
                <input type="radio" name="rq-to" checked={who === p.id} onChange={() => setWho(p.id)} />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        </div>
        <input className="ed-input am-title" autoFocus={to !== ""} value={title} maxLength={200} placeholder="무엇을 부탁할까요?" aria-label="요청 내용"
               onChange={(e) => setTitle(e.target.value)}
               onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
        <div className="am-f">
          <span>우선순위</span>
          <PriPick full value={pri} onChange={setPri} />
        </div>
        <div className="am-f">
          <span>기한 <small>선택</small></span>
          <div className="am-dates">
            <DateIn label="기한" value={due} min={todayKst()} onChange={setDue} />
            {due && <button type="button" className="ed-btn sm gh" onClick={() => setDue("")}>기한 없음</button>}
          </div>
        </div>
        <textarea className="ed-input" rows={3} value={body} maxLength={4000} onChange={(e) => setBody(e.target.value)} placeholder="자세한 내용 (선택)" aria-label="자세한 내용" />
        {err && <div className="ed-err">{err}</div>}
      </div>
      <div className="am-foot">
        <span style={{ flex: 1 }} />
        <button type="button" className="ed-btn sm" onClick={onClose}>취소</button>
        <button type="button" className="ed-btn sm pri" disabled={!ok} onClick={() => void send()}>{busy ? "보내는 중…" : "요청 보내기"}</button>
      </div>
    </Modal>
  );
}
