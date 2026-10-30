// 「보고」 상세 = 발표 화면. 숫자는 서버가 낸다(/api/team-reports/:id).
import { notFound } from "next/navigation";
import TeamReport from "@/components/ed/screens/TeamReport";
import "../../../ed-reports.css";

export const dynamic = "force-dynamic";

export default function V3Report({ params }: { params: { id: string } }) {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  return <TeamReport id={id} />;
}
