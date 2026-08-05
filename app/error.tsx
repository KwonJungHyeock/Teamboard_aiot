"use client";

// 전역 에러 바운더리 (MD-P-2026-015 §D) — 렌더 중 예외를 잡아 흰 화면 대신 안내를 띄운다.
// 원문 스택은 사용자에게 보여주지 않는다. digest 만 노출해 로그와 대조할 수 있게 한다.
import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // 서버 로그와 대조할 수 있게 콘솔에는 남긴다.
    console.error("[error-boundary]", error);
  }, [error]);

  return (
    <main className="errpage">
      <div className="errpage-card">
        <span className="errpage-code num">500</span>
        <h1>화면을 그리는 중 문제가 생겼어요</h1>
        <p>
          작업하던 내용은 대부분 자동 저장됩니다. 다시 시도해도 같은 화면이 나오면
          팀장에게 아래 오류 번호를 알려주세요.
        </p>
        {error.digest && <p className="errpage-digest num">오류 번호 {error.digest}</p>}
        <div className="errpage-act">
          <button className="btn-brand" onClick={reset}>다시 시도</button>
          <Link className="btn" href="/">홈으로 돌아가기</Link>
        </div>
      </div>
    </main>
  );
}
