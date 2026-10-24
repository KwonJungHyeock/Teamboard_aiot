// 아직 안 여는 화면 · 권한 없음 — 이름과 돌아갈 길 하나만.
import Link from "next/link";
import { notYetOf, NOT_YET_BACK } from "@/lib/v3/not-yet";

export const dynamic = "force-dynamic";

export default function NotYet({ searchParams }: { searchParams: { k?: string } }) {
  const s = notYetOf(searchParams.k);
  return (
    <div className="ed-page">
      <div className="ed-head"><h1 className="ed-h1">{s ? s.label : "열 수 없는 화면"}</h1></div>
      <section className="ed-sec q" style={{ alignItems: "flex-start" }}>
        <div className="ed-empty">아직 열지 않음</div>
        <Link className="ed-btn pri" href={NOT_YET_BACK.href}>{NOT_YET_BACK.label}</Link>
      </section>
    </div>
  );
}
