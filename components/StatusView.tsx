// 업무 현황 (관리 전용) — 완료 추이 + **담당자별 현황**.
//
// 홈의 「팀 현황」 탭을 여기로 흡수했다 (§C 회신 1). 탭은 첫 것만 눌리고 나머지는 안 눌린다.
//
// **「평균 진척」은 옮기지 않았다.** 진척은 본인이 손으로 적는 값이라 사람끼리 나란히
// 놓으면 **정직하게 적을수록 손해**가 된다. 팀장이 알아야 하는 것은 "누가 몇 % 인가"가
// 아니라 **"누가 막혀 있는가"** 다.
//
// 「담당자별 부하」(진행/대기 막대)도 함께 뺐다. 아래 줄이 같은 사람을 더 많은 사실로
// 말한다 — 한 화면에 사람별 블록이 둘이면 그게 §C 가 없애려던 중복이다.
import type { HomeSummary } from "@/lib/home";
import PageShell from "./PageShell";
import AnalyticsCharts from "./AnalyticsCharts";
import AssigneeStatus from "./AssigneeStatus";

export default function StatusView({
  weeklyDone,
  teamStatus,
}: {
  weeklyDone: HomeSummary["weeklyDone"];
  teamStatus: HomeSummary["teamStatus"];
}) {
  return (
    <PageShell
      crumb={["관리", "업무 현황"]}
      title="업무 현황"
      subtitle={<>팀 전체의 완료 추이와 담당자별 현황을 한눈에 봅니다. (팀장 전용)</>}
    >
      <AssigneeStatus rows={teamStatus} />
      <div className="hv pg-legacy">
        <div className="wrap">
          <AnalyticsCharts weeklyDone={weeklyDone} />
        </div>
      </div>
    </PageShell>
  );
}
