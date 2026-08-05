// Private Blob 스트리밍 (MD-P-2026-014a §B) — 인증된 사용자에게만 내려준다.
//
// 순서를 지킨다: ① 이 핸들러 안에서 직접 인증 확인 → ② get(access:'private') → ③ 스트림.
// **미들웨어에 인증을 위임하지 않는다.** 미들웨어 버그가 곧 유출이 되기 때문이다(공식 문서 경고).
// 권한 없음·없는 파일·규칙 밖 경로는 전부 404 — 존재 여부조차 노출하지 않는다.
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { blobEnabled, getPrivate, parseScope, buildBlobResponse } from "@/lib/blob";
import { canReadBlob } from "@/lib/blob-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notFound = () => new NextResponse(null, { status: 404 });

export async function GET(request: Request) {
  // ① 인증 — 미들웨어가 아니라 여기서 직접 본다.
  const session = getSession();
  if (!session) {
    // 본문을 주지 않는다. 로그인 페이지로 리다이렉트하지도 않는다(이미지 태그에 HTML이 오면 안 된다).
    return new NextResponse(null, { status: 401 });
  }
  if (!blobEnabled()) return notFound();

  const pathname = new URL(request.url).searchParams.get("pathname");
  if (!pathname) return notFound();

  const scope = parseScope(pathname);
  if (!scope) return notFound();

  // ② 권한 — 그 엔티티에 실제로 붙어 있고, 볼 수 있는 사람인가
  if (!(await canReadBlob(scope, pathname, session.id))) return notFound();

  // ③ 조건부 요청을 그대로 넘긴다 — 안 바뀌었으면 본문 없이 304
  const ifNoneMatch = request.headers.get("if-none-match");
  try {
    const result = await getPrivate(pathname, ifNoneMatch);
    if (!result) return notFound();
    return buildBlobResponse(result);
  } catch {
    // 스토리지 오류도 존재 여부를 흘리지 않는다
    return notFound();
  }
}
