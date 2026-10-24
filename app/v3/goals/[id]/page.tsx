// 옛 「목표 상세」 — 목표 관리의 오른쪽 상세로 합쳤다.
import { redirect } from "next/navigation";
export default function V3GoalDetail({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  redirect(Number.isInteger(id) && id > 0 ? `/v3/goals?g=${id}` : "/v3/goals");
}
