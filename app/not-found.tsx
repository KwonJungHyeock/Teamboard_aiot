// 404 — 없는 주소. 돌아갈 곳 하나를 준다.
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";

export const metadata = { title: `찾을 수 없는 화면 · ${APP_NAME}` };

export default function NotFound() {
  return (
    <main className="errpage">
      <div className="errpage-card">
        <span className="errpage-code tn">404</span>
        <h1>없는 주소</h1>
        <div className="errpage-act"><Link className="ed-btn pri" href="/">업무 현황으로</Link></div>
      </div>
    </main>
  );
}
