"use client";

// 에러 바운더리 — 흰 화면 대신 다시 시도. 원문 스택은 보이지 않고 digest 만 남긴다.
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[error-boundary]", error); }, [error]);
  return (
    <main className="errpage">
      <div className="errpage-card">
        <span className="errpage-code tn">500</span>
        <h1>화면을 그리지 못했습니다</h1>
        {error.digest && <p className="errpage-digest tn">오류 번호 {error.digest}</p>}
        <div className="errpage-act">
          <button type="button" className="ed-btn pri" onClick={reset}>다시 시도</button>
          <Link className="ed-btn" href="/">업무 현황으로</Link>
        </div>
      </div>
    </main>
  );
}
