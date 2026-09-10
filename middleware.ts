// 페이지 접근 가드 — 세션 쿠키 없으면 /login으로. (서명 검증은 서버 컴포넌트/API에서 수행)
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const SESSION_COOKIE = "tb_session";
/** 미들웨어가 실어 주는 지금 경로. `components/AppShell.tsx` 가 읽는다. */
export const PATH_HEADER = "x-tb-path";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/brand") || // 브랜드 로고 등 공개 자산(로그인 전 표시)
    pathname === "/favicon.ico"
  ) {
    return NextResponse.next();
  }
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  /*
   * 지금 경로를 **서버 컴포넌트가 읽을 수 있게** 넘긴다 (MD-P-2026-043 §C).
   *
   * v3 스위치가 켜지면 옛 경로가 새 경로로 보내야 하는데, 그 판단은 DB 를
   * 읽어야 하고 미들웨어는 DB 를 못 본다. 반대로 서버 컴포넌트는 DB 를 보지만
   * **자기가 어느 경로인지 모른다.** 그래서 여기서 경로만 실어 준다.
   *
   * 옛 화면 파일을 하나도 안 건드리고 한 자리에서 보내려면 이 길뿐이다 —
   * 아니면 화면마다 한 줄씩 넣어야 하고, 그러면 빠뜨린 화면이 눌러 보기
   * 전까지 안 보인다(§G — 막는 것은 뿌리에서 한 번).
   */
  const h = new Headers(request.headers);
  // **쿼리까지** 넘긴다. 짝표가 `?panel=task:12` 같은 것을 알아야 하기 때문이다
  // (`lib/v3/routes.ts` 참고) — 경로만 보면 상세로 가던 링크를 목록이 삼킨다.
  h.set(PATH_HEADER, pathname + request.nextUrl.search);
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
