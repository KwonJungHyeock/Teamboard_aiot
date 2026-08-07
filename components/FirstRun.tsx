"use client";

// 첫 사용 안내 (MD-P-2026-015 §A) — 계정당 1회, 3장. 건너뛰기 가능.
//
// 문구는 MD-P-2026-026 지시 31 로 갈았다. 이전 문구는 "프로젝트 안에서 다 끝난다" ·
// "목표에 프로젝트를 걸면 달성률이 채워진다" 였는데, 확정된 모델과 어긋난다:
//   · 진척은 **업무 → 월 목표**로 붙는다. 프로젝트는 그룹핑 단위이지 계산 단위가 아니다 (024 규칙 4)
//   · 내 공간과 팀이 갈려 있다 (025 §A) — 처음 온 사람이 가장 먼저 알아야 할 경계다
// 장수는 3장 그대로이고, 기능은 늘리지 않았다 (지시 31-3).
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
      title: "업무를 월 목표에 걸면 달성률이 저절로 올라갑니다",
      body: (
        <>
          <p>
            목표는 <b>연간 → 분기 → 월</b> 세 층입니다. 업무를 <b>월 목표에 연결</b>하면
            그 진척이 분기로, 분기가 연간으로 올라갑니다. 매주 숫자를 손으로 적을 일이 없어요.
          </p>
          <p className="frn-sub">
            연결된 업무가 하나도 없으면 0% 가 아니라 <b>집계 없음</b>으로 나옵니다.
            없는 숫자를 지어내지 않으려는 규칙이니, 그렇게 보이면 아직 연결이 안 된 것입니다.
          </p>
        </>
      ),
    },
    {
      eyebrow: "2 / 3",
      title: "내 공간과 팀은 갈려 있습니다",
      body: (
        <>
          <p>
            왼쪽 메뉴가 <b>내 공간</b>과 <b>팀</b>으로 나뉩니다.
            내 공간의 <b>개인 업무 · 메모 · 일정</b>은 <b>나만 봅니다.</b> 팀장도 볼 수 없어요.
          </p>
          <p className="frn-sub">
            팀에 보여야 할 것이 생기면 팀 업무로 만들거나 <b>논의·결정</b>으로 옮기세요.
            개인 목표는 예외로, 진척 숫자만 팀장에게 보입니다 — 그 아래 업무 내용은 보이지 않습니다.
          </p>
        </>
      ),
    },
    {
      eyebrow: "3 / 3",
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
            이 안내는 {k(["mod", "/"])} 아래 <b>안내 다시 보기</b>에서 언제든 다시 열 수 있습니다.
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
