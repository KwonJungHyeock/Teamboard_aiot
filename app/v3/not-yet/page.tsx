// 막음 화면 — **404 가 아니다** (MD-P-2026-066 §B-5).
//
// 「없는 것」과 「아직 안 여는 것」은 다른 말이다. 이 자리는 있고, 만들고 있고,
// 날짜가 정해져 있다. 그래서 200 으로 뜨고 세 가지를 적는다 (§B-6):
//
//   ① 무엇인지        — 그 화면이 무슨 자리인가
//   ② 언제 열리는지    — 11월 2일 뒤
//   ③ **돌아갈 길 하나** — 읽는 사람이 할 수 있는 게 있어야 한다
//
// 문구는 전부 `lib/v3/not-yet.ts` 에서 온다. 여기서 문장을 만들지 않는다 —
// 만들면 같은 상황을 두 곳이 다르게 설명하게 되고, 그때부터 어느 쪽이 맞는지
// 모른다(`lib/denied.ts` 가 041→053 에서 겪은 그것).
import Link from "next/link";
import { notYetOf, NOT_YET_WHEN, NOT_YET_BACK } from "@/lib/v3/not-yet";

export const dynamic = "force-dynamic";

export default function NotYet({
  searchParams,
}: { searchParams: { k?: string } }) {
  const s = notYetOf(searchParams.k);
  return (
    <>
      <h1 className="v3-h1">{s ? s.label : "아직 안 여는 화면"}</h1>
      <p className="v3-lede">아직 안 열었습니다. 없는 화면이 아닙니다.</p>

      <section className="v3-card">
        <div className="v3-empty">
          {/* ① 무엇인지. **모르는 열쇠면 이름을 지어내지 않는다** — 주소에 적힌
              것을 그대로 옮기면 남이 써 준 문장을 우리 목소리로 읽게 된다 */}
          <b>{s ? s.label : "이 자리"}</b>
          <p>
            {s ? s.what : "주소에 적힌 이름을 못 알아봤습니다. 아래 길로 돌아가세요."}
            {" "}
            {/* ② 언제 */}
            {NOT_YET_WHEN}
          </p>
          {/* ③ 돌아갈 길 **하나** */}
          <Link className="v3-btn" href={NOT_YET_BACK.href}>{NOT_YET_BACK.label}</Link>
        </div>
      </section>
    </>
  );
}
