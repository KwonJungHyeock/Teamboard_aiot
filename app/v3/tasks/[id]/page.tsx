// 옛 「업무 상세」 — 상세 드로어로 합쳤다. 옛 링크 · 알림은 전체 업무 위에 드로어를 연다.
import { redirect } from "next/navigation";
export default function V3TaskDetail({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  redirect(Number.isInteger(id) && id > 0 ? `/v3/tasks?task=${id}` : "/v3/tasks");
}
