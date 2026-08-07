"use client";

// 로딩 표시 (MD-P-2026-026 §A-4) — 데이터가 **아직 안 온 상태**.
//
// 빈 상태가 아니다. 예전에는 둘 다 `.gempty` 한 클래스로 "불러오는 중..." 을 찍었고,
// 그래서 "없다"와 "아직이다"가 같은 회색 한 줄로 보였다. 사용자는 그 차이를 알아야 한다.
//
// §G 규격:
//   · "불러오는 중" 같은 **텍스트 금지** — 뼈대가 곧 설명이다
//   · **스피너 금지**
//   · **shimmer(반짝임) 애니메이션 금지** — 정적 스켈레톤. 움직임은 후속 모션 규격에서 다룬다
//   · 모양: 목록 = 38px 행 4개 / 블록·카드 = 그 블록 크기 1개 / 페이지 전체 = 제목 + 목록 뼈대
//
// 뼈대는 **올 데이터와 같은 크기**여야 한다. 크기가 다르면 도착하는 순간 화면이 튄다.
export type SkeletonVariant = "list" | "block" | "page";

export default function Skeleton({
  variant = "list",
  rows = 4,
  height,
  label = "불러오는 중",
}: {
  variant?: SkeletonVariant;
  /** variant="list" 에서 그릴 행 수. 기본 4 (§G). */
  rows?: number;
  /** variant="block" 에서 채울 높이(px). 감싸는 블록과 같게 준다. */
  height?: number;
  /** 스크린리더 전용 문구. 화면에는 보이지 않는다 — 눈에 보이는 텍스트는 금지다. */
  label?: string;
}) {
  return (
    <div className={`sk sk-${variant}`} role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>

      {variant === "page" && (
        <>
          <span className="sk-title" aria-hidden="true" />
          <div className="sk-rows" aria-hidden="true">
            {Array.from({ length: rows }, (_, i) => (
              <span key={i} className="sk-row" />
            ))}
          </div>
        </>
      )}

      {variant === "list" && (
        <div className="sk-rows" aria-hidden="true">
          {Array.from({ length: rows }, (_, i) => (
            <span key={i} className="sk-row" />
          ))}
        </div>
      )}

      {variant === "block" && (
        <span className="sk-block" aria-hidden="true" style={height ? { height } : undefined} />
      )}
    </div>
  );
}
