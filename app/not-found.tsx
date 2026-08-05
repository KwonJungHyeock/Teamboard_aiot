// 404 — 없는 주소 (MD-P-2026-015 §D).
// 브랜드 톤 유지 + 돌아갈 곳을 반드시 준다. 서버 컴포넌트라 세션 여부와 무관하게 뜬다.
import Link from "next/link";

export const metadata = { title: "찾을 수 없는 화면 · Mission Deck" };

export default function NotFound() {
  return (
    <main className="errpage">
      <div className="errpage-card">
        <span className="errpage-code num">404</span>
        <h1>이 주소에는 아무것도 없어요</h1>
        <p>
          주소가 바뀌었거나, 링크가 잘못됐을 수 있어요.
          찾던 업무·논의·목표가 있다면 <b>⌘K</b>로 이름을 검색하는 편이 빠릅니다.
        </p>
        <div className="errpage-act">
          <Link className="btn-brand" href="/">홈으로 돌아가기</Link>
          <Link className="btn" href="/tasks">내 업무 보기</Link>
        </div>
      </div>
    </main>
  );
}
