"use client";

// 첫 사용 안내 (MD-P-2026-015 §A) — 계정당 1회, 3장. 건너뛰기 가능.
// Slack 을 쓰던 사람이 읽는다고 가정하고 스레드·저장됨 같은 익숙한 말로 적는다.
// ⌘/ 단축키 모달 하단의 "안내 다시 보기"에서 FIRSTRUN_EVENT 로 다시 열 수 있다.
import { useCallback, useEffect, useRef, useState } from "react";
import { isMac, keyLabel } from "@/lib/shortcuts";

export const FIRSTRUN_EVENT = "tb:first-run";

interface Slide { eyebrow: string; title: string; body: React.ReactNode }

function slides(mac: boolean): Slide[] {
  const k = (keys: string[]) => <kbd className="frn-k">{keyLabel(keys, mac)}</kbd>;
  return [
    {
      eyebrow: "1 / 3",
      title: "프로젝트 안에서 다 끝납니다",
      body: (
        <>
          <p>
            Slack 이라면 채널에서 대화하고, 결정은 스크롤을 거슬러 찾아야 했죠.
            여기서는 <b>프로젝트 하나를 열면 논의 · 업무 · 기록 · 결정</b>이 탭으로 한자리에 있습니다.
          </p>
          <p className="frn-sub">
            논의에서 나온 결론은 <b>결정</b> 탭에 남고, 나중에 뒤집히면 취소선과 함께
            <b> → 새 결정 #번호</b>로 이어집니다. &quot;그때 왜 이렇게 했더라&quot;를 다시 묻지 않아도 됩니다.
          </p>
        </>
      ),
    },
    {
      eyebrow: "2 / 3",
      title: "이동은 키보드가 제일 빠릅니다",
      body: (
        <>
          <p>
            {k(["mod", "K"])} 를 누르고 이름을 치면 업무 · 프로젝트 · 논의 어디로든 바로 갑니다.
            메뉴를 뒤질 필요가 없어요.
          </p>
          <p>
            {k(["mod", "/"])} 는 <b>단축키 전체 보기</b>입니다. 새 항목 만들기 {k(["mod", "N"])},
            화면 안 검색 {k(["mod", "F"])} 처럼 자주 쓰는 것만 외워두면 충분합니다.
          </p>
          <p className="frn-sub">
            메시지에 마우스를 올리면 Slack 처럼 <b>리액션 · 스레드 · 저장</b> 버튼이 뜹니다.
            저장한 것은 왼쪽 <b>저장됨</b>에 모입니다.
          </p>
        </>
      ),
    },
    {
      eyebrow: "3 / 3",
      title: "목표에 프로젝트를 걸면 달성률이 저절로 채워집니다",
      body: (
        <>
          <p>
            목표를 만들고 <b>프로젝트를 연결</b>해두면, 업무 진척이 프로젝트로 · 프로젝트가 목표로
            올라가 <b>달성률이 자동 계산</b>됩니다. 매주 숫자를 손으로 적을 일이 없어요.
          </p>
          <p className="frn-sub">
            연결된 업무가 하나도 없으면 0% 가 아니라 <b>-</b> 로 표시됩니다.
            없는 숫자를 지어내지 않으려는 규칙이니, <b>-</b> 가 보이면 아직 연결이 안 된 것입니다.
          </p>
        </>
      ),
    },
  ];
}

export default function FirstRun() {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const mac = isMac();
  const deck = slides(mac);
  const closeRef = useRef<HTMLButtonElement>(null);

  // 첫 진입 여부는 서버(account.onboarded_at)가 판단한다 — 기기를 바꿔도 한 번만 뜬다.
  useEffect(() => {
    let alive = true;
    fetch("/api/onboarding")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.show) { setOpen(true); setI(0); } })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // ⌘/ 모달의 "안내 다시 보기"
  useEffect(() => {
    const reopen = () => { setI(0); setOpen(true); };
    window.addEventListener(FIRSTRUN_EVENT, reopen);
    return () => window.removeEventListener(FIRSTRUN_EVENT, reopen);
  }, []);

  const finish = useCallback(() => {
    setOpen(false);
    fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(); }
      if (e.key === "ArrowRight") setI((v) => Math.min(deck.length - 1, v + 1));
      if (e.key === "ArrowLeft") setI((v) => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, finish, deck.length]);

  if (!open) return null;
  const s = deck[i];
  const last = i === deck.length - 1;

  return (
    <div className="frn-bg" onClick={finish}>
      <div className="frn" role="dialog" aria-modal="true" aria-labelledby="frn-t" onClick={(e) => e.stopPropagation()}>
        <div className="frn-h">
          <span className="frn-eyebrow num">{s.eyebrow}</span>
          <span className="gsp" style={{ flex: 1 }} />
          <button ref={closeRef} className="frn-skip" onClick={finish}>건너뛰기</button>
        </div>

        <h2 id="frn-t">{s.title}</h2>
        <div className="frn-b">{s.body}</div>

        <div className="frn-f">
          <span className="frn-dots" role="tablist" aria-label="안내 단계">
            {deck.map((_, n) => (
              <button
                key={n}
                role="tab"
                aria-selected={n === i}
                aria-label={`${n + 1}번째 안내`}
                className={`frn-dot${n === i ? " on" : ""}`}
                onClick={() => setI(n)}
              />
            ))}
          </span>
          <span className="gsp" style={{ flex: 1 }} />
          {i > 0 && <button className="btn small" onClick={() => setI(i - 1)}>이전</button>}
          {last
            ? <button className="btn-brand" onClick={finish}>시작하기</button>
            : <button className="btn-brand" onClick={() => setI(i + 1)}>다음</button>}
        </div>
      </div>
    </div>
  );
}
