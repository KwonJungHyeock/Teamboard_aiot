"use client";

// 오류 표시 (MD-P-2026-026 §A-5) — 요청이 **실패한 상태**.
//
// 빈 상태도 로딩도 아니다. 셋을 한 클래스로 찍으면 사용자는
// "데이터가 없구나"와 "서버가 죽었구나"를 구별할 수 없다.
//
// §G 규격:
//   · 아이콘 없음 — 경고 삼각형은 실제 위험보다 크게 읽힌다
//   · **한 문장** + "다시 시도" 텍스트 버튼
//   · 원인을 알면 적는다. 모르면 지어내지 않는다
import type { ReactNode } from "react";

export default function ErrorNote({
  message,
  cause,
  onRetry,
}: {
  /** 무슨 일이 안 됐는지 한 문장. */
  message: string;
  /** 원인을 아는 경우에만. 서버가 준 사유 등. 모르면 넘기지 않는다. */
  cause?: ReactNode;
  /** 없으면 버튼을 그리지 않는다 — 눌러도 소용없는 버튼을 두지 않는다. */
  onRetry?: () => void;
}) {
  return (
    <div className="err-note" role="alert">
      <p>
        {message}
        {cause ? <em> {cause}</em> : null}
      </p>
      {onRetry && (
        <button className="err-retry" type="button" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}
