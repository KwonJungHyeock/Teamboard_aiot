import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AppShell from "@/components/AppShell";
import TasksView from "@/components/TasksView";

export const dynamic = "force-dynamic";

export default function Page({ searchParams }: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = getSession();
  if (!user) redirect("/login");
  // 정렬·묶기·완료 포함 — **주소에 있으면 서버가 답을 안다.** 주소가 저장값을 이기기 때문이다.
  // 넘겨주면 공유 링크가 첫 바이트부터 맞는 값으로 그려진다. 안 넘기면 하이드레이션이
  // 끝날 때까지 기본값(기한순 · 묶지 않음 · 완료 제외)이 보인다.
  const one = (k: string) => {
    const v = searchParams?.[k];
    return typeof v === "string" ? v : undefined;
  };
  return (
    <AppShell user={user}>
      <TasksView user={user} initial={{ sort: one("sort"), group: one("group"), done: one("done") }} />
    </AppShell>
  );
}
