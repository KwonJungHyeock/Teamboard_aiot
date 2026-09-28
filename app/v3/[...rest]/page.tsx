// v3 의 **나머지 전부** — 막음 화면으로 (MD-P-2026-067 §0-2).
//
// ── 왜 이 파일이 따로 필요한가 ──────────────────────────────────
//
// 뿌리(`app/v3/layout.tsx`)가 「아홉 밖이면 막는다」를 이미 한다. 그런데
// **없는 주소는 레이아웃까지 오지 않는다** — Next 가 먼저 404 를 낸다.
// 검사가 그걸 잡았다: `/v3/projects` · `/v3/없는화면` 이 404 였다.
//
// 그래서 **아무 주소나 받는 자리**를 하나 둔다. 여기로 오면 막음 화면으로
// 보낸다. 「없는 것」과 「아직 안 여는 것」은 다른 말이고(§G 066), v3 안에서는
// 둘 다 **아직 안 여는 것**이다 — 아홉이 정해져 있으므로 그 밖은 전부
// 「나중에」이지 「없음」이 아니다.
//
// ── 아홉을 여기서 또 적지 않는다 ────────────────────────────────
//
// 이 자리는 **아홉이 아닌 주소만** 도달한다(아홉은 각자 제 파일이 받는다).
// 그래서 판정을 다시 하지 않고 이름만 찾는다.
import { redirect } from "next/navigation";
import { notYetHref, notYetOf } from "@/lib/v3/not-yet";
import { V3_BASE } from "@/lib/v3/routes";

export const dynamic = "force-dynamic";

export default function V3Rest({ params }: { params: { rest?: string[] } }) {
  const first = params.rest?.[0] ?? "";
  // 이름을 아는 곳이면 그 이름으로. 모르면 열쇠 없이 — **주소에 적힌 글자를
  // 화면에 옮기지 않는다**(`notYetOf` 가 모르는 열쇠에 `null` 을 낸다).
  redirect(notYetOf(first) ? notYetHref(first) : `${V3_BASE}/not-yet`);
}
