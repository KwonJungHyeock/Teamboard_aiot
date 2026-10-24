"use client";

// 회의실 목록 — 열린 회의가 맨 위, 그 아래 지난 회의(회의록). 이름 하나 적고 엔터면 열린다.
//
// 회의는 팀 것이다(0038). 비공개 회의는 없다 — 열면 팀 전체가 이 목록에서 본다.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, Empty } from "./parts";

interface Decision {
  itemId: number; body: string; votes: number; decidedAt: string;
  meetingId: number; meetingTitle: string; meetingAt: string; by: string;
}
interface Summary {
  id: number; title: string; status: "live" | "ended"; startedAt: string; endedAt: string | null;
  startedBy: string; present: number; attendees: number; decisions: number; actions: number;
}

const ts = (s: string | null) => (s ? Date.parse(s.replace(" ", "T").replace(/\+00$/, "Z")) : NaN);
/** 서울 기준 「10-23 (목) 14:05」 */
function when(s: string): string {
  const t = ts(s);
  if (Number.isNaN(t)) return "";
  const k = new Date(t + 9 * 3600 * 1000);
  const w = "일월화수목금토"[k.getUTCDay()];
  return `${k.toISOString().slice(5, 10)} (${w}) ${k.toISOString().slice(11, 16)}`;
}
function minutesOf(a: string, b: string | null): number {
  const s = ts(a), e = b ? ts(b) : Date.now();
  return Number.isNaN(s) || Number.isNaN(e) ? 0 : Math.max(1, Math.round((e - s) / 60000));
}

export default function RoomListView({ initial, decisions }: { initial: Summary[]; decisions: Decision[] }) {
  const router = useRouter();
  const [list, setList] = useState(initial);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // 누가 들어와 있는지는 바뀐다 — 목록도 가끔 다시 묻는다(10초)
  useEffect(() => {
    const t = setInterval(async () => {
      const r = await fetch("/api/meetings").catch(() => null);
      if (r?.ok) setList((await r.json()).meetings);
    }, 10000);
    return () => clearInterval(t);
  }, []);

  const open = async () => {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true); setErr("");
    const r = await fetch("/api/meetings", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: name }),
    }).catch(() => null);
    if (!r?.ok) {
      setBusy(false);
      setErr((r && (await r.json().catch(() => null))?.error) || "회의를 열지 못했습니다.");
      return;
    }
    router.push(`/v3/room/${(await r.json()).id}`);
  };

  const live = list.filter((m) => m.status === "live");
  const past = list.filter((m) => m.status === "ended");

  return (
    <div className="v3-room">
      <h1 className="v3-h1">회의실</h1>
      <p className="v3-lede">영상 · 화면 공유는 이 화면 안에서 · 안건 · 결정 · 할 일은 회의록으로 남습니다</p>

      <Card className="v3-room-new">
        <form className="v3-room-newrow" onSubmit={(e) => { e.preventDefault(); open(); }}>
          <input className="v3-room-in" value={title} maxLength={120} aria-label="회의 이름"
                 placeholder="회의 이름 — 예: 주간 가오픈 점검" onChange={(e) => setTitle(e.target.value)} />
          <Button primary type="submit" disabled={!title.trim() || busy}>{busy ? "여는 중…" : "회의 열기"}</Button>
        </form>
        {err && <p className="v3-room-err" role="alert">{err}</p>}
      </Card>

      <section aria-label="열린 회의" className="v3-room-live">
        {live.length === 0 ? (
          <p className="v3-room-quiet">지금 열린 회의가 없습니다.</p>
        ) : live.map((m) => (
          <Link key={m.id} href={`/v3/room/${m.id}`} className="v3-room-tile">
            <span className="v3-room-dot" aria-hidden="true" />
            <span className="v3-room-tt">
              <b>{m.title}</b>
              <em>{m.startedBy} · {minutesOf(m.startedAt, null)}분째 · {m.present}명 접속</em>
            </span>
            <span className="v3-room-go">들어가기 →</span>
          </Link>
        ))}
      </section>

      <DecisionFinder initial={decisions} />

      <Card title="지난 회의" sub={past.length ? `${past.length}건 · 최근 60일` : undefined}>
        {past.length === 0 ? (
          <Empty title="아직 끝난 회의가 없습니다" why="회의를 끝내면 안건 · 결정 · 할 일 · 링크가 한 장으로 여기 쌓입니다." />
        ) : (
          <ul className="v3-room-past">
            {past.map((m) => (
              <li key={m.id}>
                <Link href={`/v3/room/${m.id}`}>
                  <b>{m.title}</b>
                  <span>{when(m.startedAt)} · {minutesOf(m.startedAt, m.endedAt)}분 · {m.attendees}명</span>
                  <span className="v3-room-n">결정 {m.decisions} · 할 일 {m.actions}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/**
 * 결정 찾기 — 「그때 뭐라고 정했지?」. 확정한 결정만, 최근 것부터.
 * 치는 동안 0.3초 쉬면 찾는다(엔터를 안 눌러도 된다).
 */
function DecisionFinder({ initial }: { initial: Decision[] }) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const word = q.trim();
    if (!word) { setFound(initial); return; }
    const t = setTimeout(async () => {
      setBusy(true);
      const r = await fetch(`/api/meetings/decisions?q=${encodeURIComponent(word)}`).catch(() => null);
      if (r?.ok) setFound((await r.json()).decisions);
      setBusy(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q, initial]);

  return (
    <Card title="결정 찾기" sub={q.trim() ? (busy ? "찾는 중…" : `${found.length}건`) : "최근 확정한 결정"} className="v3-room-dec">
      <input className="v3-room-in" type="search" value={q} aria-label="결정 찾기"
             placeholder="낱말로 찾기 — 예: 업로드 한도" onChange={(e) => setQ(e.target.value)} />
      {found.length === 0 ? (
        <p className="v3-room-quiet">{q.trim() ? "그런 결정이 없습니다." : "아직 확정한 결정이 없습니다. 회의에서 결정을 확정하면 여기 쌓입니다."}</p>
      ) : (
        <ul className="v3-room-past">
          {found.map((d) => (
            <li key={d.itemId}>
              <Link href={`/v3/room/${d.meetingId}`}>
                <b>{d.body}</b>
                <span>{d.meetingTitle} · {when(d.decidedAt)}</span>
                <span className="v3-room-n">찬성 {d.votes}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
