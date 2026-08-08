// 목표 ↔ 프로젝트 연결 — **폐지됨** (MD-P-2026-030 §A1).
//
// 목표에 붙는 것은 업무뿐이다. 프로젝트를 목표에 붙이는 경로는 없앴다.
// 화면에서 버튼만 지우고 라우트를 살려 두면 경로는 그대로 남는다 —
// 연결 경로를 하나로 만드는 것이 이 지시서의 목적이므로 서버에서 닫는다.
//
// 파일을 지우지 않고 남기는 이유:
//   ① 왜 없어졌는지가 이 자리에 있어야 다음 사람이 다시 만들지 않는다.
//   ② project.goal_id 컬럼과 데이터는 보존한다(§A5). 되살릴 판단은 사람이 한다.
// 파일 삭제는 승인 후에 한다.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const GONE = {
  error: "목표-프로젝트 연결은 더 이상 지원하지 않습니다. 업무를 목표에 직접 연결하세요.",
};

export async function GET() {
  return NextResponse.json(GONE, { status: 410 });
}
export async function POST() {
  return NextResponse.json(GONE, { status: 410 });
}
export async function DELETE() {
  return NextResponse.json(GONE, { status: 410 });
}
