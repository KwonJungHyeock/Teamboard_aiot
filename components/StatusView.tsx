// 업무 현황 (관리 전용) — 홈에서 옮겨온 팀 분석 차트 2종. 집계·컴포넌트는 재사용(이전만).
import type { HomeSummary } from "@/lib/home";
import AnalyticsCharts from "./AnalyticsCharts";

export default function StatusView({
  weeklyDone,
  assigneeLoad,
}: {
  weeklyDone: HomeSummary["weeklyDone"];
  assigneeLoad: HomeSummary["assigneeLoad"];
}) {
  return (
    <div className="hv">
      <div className="top">
        <div className="crumb">
          관리 / <b>업무 현황</b>
        </div>
        <span className="sp" />
      </div>
      <div className="wrap">
        <div className="head">
          <div>
            <div className="eb">ADMIN · 플랫폼팀</div>
            <h1>업무 현황</h1>
            <p>팀 전체의 완료 추이와 담당자별 부하를 한눈에 봅니다. (팀장 전용)</p>
          </div>
        </div>
        <AnalyticsCharts weeklyDone={weeklyDone} assigneeLoad={assigneeLoad} />
      </div>
    </div>
  );
}
