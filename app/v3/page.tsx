// v3 「오늘」 — **아직 자리만 잡았다** (MD-P-2026-042 §B).
//
// §A(토큰·부품)와 §B(경로·스위치)까지가 이번 커밋이다. 화면 다섯은 §C 에서
// 짓는다. 그 전에 **스위치가 끝까지 통하는지** 사람이 눈으로 봐야 해서,
// 부품을 한 벌 늘어놓은 자리를 둔다.
//
// 여기 있는 숫자는 **재료가 아니라 부품 견본**이다. 진짜 값은 §C-1 에서
// 기존 API 를 먹여 채운다. 견본인 것을 화면에도 적는다 —
// 안 적으면 「0건인데 왜 0이지」로 읽힌다.
import { Card, Chip, StatTile, ListRow, Tag, Empty, Button } from "@/components/v3/parts";
import { CATEGORIES } from "@/lib/v3/category";

export const dynamic = "force-dynamic";

export default function V3Today() {
  return (
    <>
      <h1 className="v3-h1">부품 견본</h1>
      <p className="v3-lede">
        토큰과 기본 부품이 실제로 그려지는지 보는 자리입니다.
        <b> 아래 숫자와 목록은 견본이고 진짜 데이터가 아닙니다</b> — 화면 다섯은 다음 단계에서 짓습니다.
      </p>

      <div className="v3-stats">
        <StatTile n={7} label="진행 중" />
        <StatTile n={3} label="이번 주 마감" />
        <StatTile n={2} label="기한 없음" warn />
      </div>

      <Card title="카테고리 칩" sub="사이드바가 아니라 줄입니다">
        <div className="v3-chips">
          <Chip on>전체</Chip>
          {CATEGORIES.map((c) => <Chip key={c.key} count={0}>{c.label}</Chip>)}
        </div>
        <div className="v3-chips">
          <Chip dashed>＋ 담당</Chip>
          <Chip dashed>＋ 기한</Chip>
          <Chip dashed>＋ 하위</Chip>
          <Chip dashed>＋ 파일</Chip>
        </div>
      </Card>

      <Card title="행" sub="체크 · 제목 · 담당 · 기한 — 네 가지만">
        <ListRow href="#" title="기한이 지난 업무" state="doing" assignee="권" due="09-02" late />
        <ListRow href="#" title="하위가 있는 업무" sub="하위 2개 중 1개 완료" state="review" assignee="박" due="09-14" />
        <ListRow href="#" title="담당도 기한도 없는 업무" state="todo" assignee={null} due={null} />
        <ListRow href="#" title="마친 업무" state="done" assignee="조" due="09-01" />
      </Card>

      <Card title="태그와 버튼">
        <div className="v3-chips">
          {CATEGORIES.map((c) => <Tag key={c.key} cat={c.key} />)}
        </div>
        <div className="v3-chips">
          <Button primary>저장</Button>
          <Button>취소</Button>
          <Button disabled>못 누름</Button>
        </div>
      </Card>

      <Card title="빈 상태" sub="이유와 다음 행동을 적습니다">
        <Empty
          title="오늘 할 일이 없어요"
          why="기한이 오늘이거나 지난 업무가 없습니다. 기한 없는 업무 2건은 아무 날에도 안 걸려 여기 안 뜹니다."
          action={{ label: "기한 없는 업무 보기", href: "/open-due" }}
        />
      </Card>
    </>
  );
}
