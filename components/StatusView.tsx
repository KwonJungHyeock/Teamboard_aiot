// 업무 현황 (관리 전용) — 홈에서 옮겨온 팀 분석 차트 2종. 집계·컴포넌트는 재사용(이전만).
import type { HomeSummary } from "@/lib/home";
import PageShell from "./PageShell";
import AnalyticsCharts from "./AnalyticsCharts";

export default function StatusView({
  weeklyDone,
  assigneeLoad,
}: {
  weeklyDone: HomeSummary["weeklyDone"];
  assigneeLoad: HomeSummary["assigneeLoad"];
}) {
  return (
    <PageShell
      crumb={["관리", "업무 현황"]}
      title="업무 현황"
      subtitle={<>팀 전체의 완료 추이와 담당자별 부하를 한눈에 봅니다. (팀장 전용)</>}
    >
    <div className="hv pg-legacy">
      <div className="wrap">
        <AnalyticsCharts weeklyDone={weeklyDone} assigneeLoad={assigneeLoad} />
      </div>
    </div>
    </PageShell>
  );
}
