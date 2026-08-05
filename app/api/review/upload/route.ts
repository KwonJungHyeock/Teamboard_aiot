// 구 공개(public) 업로드 라우트 — MD-P-2026-014a 로 Private 전환되면서 폐쇄됐다.
// 스토어가 Private 이므로 공개 URL을 만드는 경로를 남겨두면 안 된다(URL 유출 = 열람).
// 조용히 사라지면 원인을 못 찾으므로, 남은 호출자에게 이유와 대체 경로를 알린다.
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    {
      error: "이 업로드 경로는 사용하지 않습니다. /api/blob/upload?kind=…&id=… 를 쓰세요.",
      movedTo: "/api/blob/upload",
    },
    { status: 410 }
  );
}
