"use client";

// 회의록 · 내 메모 — 회의 스테이지 자리에 펼치는 종이(0045).
//   회의록  함께 쓴다. 손을 멈추면 1.2초 뒤 저장하고, 남이 고친 판은 3초 묻기(Room)로 받아 온다.
//           둘이 동시에 고쳐 409 가 나면 남의 판 위에 내가 덧붙인 부분을 얹어 다시 저장한다(글이 사라지지 않게).
//   내 메모 나만 본다. 같은 방식으로 저장한다.
//   저장(내보내기) PDF · Word · 텍스트 — lib/ed/minutes-export.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { printMinutes, saveText, saveWord, type MinutesDoc } from "@/lib/ed/minutes-export";

export interface NotesState { body: string; rev: number; by: string | null; at: string | null }
type Mode = "notes" | "memo";
const IDLE = 1200;

const hm = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(Date.parse(iso.replace(" ", "T").replace(/\+00$/, "Z").replace(/([+-]\d\d)$/, "$1:00")) + 9 * 3600e3);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
};

export default function MeetingNotes({ meetingId, remote, onSaved, doc, digest, onToast }: {
  meetingId: number;
  remote: NotesState;                          // 3초 묻기로 받은 최신 판
  onSaved: (n: NotesState) => void;            // 내가 저장한 판을 Room 에 알려 다음 묻기와 어긋나지 않게
  doc: () => Omit<MinutesDoc, "notes" | "memo">;
  digest: () => string;                        // 「결정 · 할 일 넣기」로 붙일 글
  onToast: (s: string) => void;
}) {
  const [mode, setMode] = useState<Mode>("notes");
  // ── 회의록 ──
  const [text, setText] = useState(remote.body);
  const base = useRef(remote.body);            // 서버와 같다고 아는 글
  const rev = useRef(remote.rev);
  const [state, setState] = useState<"saved" | "dirty" | "saving">("saved");
  const [meta, setMeta] = useState({ by: remote.by, at: remote.at });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const textRef = useRef(text); textRef.current = text;
  const saving = useRef(false);

  // 남이 고친 판 — 내가 안 고친 상태면 그대로 받는다(고치는 중이면 저장 때 합친다)
  useEffect(() => {
    if (remote.rev > rev.current && textRef.current === base.current && !saving.current) {
      base.current = remote.body; rev.current = remote.rev; setText(remote.body); setMeta({ by: remote.by, at: remote.at });
    }
  }, [remote.rev, remote.body, remote.by, remote.at]);

  const save = useCallback(async (): Promise<void> => {
    if (saving.current) return;
    const mine = textRef.current;
    if (mine === base.current) { setState("saved"); return; }
    saving.current = true; setState("saving");
    try {
      const r = await fetch(`/api/meetings/${meetingId}/notes`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: mine, rev: rev.current }),
      }).catch(() => null);
      const d = r ? await r.json().catch(() => ({})) : {};
      if (r?.status === 409 && d.notes) {
        // 남의 판 + 내가 덧붙인 것. 앞부분을 그대로 두고 뒤에 쓴 경우가 대부분이다
        const cur = d.notes as NotesState;
        const added = mine.startsWith(base.current) ? mine.slice(base.current.length) : `\n\n── 내가 고치던 글 ──\n${mine}`;
        const merged = cur.body + added;
        base.current = cur.body; rev.current = cur.rev; setText(merged); textRef.current = merged;
        onToast("다른 사람이 같이 고쳤습니다. 내 글을 이어 붙였습니다");
        saving.current = false;
        return save();
      }
      if (!r?.ok) { setState("dirty"); onToast(d.error ?? "회의록을 저장하지 못했습니다"); return; }
      const n = d.notes as NotesState;
      base.current = mine; rev.current = n.rev; setMeta({ by: n.by, at: n.at }); onSaved(n);
      setState(textRef.current === mine ? "saved" : "dirty");
    } finally { saving.current = false; }
    if (textRef.current !== base.current) { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void save(), IDLE); }
  }, [meetingId, onSaved, onToast]);

  const edit = (v: string) => {
    setText(v); setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), IDLE);
  };

  // ── 내 메모 ──
  const [memo, setMemo] = useState<string | null>(null);
  const [memoAt, setMemoAt] = useState<string | null>(null);
  const [memoState, setMemoState] = useState<"saved" | "dirty" | "saving">("saved");
  const memoRef = useRef(""); memoRef.current = memo ?? "";
  const memoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    void fetch(`/api/meetings/${meetingId}/memo`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((d) => { setMemo(d?.memo?.body ?? ""); setMemoAt(d?.memo?.at ?? null); }).catch(() => setMemo(""));
  }, [meetingId]);
  const saveMemo = useCallback(async () => {
    setMemoState("saving");
    const body = memoRef.current;
    const r = await fetch(`/api/meetings/${meetingId}/memo`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body }) }).catch(() => null);
    if (!r?.ok) { setMemoState("dirty"); onToast("메모를 저장하지 못했습니다"); return; }
    const d = await r.json().catch(() => ({}));
    setMemoAt(d.memo?.at ?? null);
    setMemoState(memoRef.current === body ? "saved" : "dirty");
  }, [meetingId, onToast]);
  const editMemo = (v: string) => {
    setMemo(v); setMemoState("dirty");
    if (memoTimer.current) clearTimeout(memoTimer.current);
    memoTimer.current = setTimeout(() => void saveMemo(), IDLE);
  };

  // 닫거나 나갈 때 — 남은 것을 바로 저장하고, 탭을 닫으려 하면 한 번 묻는다
  const flush = useRef(() => {});
  flush.current = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; void save(); }
    if (memoTimer.current) { clearTimeout(memoTimer.current); memoTimer.current = null; void saveMemo(); }
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (textRef.current !== base.current || memoTimer.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); flush.current(); };
  }, []);

  // ── 넣기 · 내보내기 ──
  const putDigest = () => {
    const add = digest();
    if (!add) { onToast("넣을 결정 · 할 일이 없습니다"); return; }
    edit(`${text.trimEnd()}${text.trim() ? "\n\n" : ""}${add}`);
  };
  const [withMemo, setWithMemo] = useState(false);
  const full = (): MinutesDoc => ({ ...doc(), notes: text, memo: withMemo ? memo ?? "" : undefined });
  const [menu, setMenu] = useState(false);

  const status = mode === "notes"
    ? (state === "saving" ? "저장 중" : state === "dirty" ? "고치는 중" : meta.at ? `저장됨 · ${hm(meta.at)}${meta.by ? ` ${meta.by}` : ""}` : "함께 쓰는 회의록")
    : (memoState === "saving" ? "저장 중" : memoState === "dirty" ? "고치는 중" : memoAt ? `저장됨 · ${hm(memoAt)} · 나만 보기` : "나만 보는 메모");

  return (
    <div className="rm-doc rm-notes">
      <div className="rm-dh">
        <div className="rm-nseg" role="tablist">
          {([["notes", "회의록"], ["memo", "내 메모"]] as [Mode, string][]).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={mode === k} className={mode === k ? "on" : undefined}
                    onClick={() => { flush.current(); setMode(k); }}>{l}</button>
          ))}
        </div>
        <span className="w">{status}</span>
        {mode === "notes" && <button type="button" className="b" onClick={putDigest}>결정 · 할 일 넣기</button>}
        <div className="rm-exp">
          <button type="button" className="b pri" onClick={() => { flush.current(); setMenu((x) => !x); }} aria-expanded={menu}>저장 ▾</button>
          {menu && (
            <div className="rm-expm" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); if (!printMinutes(full())) onToast("팝업이 막혔습니다. 이 사이트의 팝업을 허용해 주세요"); }}>PDF<small>인쇄 창에서 「PDF로 저장」</small></button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); saveWord(full()); }}>Word 문서<small>.doc · 한글 · 구글 문서도 열림</small></button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); saveText(full()); }}>텍스트<small>.txt</small></button>
              <label className="rm-expc"><input type="checkbox" checked={withMemo} onChange={(e) => setWithMemo(e.target.checked)} />내 메모도 넣기</label>
            </div>
          )}
        </div>
      </div>
      <div className="rm-paper">
        {mode === "notes" ? (
          <textarea value={text} onChange={(e) => edit(e.target.value)} aria-label="회의록"
                    placeholder={"회의록을 적어 주세요. 참석한 사람 모두가 같이 고칩니다.\n\n예)\n1. 지난주 진행 상황\n- 시제품 2차 조립 완료\n2. 결정\n- 다음 주 금요일 현장 테스트"} />
        ) : memo === null ? <div className="rm-empty">불러오는 중</div> : (
          <textarea value={memo} onChange={(e) => editMemo(e.target.value)} aria-label="내 메모"
                    placeholder="나만 보는 메모입니다. 다른 사람(팀장 포함)은 볼 수 없습니다." />
        )}
      </div>
    </div>
  );
}
