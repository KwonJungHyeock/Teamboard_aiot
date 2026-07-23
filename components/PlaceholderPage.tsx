// 미구현 화면 자리표시 — 해당 Phase에서 실제 화면으로 교체된다.
export default function PlaceholderPage({
  title,
  phase,
}: {
  title: string;
  phase: string;
}) {
  return (
    <div className="phold">
      <b>{title}</b>
      {phase}에서 구현 예정입니다.
    </div>
  );
}
