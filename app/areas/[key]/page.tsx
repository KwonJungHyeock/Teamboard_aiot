// 영역 작업 공간 → 업무 화면의 영역 필터로 리다이렉트 (MD-P-2026-027 §B2).
//
// 영역은 "어디로 갈까"(내비게이션)가 아니라 "무엇을 볼까"(필터)다.
// 사이드바에서 영역 7개를 내리고 /tasks 필터 칩으로 옮겼으므로,
// 이 경로도 그쪽으로 보낸다.
//
// **경로를 지우지 않는다.** 이미 돌아다니는 링크가 있을 수 있다 —
// 저장한 북마크, 지난 대화에 붙인 주소. 404 로 만들면 그 링크들이 죽는다.
// (앱 안의 참조는 조사 결과 사이드바 한 곳뿐이었고 그건 §B2 에서 제거했다)
//
// 존재하지 않거나 비활성인 영역은 그대로 404 다 — 없는 것을 있는 것처럼 보내지 않는다.
import { redirect, notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { queryOne } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AreaPage({ params }: { params: { key: string } }) {
  const user = getSession();
  if (!user) redirect("/login");

  const id = Number(params.key);
  if (!Number.isInteger(id) || id <= 0) notFound();
  // workspace 영역만 작업 공간을 가졌다. link_only·비활성은 예전처럼 404 (파트 0)
  const area = await queryOne<{ id: number }>(
    `SELECT id FROM area WHERE id = $1 AND is_active = true AND kind = 'workspace'`,
    [id]
  );
  if (!area) notFound();

  redirect(`/tasks?area=${id}`);
}
