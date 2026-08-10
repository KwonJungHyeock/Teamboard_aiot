import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { userDefaults } from "@/lib/user-defaults";
import AppShell from "@/components/AppShell";
import TasksView from "@/components/TasksView";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const user = getSession();
  if (!user) redirect("/login");
  const defaults = await userDefaults(user);

  const q = (k: string) => {
    const v = searchParams?.[k];
    return typeof v === "string" && v !== "" ? v : undefined;
  };

  /**
   * 홈 판단 타일·KPI 에서 들어온 링크는 **팀 전체 범위**로 연다.
   * 「지연 27」을 눌렀는데 내 영역 · 내 담당으로 좁혀 열리면 27 이 아닌 수가 나온다 —
   * 타일과 목록이 같은 수여야 한다는 §C1 규칙이 여기서 깨진다.
   *
   * 이 판단을 **서버에서 한다.** 예전에는 마운트 이펙트가 주소를 다시 읽어
   * `setFAssignee("")` 을 했고, 그래서 첫 렌더는 내 담당, 확정 렌더는 전체 담당이었다.
   */
  const wide = !!(q("status") || q("due") || q("blocked") === "1" || q("blocking") === "1");

  // 영역 — 주소가 먼저, 없으면 (넓게 여는 진입이면 전체 / 아니면 내 기본 영역).
  // `defaults.areaIds` 는 **이미 결정된 값**이다. 여기서 자르지 않는다 —
  // 자르는 규칙이 화면마다 있으면 §C4 로 화면이 넷이 될 때 넷이 달라진다.
  const areaParam = q("area");
  const initialAreas = areaParam
    ? areaParam.split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0)
    : wide ? [] : defaults.areaIds;

  return (
    <AppShell user={user}>
      <TasksView
        user={user}
        defaults={defaults}
        initialAreas={initialAreas}
        // 주소에 있는 값은 서버가 답을 안다 — 주소가 저장값을 이기기 때문이다.
        // 넘겨주면 공유 링크가 첫 바이트부터 맞는 값으로 그려진다.
        initial={{
          sort: q("sort"), group: q("group"), done: q("done"),
          assignee: q("assignee") ?? (wide ? "all" : undefined),
        }}
      />
    </AppShell>
  );
}
